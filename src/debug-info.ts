import type { Expression, FunctionImplementation, Program, SourceLocation, Statement } from "./ast.js";
import { statementExpressions } from "./function-semantics.js";
import type { NumberedProgram, ReadabilityLevel } from "./line-numbering.js";
import type { Instruction, LabelDefinition } from "./lowering.js";
import { normalizeLabel } from "./lowering.js";
import type { TargetBackend, TargetId } from "./targets/target.js";
import type { TextFont } from "./text-support.js";
import { isIntegerVariableName, isStringVariableName } from "./variables.js";

export interface DebugInfo {
  readonly formatVersion: 1;
  readonly target: TargetId;
  readonly readability: ReadabilityLevel;
  readonly language: string;
  readonly font: TextFont;
  readonly testMode: boolean;
  readonly sourceFiles: readonly string[];
  readonly lines: readonly { readonly basicLine: number; readonly source: SourceLocation; readonly instruction: Instruction["kind"] }[];
  readonly functions: readonly DebugCallable[];
  readonly tests: readonly DebugCallable[];
  readonly labels: readonly { readonly name: string; readonly basicLine: number; readonly internal: boolean; readonly source: SourceLocation }[];
  readonly variables: readonly DebugVariable[];
  readonly structFields: readonly DebugStructField[];
}

export interface DebugCallable {
  readonly name: string;
  readonly source: SourceLocation;
  readonly inline: boolean;
  readonly entryLine?: number;
  readonly parameters: readonly DebugFunctionVariable[];
  readonly locals: readonly DebugFunctionVariable[];
  readonly returnVariable?: DebugFunctionVariable;
}

export interface DebugFunctionVariable {
  readonly sourceName: string;
  readonly storageName: string;
  readonly targetName?: string;
}

export interface DebugVariable {
  readonly storageName: string;
  readonly targetName: string;
  readonly sourceAliases: readonly { readonly name: string; readonly location: SourceLocation }[];
  readonly storage: "scalar" | "array";
  readonly valueType: "number" | "integer" | "string";
}

export interface DebugStructField {
  readonly sourceName: string;
  readonly source: SourceLocation;
  readonly storageName: string;
  readonly targetName: string;
  readonly targetElementIndexBase: 0 | 1;
  readonly targetFieldIndex?: number;
}

export function buildDebugInfo(
  program: Program,
  numbered: NumberedProgram,
  instructions: readonly Instruction[],
  labels: ReadonlyMap<string, LabelDefinition>,
  target: TargetBackend,
  readability: ReadabilityLevel,
  build: { readonly language: string; readonly font: TextFont; readonly testMode: boolean }
): DebugInfo {
  const variableMap = target.variableMap(instructions, readability);
  const aliases = collectSourceAliases(program.statements);
  const arrayNames = new Set(instructions.filter((instruction) => instruction.kind === "dim-array").map((instruction) => instruction.name.toLowerCase()));
  const sourceFiles = program.sourceFiles ?? [...new Set(program.statements.map((statement) => statement.location.filename))];

  const callable = (statement: Extract<Statement, { kind: "function" | "test" }>): DebugCallable => {
    const implementation = statement.implementation;
    if (!implementation) throw new Error(`Internal error: missing implementation for ${statement.name}.`);
    const inline = statement.kind === "function" && statement.inline === true;
    const entryLine = inline ? undefined : numbered.labelLines.get(normalizeLabel(implementation.entryLabel));
    const storage = (item: FunctionImplementation["parameters"][number]): DebugFunctionVariable => ({
      sourceName: item.sourceName,
      storageName: item.storageName,
      ...(variableMap.has(item.storageName.toLowerCase()) ? { targetName: variableMap.get(item.storageName.toLowerCase()) } : {})
    });
    const returnName = implementation.returnName;
    return {
      name: statement.name,
      source: statement.location,
      inline,
      ...(entryLine !== undefined ? { entryLine } : {}),
      parameters: implementation.parameters.map(storage),
      locals: implementation.locals.map(storage),
      ...(variableMap.has(returnName.toLowerCase())
        ? { returnVariable: { sourceName: statement.name, storageName: returnName, targetName: variableMap.get(returnName.toLowerCase()) } }
        : {})
    };
  };

  const structFields: DebugStructField[] = [];
  for (const instruction of instructions) {
    if (instruction.kind !== "dim-array" || !instruction.structArrayName) continue;
    const targetName = variableMap.get(instruction.name.toLowerCase());
    if (!targetName) throw new Error(`Internal error: no target name for struct storage ${instruction.name}.`);
    const targetElementIndexBase = target.id === "spectrum" ? 1 : 0;
    if (instruction.packedStructFields) {
      instruction.packedStructFields.forEach((fieldName, column) => {
        structFields.push({
          sourceName: `${instruction.structArrayName}.${fieldName}`,
          source: instruction.location,
          storageName: instruction.name,
          targetName,
          targetElementIndexBase,
          targetFieldIndex: column + targetElementIndexBase
        });
      });
    } else if (instruction.structFieldName) {
      structFields.push({
        sourceName: `${instruction.structArrayName}.${instruction.structFieldName}`,
        source: instruction.location,
        storageName: instruction.name,
        targetName,
        targetElementIndexBase
      });
    }
  }

  return {
    formatVersion: 1,
    target: target.id,
    readability,
    language: build.language,
    font: build.font,
    testMode: build.testMode,
    sourceFiles,
    lines: numbered.lines.map((line) => ({ basicLine: line.number, source: line.instruction.location, instruction: line.instruction.kind })),
    functions: program.statements.filter((statement): statement is Extract<Statement, { kind: "function" }> => statement.kind === "function").map(callable),
    tests: program.statements.filter((statement): statement is Extract<Statement, { kind: "test" }> => statement.kind === "test").map(callable),
    labels: [...numbered.labelLines].map(([key, basicLine]) => {
      const label = labels.get(key);
      return { name: label?.name ?? key, basicLine, internal: label?.internal ?? true, source: label?.location ?? { filename: "<generated>", line: 1 } };
    }),
    variables: [...variableMap].map(([storageName, targetName]) => {
      return {
        storageName,
        targetName,
        sourceAliases: aliases.get(storageName) ?? [],
        storage: arrayNames.has(storageName) ? "array" : "scalar",
        valueType: isStringVariableName(storageName) ? "string" : isIntegerVariableName(storageName) ? "integer" : "number"
      };
    }),
    structFields
  };
}

