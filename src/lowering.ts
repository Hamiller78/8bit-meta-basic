import type { Expression, FunctionImplementation, Program, SourceLocation, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { collectFunctionImplementations, expandFunctionCalls, type FunctionCallLoweringContext } from "./function-call-lowering.js";
import { normalizeName } from "./symbols.js";
import {
  capturedPrintExpression,
  captureTestColor,
  lowerAssertBoolean,
  lowerAssertColor,
  lowerAssertComparison,
  lowerAssertPrint,
  lowerAssertPrintAt,
  lowerTestRunner,
  testCellBackgroundColorName,
  testCellTextColorName,
  testOutputName,
  testPrintAtColumnName,
  testPrintAtOutputName,
  testPrintAtRowName,
  testScreenBackgroundColorName,
  testScreenBorderColorName,
  testScreenTextColorName
} from "./test-runner-lowering.js";

export interface LoweredProgram {
  readonly instructions: readonly Instruction[];
  readonly labels: ReadonlyMap<string, LabelDefinition>;
}

export interface LabelDefinition {
  readonly name: string;
  readonly index: number;
  readonly location: SourceLocation;
  readonly internal: boolean;
}

export type Instruction =
  | LabelInstruction
  | RemInstruction
  | ClsInstruction
  | BorderColorInstruction
  | TextColorInstruction
  | ScreenBackgroundColorInstruction
  | CellTextColorInstruction
  | CellBackgroundColorInstruction
  | PaperInstruction
  | PrintInstruction
  | DataInstruction
  | ReadInstruction
  | RestoreInstruction
  | DimArrayInstruction
  | LetInstruction
  | ArrayLetInstruction
  | ReadKeyInstruction
  | RandomizeInstruction
  | GotoInstruction
  | GosubInstruction
  | ReturnInstruction
  | EndInstruction
  | ForInstruction
  | NextInstruction
  | IfGotoInstruction
  | PositionInstruction
  | SetColorInstruction
  | PokeInstruction
  | PrintChrInstruction
  | DimStringInstruction
  | SysInstruction;

export interface LabelInstruction {
  readonly kind: "label";
  readonly name: string;
  readonly internal: boolean;
  readonly location: SourceLocation;
}

export interface RemInstruction {
  readonly kind: "rem";
  readonly text: string;
  readonly location: SourceLocation;
}

export interface ClsInstruction {
  readonly kind: "cls";
  readonly color?: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface BorderColorInstruction {
  readonly kind: "border-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface TextColorInstruction {
  readonly kind: "text-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface ScreenBackgroundColorInstruction {
  readonly kind: "screen-background-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface CellTextColorInstruction {
  readonly kind: "cell-text-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface CellBackgroundColorInstruction {
  readonly kind: "cell-background-color";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface PaperInstruction {
  readonly kind: "paper";
  readonly color: Extract<Expression, { kind: "color" }>;
  readonly location: SourceLocation;
}

export interface PrintInstruction {
  readonly kind: "print";
  readonly items: readonly Expression[];
  readonly trailingSemicolon: boolean;
  readonly at?: {
    readonly row: Expression;
    readonly column: Expression;
  };
  readonly location: SourceLocation;
}

export interface DataInstruction {
  readonly kind: "data";
  readonly values: readonly Expression[];
  readonly location: SourceLocation;
}

export interface ReadInstruction {
  readonly kind: "read";
  readonly targets: readonly string[];
  readonly location: SourceLocation;
}

export interface RestoreInstruction {
  readonly kind: "restore";
  readonly location: SourceLocation;
}

export interface LetInstruction {
  readonly kind: "let";
  readonly name: string;
  readonly expression: Expression;
  readonly location: SourceLocation;
}

export interface DimArrayInstruction {
  readonly kind: "dim-array";
  readonly name: string;
  readonly dimensions: readonly number[];
  readonly location: SourceLocation;
}

export interface ArrayLetInstruction {
  readonly kind: "array-let";
  readonly name: string;
  readonly indices: readonly Expression[];
  readonly expression: Expression;
  readonly location: SourceLocation;
}

export interface ReadKeyInstruction {
  readonly kind: "read-key";
  readonly name: string;
  readonly location: SourceLocation;
}

export interface RandomizeInstruction {
  readonly kind: "randomize";
  readonly seed?: Expression;
  readonly location: SourceLocation;
}

export interface GotoInstruction {
  readonly kind: "goto";
  readonly label: string;
  readonly location: SourceLocation;
}

export interface GosubInstruction {
  readonly kind: "gosub";
  readonly label: string;
  readonly location: SourceLocation;
}

export interface ReturnInstruction {
  readonly kind: "return";
  readonly location: SourceLocation;
}

export interface EndInstruction {
  readonly kind: "end";
  readonly location: SourceLocation;
}

export interface ForInstruction {
  readonly kind: "for";
  readonly variable: string;
  readonly start: Expression;
  readonly limit: Expression;
  readonly step?: Expression;
  readonly location: SourceLocation;
}

export interface NextInstruction {
  readonly kind: "next";
  readonly variable: string;
  readonly location: SourceLocation;
}

export interface IfGotoInstruction {
  readonly kind: "if-goto";
  readonly condition: Expression;
  readonly label: string;
  readonly location: SourceLocation;
}

export interface PositionInstruction {
  readonly kind: "position";
  readonly row: Expression;
  readonly column: Expression;
  readonly location: SourceLocation;
}

export interface SetColorInstruction {
  readonly kind: "setcolor";
  readonly register: number;
  readonly hue: number;
  readonly luminance: number;
  readonly location: SourceLocation;
}

export interface PokeInstruction {
  readonly kind: "poke";
  readonly address: number;
  readonly value: Expression;
  readonly location: SourceLocation;
}

export interface PrintChrInstruction {
  readonly kind: "print-chr";
  readonly code: number;
  readonly trailingSemicolon: boolean;
  readonly location: SourceLocation;
}

export interface DimStringInstruction {
  readonly kind: "dim-string";
  readonly name: string;
  readonly length: number;
  readonly location: SourceLocation;
}

export interface SysInstruction {
  readonly kind: "sys";
  readonly address: number;
  readonly location: SourceLocation;
}

export interface LowerOptions {
  readonly testMode?: boolean;
}

export function lowerProgram(program: Program, options: LowerOptions = {}): LoweredProgram {
  const userLabels = collectUserLabels(program.statements);
  const generator = internalLabelGenerator(userLabels);
  const functions = collectFunctionImplementations(program.statements);
  const context: FunctionCallLoweringContext = { functions, nextTempId: 1 };
  const instructions: Instruction[] = [];

  const mainStatements = program.statements.filter((statement) => statement.kind !== "function" && statement.kind !== "test");
  const functionStatements = program.statements.filter((statement): statement is Extract<Statement, { kind: "function" }> => statement.kind === "function");
  const testStatements = program.statements.filter((statement): statement is Extract<Statement, { kind: "test" }> => statement.kind === "test");

  if (options.testMode) {
    lowerTestRunner(testStatements, instructions, generator);
  } else {
    lowerStatements(mainStatements, instructions, generator, context);
  }

  if (testStatements.length > 0) {
    for (const statement of testStatements) {
      if (!statement.implementation) {
        throw new DiagnosticError(statement.location, `Internal error: TEST ${statement.name} was not analyzed before lowering.`);
      }
      instructions.push({ kind: "label", name: statement.implementation.entryLabel, internal: true, location: statement.location });
      lowerStatements(statement.body, instructions, generator, context, statement.implementation, { testMode: true, currentTestName: statement.name, capturePrints: true });
      if (instructions[instructions.length - 1]?.kind !== "return") {
        instructions.push({ kind: "return", location: statement.location });
      }
    }
  }

  if (functionStatements.length > 0) {
    const endLabel = generator();
    if (!options.testMode) {
      instructions.push({ kind: "goto", label: endLabel, location: functionStatements[0].location });
    }
    for (const statement of functionStatements) {
      if (!statement.implementation) {
        throw new DiagnosticError(statement.location, `Internal error: FUNCTION ${statement.name} was not analyzed before lowering.`);
      }
      instructions.push({ kind: "label", name: statement.implementation.entryLabel, internal: true, location: statement.location });
      lowerStatements(statement.body, instructions, generator, context, statement.implementation, {
        testMode: options.testMode === true,
        capturePrints: options.testMode === true
      });
      if (instructions[instructions.length - 1]?.kind !== "return") {
        instructions.push({ kind: "return", location: statement.location });
      }
    }
    if (!options.testMode) {
      instructions.push({ kind: "label", name: endLabel, internal: true, location: functionStatements[0].location });
    }
  }

  const labels = buildLabelMap(instructions);
  validateReferences(instructions, labels);

  return { instructions, labels };
}

interface LowerStatementOptions {
  readonly testMode?: boolean;
  readonly currentTestName?: string;
  readonly capturePrints?: boolean;
}

function lowerStatements(
  statements: readonly Statement[],
  instructions: Instruction[],
  nextInternalLabel: () => string,
  context: FunctionCallLoweringContext,
  currentFunction?: FunctionImplementation,
  options: LowerStatementOptions = {}
): void {
  for (const statement of statements) {
    switch (statement.kind) {
      case "const":
      case "local":
      case "function":
      case "test":
        break;
      case "dim":
        instructions.push({
          kind: "dim-array",
          name: statement.name,
          dimensions: statement.dimensions.map((dimension) => {
            if (dimension.kind !== "number") {
              throw new DiagnosticError(dimension.location, "Internal error: array dimensions must be resolved before lowering.");
            }
            return dimension.value;
          }),
          location: statement.location
        });
        break;
      case "cls":
        if (options.capturePrints && statement.color) {
          instructions.push({
            kind: "let",
            name: testScreenBackgroundColorName,
            expression: numberExpression(colorNumber(statement.color as Extract<Expression, { kind: "color" }>), statement.location),
            location: statement.location
          });
        }
        instructions.push({
          kind: "cls",
          ...(statement.color ? { color: statement.color as Extract<Expression, { kind: "color" }> } : {}),
          location: statement.location
        });
        break;
      case "border-color":
        if (options.capturePrints) {
          captureTestColor(instructions, testScreenBorderColorName, statement.color as Extract<Expression, { kind: "color" }>, statement.location);
        }
        instructions.push({
          kind: "border-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "text-color":
        if (options.capturePrints) {
          captureTestColor(instructions, testScreenTextColorName, statement.color as Extract<Expression, { kind: "color" }>, statement.location);
        }
        instructions.push({
          kind: "text-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "screen-background-color":
        if (options.capturePrints) {
          captureTestColor(instructions, testScreenBackgroundColorName, statement.color as Extract<Expression, { kind: "color" }>, statement.location);
        }
        instructions.push({
          kind: "screen-background-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "cell-text-color":
        if (options.capturePrints) {
          captureTestColor(instructions, testCellTextColorName, statement.color as Extract<Expression, { kind: "color" }>, statement.location);
        }
        instructions.push({
          kind: "cell-text-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "cell-background-color":
        if (options.capturePrints) {
          captureTestColor(instructions, testCellBackgroundColorName, statement.color as Extract<Expression, { kind: "color" }>, statement.location);
        }
        instructions.push({
          kind: "cell-background-color",
          color: statement.color as Extract<Expression, { kind: "color" }>,
          location: statement.location
        });
        break;
      case "label":
        instructions.push({ kind: "label", name: statement.name, internal: false, location: statement.location });
        break;
      case "print":
        {
          const at = statement.at
            ? {
                row: expandFunctionCalls(statement.at.row, instructions, context),
                column: expandFunctionCalls(statement.at.column, instructions, context)
              }
            : undefined;
          const items = statement.items.map((item) => expandFunctionCalls(item, instructions, context));
          if (options.capturePrints && at) {
            instructions.push({ kind: "let", name: testPrintAtRowName, expression: at.row, location: statement.location });
            instructions.push({ kind: "let", name: testPrintAtColumnName, expression: at.column, location: statement.location });
            instructions.push({
              kind: "let",
              name: testPrintAtOutputName,
              expression: capturedPrintExpression(items, statement.location),
              location: statement.location
            });
          } else if (options.capturePrints) {
            instructions.push({
              kind: "let",
              name: testOutputName,
              expression: capturedPrintExpression(items, statement.location),
              location: statement.location
            });
          }
          if (options.capturePrints) {
            break;
          }
          instructions.push({
            kind: "print",
            items,
            trailingSemicolon: statement.trailingSemicolon,
            ...(at ? { at } : {}),
            location: statement.location
          });
        }
        break;
      case "assert-true":
        lowerAssertBoolean(statement.actual, true, options.currentTestName, instructions, nextInternalLabel, context, statement.location);
        break;
      case "assert-false":
        lowerAssertBoolean(statement.actual, false, options.currentTestName, instructions, nextInternalLabel, context, statement.location);
        break;
      case "assert-eq":
      case "assert-ne":
        if (!statement.expected) {
          throw new DiagnosticError(statement.location, "Internal error: ASSERT_EQ/ASSERT_NE missing expected expression.");
        }
        lowerAssertComparison(statement.kind, statement.expected, statement.actual, options.currentTestName, instructions, nextInternalLabel, context, statement.location);
        break;
      case "assert-print":
        lowerAssertPrint(statement.actual, options.currentTestName, instructions, nextInternalLabel, context, statement.location);
        break;
      case "assert-printat":
        if (!statement.row || !statement.column) {
          throw new DiagnosticError(statement.location, "Internal error: ASSERT_PRINTAT missing row or column expression.");
        }
        lowerAssertPrintAt(statement.row, statement.column, statement.actual, options.currentTestName, instructions, nextInternalLabel, context, statement.location);
        break;
      case "assert-screen-border-color":
        lowerAssertColor("ASSERT_SCREEN_BORDER_COLOR", testScreenBorderColorName, statement.actual, options.currentTestName, instructions, nextInternalLabel, statement.location);
        break;
      case "assert-screen-background-color":
        lowerAssertColor("ASSERT_SCREEN_BACKGROUND_COLOR", testScreenBackgroundColorName, statement.actual, options.currentTestName, instructions, nextInternalLabel, statement.location);
        break;
      case "assert-screen-text-color":
        lowerAssertColor("ASSERT_SCREEN_TEXT_COLOR", testScreenTextColorName, statement.actual, options.currentTestName, instructions, nextInternalLabel, statement.location);
        break;
      case "assert-cell-text-color":
        lowerAssertColor("ASSERT_CELL_TEXT_COLOR", testCellTextColorName, statement.actual, options.currentTestName, instructions, nextInternalLabel, statement.location);
        break;
      case "assert-cell-background-color":
        lowerAssertColor("ASSERT_CELL_BACKGROUND_COLOR", testCellBackgroundColorName, statement.actual, options.currentTestName, instructions, nextInternalLabel, statement.location);
        break;
      case "data":
        instructions.push({ kind: "data", values: statement.values, location: statement.location });
        break;
      case "read":
        instructions.push({ kind: "read", targets: statement.targets, location: statement.location });
        break;
      case "restore":
        instructions.push({ kind: "restore", location: statement.location });
        break;
      case "let":
        instructions.push({ kind: "let", name: statement.name, expression: expandFunctionCalls(statement.expression, instructions, context), location: statement.location });
        break;
      case "array-let":
        instructions.push({
          kind: "array-let",
          name: statement.name,
          indices: statement.indices.map((index) => expandFunctionCalls(index, instructions, context)),
          expression: expandFunctionCalls(statement.expression, instructions, context),
          location: statement.location
        });
        break;
      case "randomize":
        instructions.push({
          kind: "randomize",
          ...(statement.seed ? { seed: expandFunctionCalls(statement.seed, instructions, context) } : {}),
          location: statement.location
        });
        break;
      case "goto":
        instructions.push({ kind: "goto", label: statement.label, location: statement.location });
        break;
      case "gosub":
        instructions.push({ kind: "gosub", label: statement.label, location: statement.location });
        break;
      case "return":
        if (currentFunction && statement.expression) {
          instructions.push({
            kind: "let",
            name: currentFunction.returnName,
            expression: expandFunctionCalls(statement.expression, instructions, context),
            location: statement.location
          });
        }
        instructions.push({ kind: "return", location: statement.location });
        break;
      case "end":
        instructions.push({ kind: "end", location: statement.location });
        break;
      case "for":
        instructions.push({
          kind: "for",
          variable: statement.variable,
          start: expandFunctionCalls(statement.start, instructions, context),
          limit: expandFunctionCalls(statement.limit, instructions, context),
          ...(statement.step ? { step: expandFunctionCalls(statement.step, instructions, context) } : {}),
          location: statement.location
        });
        lowerStatements(statement.body, instructions, nextInternalLabel, context, currentFunction, options);
        instructions.push({ kind: "next", variable: statement.variable, location: statement.location });
        break;
      case "while": {
        const startLabel = nextInternalLabel();
        const bodyLabel = nextInternalLabel();
        const endLabel = nextInternalLabel();

        instructions.push({ kind: "label", name: startLabel, internal: true, location: statement.location });
        instructions.push({ kind: "if-goto", condition: expandFunctionCalls(statement.condition, instructions, context), label: bodyLabel, location: statement.location });
        instructions.push({ kind: "goto", label: endLabel, location: statement.location });
        instructions.push({ kind: "label", name: bodyLabel, internal: true, location: statement.location });
        lowerStatements(statement.body, instructions, nextInternalLabel, context, currentFunction, options);
        instructions.push({ kind: "goto", label: startLabel, location: statement.location });
        instructions.push({ kind: "label", name: endLabel, internal: true, location: statement.location });
        break;
      }
      case "repeat-until": {
        const startLabel = nextInternalLabel();
        const endLabel = nextInternalLabel();

        instructions.push({ kind: "label", name: startLabel, internal: true, location: statement.location });
        lowerStatements(statement.body, instructions, nextInternalLabel, context, currentFunction, options);
        instructions.push({ kind: "if-goto", condition: expandFunctionCalls(statement.condition, instructions, context), label: endLabel, location: statement.location });
        instructions.push({ kind: "goto", label: startLabel, location: statement.location });
        instructions.push({ kind: "label", name: endLabel, internal: true, location: statement.location });
        break;
      }
      case "if": {
        const thenLabel = nextInternalLabel();
        const endLabel = nextInternalLabel();

        if (statement.elseBranch.length > 0) {
          instructions.push({ kind: "if-goto", condition: expandFunctionCalls(statement.condition, instructions, context), label: thenLabel, location: statement.location });
          lowerStatements(statement.elseBranch, instructions, nextInternalLabel, context, currentFunction, options);
          instructions.push({ kind: "goto", label: endLabel, location: statement.location });
          instructions.push({ kind: "label", name: thenLabel, internal: true, location: statement.location });
          lowerStatements(statement.thenBranch, instructions, nextInternalLabel, context, currentFunction, options);
        } else {
          instructions.push({ kind: "if-goto", condition: expandFunctionCalls(statement.condition, instructions, context), label: thenLabel, location: statement.location });
          instructions.push({ kind: "goto", label: endLabel, location: statement.location });
          instructions.push({ kind: "label", name: thenLabel, internal: true, location: statement.location });
          lowerStatements(statement.thenBranch, instructions, nextInternalLabel, context, currentFunction, options);
        }

        instructions.push({ kind: "label", name: endLabel, internal: true, location: statement.location });
        break;
      }
    }
  }
}

function numberExpression(value: number, location: SourceLocation): Expression {
  return { kind: "number", value, raw: value.toString(), location };
}

function colorNumber(color: Extract<Expression, { kind: "color" }>): number {
  switch (color.color) {
    case "BLACK":
      return 0;
    case "BLUE":
      return 1;
    case "RED":
      return 2;
    case "MAGENTA":
      return 3;
    case "GREEN":
      return 4;
    case "CYAN":
      return 5;
    case "YELLOW":
      return 6;
    case "WHITE":
      return 7;
  }
}

function stringExpression(value: string, location: SourceLocation): Expression {
  return { kind: "string", value, location };
}

function identifierExpression(name: string, location: SourceLocation): Expression {
  return { kind: "identifier", name, location };
}

function binaryExpression(operator: Extract<Expression, { kind: "binary" }>["operator"], left: Expression, right: Expression, location: SourceLocation): Expression {
  return { kind: "binary", operator, left, right, location };
}

function collectUserLabels(statements: readonly Statement[], seen = new Map<string, SourceLocation>()): ReadonlySet<string> {
  for (const statement of statements) {
    if (statement.kind === "label") {
      const key = normalizeLabel(statement.name);
      const existing = seen.get(key);
      if (existing) {
        throw new DiagnosticError(statement.location, `Duplicate label "${statement.name}" first defined at ${existing.filename}:${existing.line}.`);
      }
      seen.set(key, statement.location);
      continue;
    }

    if (statement.kind === "if") {
      collectUserLabels(statement.thenBranch, seen);
      collectUserLabels(statement.elseBranch, seen);
    } else if (statement.kind === "for") {
      collectUserLabels(statement.body, seen);
    } else if (statement.kind === "while" || statement.kind === "repeat-until") {
      collectUserLabels(statement.body, seen);
    } else if (statement.kind === "function" || statement.kind === "test") {
      collectUserLabels(statement.body, seen);
    }
  }

  return new Set(seen.keys());
}

function buildLabelMap(instructions: readonly Instruction[]): ReadonlyMap<string, LabelDefinition> {
  const labels = new Map<string, LabelDefinition>();

  instructions.forEach((instruction, index) => {
    if (instruction.kind !== "label") {
      return;
    }

    const key = normalizeLabel(instruction.name);
    if (labels.has(key)) {
      throw new DiagnosticError(instruction.location, `Duplicate label "${instruction.name}".`);
    }

    labels.set(key, {
      name: instruction.name,
      index,
      location: instruction.location,
      internal: instruction.internal
    });
  });

  return labels;
}

function validateReferences(instructions: readonly Instruction[], labels: ReadonlyMap<string, LabelDefinition>): void {
  for (const instruction of instructions) {
    if (instruction.kind !== "goto" && instruction.kind !== "gosub" && instruction.kind !== "if-goto") {
      continue;
    }

    if (!labels.has(normalizeLabel(instruction.label))) {
      throw new DiagnosticError(instruction.location, `Undefined label "${instruction.label}".`);
    }
  }
}

function internalLabelGenerator(userLabels: ReadonlySet<string>): () => string {
  let nextId = 1;
  const used = new Set(userLabels);

  return () => {
    while (true) {
      const candidate = `__mb_${nextId}`;
      nextId += 1;
      const key = normalizeLabel(candidate);
      if (!used.has(key)) {
        used.add(key);
        return candidate;
      }
    }
  };
}

export function normalizeLabel(label: string): string {
  return normalizeName(label);
}