function collectSourceAliases(statements: readonly Statement[]): ReadonlyMap<string, readonly { readonly name: string; readonly location: SourceLocation }[]> {
  const aliases = new Map<string, { readonly name: string; readonly location: SourceLocation }[]>();
  const add = (storageName: string, name: string, location: SourceLocation): void => {
    const key = storageName.toLowerCase();
    const names = aliases.get(key) ?? [];
    if (!names.some((alias) => alias.name === name && alias.location.filename === location.filename && alias.location.line === location.line)) {
      names.push({ name, location });
    }
    aliases.set(key, names);
  };
  const addExpression = (expression: Expression): void => {
    switch (expression.kind) {
      case "identifier":
        if (!aliases.has(expression.name.toLowerCase())) add(expression.name, expression.name, expression.location);
        break;
      case "array-access":
        if (!aliases.has(expression.name.toLowerCase())) add(expression.name, expression.name, expression.location);
        expression.indices.forEach(addExpression);
        break;
      case "struct-field-access":
        expression.indices.forEach(addExpression);
        break;
      case "function-call":
        expression.args.forEach(addExpression);
        break;
      case "parenthesized":
        addExpression(expression.expression);
        break;
      case "unary":
        addExpression(expression.operand);
        break;
      case "binary":
        addExpression(expression.left);
        addExpression(expression.right);
        break;
      case "number":
      case "string":
      case "boolean":
      case "color":
        break;
    }
  };
  const visit = (statement: Statement): void => {
    switch (statement.kind) {
      case "let":
        add(statement.name, statement.sourceName ?? statement.name, statement.location);
        break;
      case "array-let":
        add(statement.name, statement.name, statement.location);
        break;
      case "dim":
        if (!statement.structArrayName) add(statement.name, statement.name, statement.location);
        break;
      case "read":
        for (const name of statement.targets) add(name, name, statement.location);
        break;
      case "for":
        add(statement.variable, statement.variable, statement.location);
        statement.body.forEach(visit);
        break;
      case "while":
      case "repeat-until":
      case "globals":
        statement.body.forEach(visit);
        break;
      case "if":
        statement.thenBranch.forEach(visit);
        statement.elseBranch.forEach(visit);
        break;
      case "function":
      case "test":
        if (statement.implementation) {
          for (const item of [...statement.implementation.parameters, ...statement.implementation.locals]) {
            add(item.storageName, `${statement.name}.${item.sourceName}`, statement.location);
            for (const field of item.structFields ?? []) {
              add(field.storageName, `${statement.name}.${item.sourceName}.${field.sourceName}`, statement.location);
            }
          }
        }
        statement.body.forEach(visit);
        break;
      default:
        break;
    }
    statementExpressions(statement).forEach(addExpression);
  };
  statements.forEach(visit);
  return aliases;
}
