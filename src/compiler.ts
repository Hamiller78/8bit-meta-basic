import { assignLineNumbers, type ReadabilityLevel } from "./line-numbering.js";
import { lowerProgram, type Instruction, type LoweredProgram } from "./lowering.js";
import { parseSource } from "./parser.js";
import { analyzeProgram } from "./semantic.js";
import { getTarget, type TargetId } from "./targets/index.js";
import { setC64RenderProgram } from "./targets/c64.js";
import { setAtariRenderProgram } from "./targets/atari800xl.js";
import { setSpectrumRenderProgram } from "./targets/spectrum.js";
import { targetEnvironments } from "./targets/environment.js";
import { instructionExpressions } from "./targets/instruction-expressions.js";
import { rebuildLabels, renderCheckedLine, type TargetBackend } from "./targets/target.js";
import { analyzeBasicOutput, type OutputStats } from "./output-stats.js";
import { DiagnosticError } from "./diagnostics.js";
import type { DeviceKind, Expression } from "./ast.js";
import { isStringVariableName } from "./variables.js";

export type Target = TargetId;

export interface CompileOptions {
  readonly filename: string;
  readonly target: Target;
  readonly readability?: ReadabilityLevel;
  readonly comments?: ReadabilityLevel;
  readonly testMode?: boolean;
  readonly testPrinterOutput?: boolean;
  readonly testOutputDevice?: DeviceKind;
}

export interface CompileResult {
  readonly output: string;
  readonly stats: OutputStats;
}

export function compileSource(source: string, options: CompileOptions): string {
  return compileSourceDetailed(source, options).output;
}

export function compileSourceDetailed(source: string, options: CompileOptions): CompileResult {
  const ast = parseSource(source, options.filename);
  return compileProgramDetailed(ast, options);
}

export function compileProgram(ast: ReturnType<typeof parseSource>, options: CompileOptions): string {
  return compileProgramDetailed(ast, options).output;
}

export function compileProgramDetailed(ast: ReturnType<typeof parseSource>, options: CompileOptions): CompileResult {
  const target = getTarget(options.target);
  const readability = options.readability ?? options.comments ?? 2;
  const analyzed = analyzeProgram(ast, targetEnvironments[options.target], { testMode: options.testMode });
  const lowered = lowerProgram(analyzed, {
    testMode: options.testMode,
    testPrinterOutput: options.testPrinterOutput,
    testOutputDevice: options.testOutputDevice
  });
  const targetLowered = renderProgramWithLineLengthRelief(target, lowered, readability);

  return {
    output: `${targetLowered.lines.join("\n")}\n`,
    stats: analyzeBasicOutput(targetLowered.lines, options.target)
  };
}

interface RenderedProgram {
  readonly lines: readonly string[];
}

function renderProgramWithLineLengthRelief(target: TargetBackend, program: LoweredProgram, readability: ReadabilityLevel): RenderedProgram {
  let current = program;
  let nextTempId = nextLineReliefTempId(program.instructions);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const targetLowered = compactGeneratedHousekeepingLets(target.lower(current, readability));
    setRenderProgram(target.id, targetLowered.instructions);
    const numbered = assignLineNumbers(targetLowered, readability, {
      maxLineNumber: target.maxLineNumber,
      targetName: targetDisplayName(target.id)
    });
    const lines: string[] = [];
    let retryWith: LoweredProgram | undefined;

    for (const line of numbered.lines) {
      try {
        lines.push(renderCheckedLine(target, line.number, line.instruction, numbered.labelLines, readability));
      } catch (error) {
        if (!(error instanceof DiagnosticError) || !isGeneratedLineLengthDiagnostic(error)) {
          throw error;
        }

        const relieved = relieveLongInstruction(current, line.instruction, () => `MBT${nextTempId++}`);
        if (!relieved) {
          throw error;
        }
        retryWith = relieved;
        break;
      }
    }

    if (retryWith) {
      current = retryWith;
      continue;
    }

    return { lines };
  }

  throw new Error("Internal error: line-length relief did not converge.");
}

function setRenderProgram(target: TargetId, instructions: readonly Instruction[]): void {
  if (target === "spectrum") {
    setSpectrumRenderProgram(instructions);
  } else if (target === "atari800xl") {
    setAtariRenderProgram(instructions);
  } else {
    setC64RenderProgram(instructions);
  }
}

function isGeneratedLineLengthDiagnostic(error: DiagnosticError): boolean {
  return error.message.includes("Generated ") && error.message.includes(" BASIC line is ");
}

function relieveLongInstruction(program: LoweredProgram, targetInstruction: Instruction, nextTempName: () => string): LoweredProgram | undefined {
  const instructions: Instruction[] = [];
  let changed = false;

  for (const instruction of program.instructions) {
    if (changed || !sameInstructionLocation(instruction, targetInstruction)) {
      instructions.push(instruction);
      continue;
    }

    const replacement = splitInstructionForLineLength(instruction, nextTempName);
    if (!replacement) {
      instructions.push(instruction);
      continue;
    }
    instructions.push(...replacement);
    changed = true;
  }

  return changed ? rebuildLabels(program, instructions) : undefined;
}

function sameInstructionLocation(left: Instruction, right: Instruction): boolean {
  return left.location.filename === right.location.filename && left.location.line === right.location.line;
}

function splitInstructionForLineLength(instruction: Instruction, nextTempName: () => string): readonly Instruction[] | undefined {
  switch (instruction.kind) {
    case "print": {
      const prefix: Instruction[] = [];
      const at = instruction.at
        ? {
            row: preserveForLineLength(instruction.at.row, "number", instruction.location, prefix, nextTempName),
            column: preserveForLineLength(instruction.at.column, "number", instruction.location, prefix, nextTempName)
          }
        : undefined;
      const items = instruction.items.map((item) => preserveForLineLength(item, expressionValueType(item), instruction.location, prefix, nextTempName));
      return prefix.length > 0 ? [...prefix, { ...instruction, items, ...(at ? { at } : {}) }] : undefined;
    }
    case "position": {
      const prefix: Instruction[] = [];
      const row = preserveForLineLength(instruction.row, "number", instruction.location, prefix, nextTempName);
      const column = preserveForLineLength(instruction.column, "number", instruction.location, prefix, nextTempName);
      return prefix.length > 0 ? [...prefix, { ...instruction, row, column }] : undefined;
    }
    case "let": {
      if (isSimpleExpression(instruction.expression)) {
        return undefined;
      }
      const prefix: Instruction[] = [];
      const expression = splitExpressionChildrenForLineLength(instruction.expression, instruction.location, prefix, nextTempName);
      return prefix.length > 0 ? [...prefix, { ...instruction, expression }] : undefined;
    }
    case "array-let": {
      const prefix: Instruction[] = [];
      const indices = instruction.indices.map((index) => preserveForLineLength(index, "number", instruction.location, prefix, nextTempName));
      const expression = preserveForLineLength(instruction.expression, expressionValueType(instruction.expression), instruction.location, prefix, nextTempName);
      return prefix.length > 0 ? [...prefix, { ...instruction, indices, expression }] : undefined;
    }
    case "if-goto": {
      if (isSimpleExpression(instruction.condition)) {
        return undefined;
      }
      const prefix: Instruction[] = [];
      const condition = preserveForLineLength(instruction.condition, "number", instruction.location, prefix, nextTempName);
      return [...prefix, { ...instruction, condition }];
    }
    default:
      return undefined;
  }
}

function splitExpressionChildrenForLineLength(
  expression: Expression,
  location: Expression["location"],
  instructions: Instruction[],
  nextTempName: () => string
): Expression {
  switch (expression.kind) {
    case "array-access":
      return {
        ...expression,
        indices: expression.indices.map((index) => preserveForLineLength(index, "number", location, instructions, nextTempName))
      };
    case "struct-field-access":
      return {
        ...expression,
        indices: expression.indices.map((index) => preserveForLineLength(index, "number", location, instructions, nextTempName))
      };
    case "function-call":
      return {
        ...expression,
        args: expression.args.map((argument) => preserveForLineLength(argument, expressionValueType(argument), location, instructions, nextTempName))
      };
    case "parenthesized":
      return {
        ...expression,
        expression: preserveForLineLength(expression.expression, expressionValueType(expression.expression), location, instructions, nextTempName)
      };
    case "unary":
      return {
        ...expression,
        operand: preserveForLineLength(expression.operand, expressionValueType(expression.operand), location, instructions, nextTempName)
      };
    case "binary":
      return {
        ...expression,
        left: preserveForLineLength(expression.left, expressionValueType(expression.left), location, instructions, nextTempName),
        right: preserveForLineLength(expression.right, expressionValueType(expression.right), location, instructions, nextTempName)
      };
    case "number":
    case "string":
    case "boolean":
    case "color":
    case "identifier":
      return expression;
  }
}

function preserveForLineLength(
  expression: Expression,
  valueType: "number" | "string",
  location: Expression["location"],
  instructions: Instruction[],
  nextTempName: () => string
): Expression {
  if (isSimpleExpression(expression)) {
    return expression;
  }
  const name = `${nextTempName()}${valueType === "string" ? "$" : ""}`;
  instructions.push({ kind: "let", name, expression, location });
  return { kind: "identifier", name, location };
}

function isSimpleExpression(expression: Expression): boolean {
  return (
    expression.kind === "number" ||
    expression.kind === "string" ||
    expression.kind === "boolean" ||
    expression.kind === "color" ||
    expression.kind === "identifier"
  );
}

function expressionValueType(expression: Expression): "number" | "string" {
  if (expression.kind === "string") {
    return "string";
  }
  if (expression.kind === "identifier") {
    return isStringVariableName(expression.name) ? "string" : "number";
  }
  if (expression.kind === "array-access" || expression.kind === "struct-field-access") {
    return isStringVariableName(expression.kind === "struct-field-access" ? expression.field : expression.name) || expression.valueType === "string" ? "string" : "number";
  }
  if (expression.kind === "function-call") {
    return expression.valueType === "string" || isStringVariableName(expression.name) ? "string" : "number";
  }
  if (expression.kind === "parenthesized") {
    return expressionValueType(expression.expression);
  }
  if (expression.kind === "binary" && expression.operator === "+") {
    const left = expressionValueType(expression.left);
    const right = expressionValueType(expression.right);
    return left === "string" || right === "string" ? "string" : "number";
  }
  return "number";
}

function nextLineReliefTempId(instructions: readonly Instruction[]): number {
  const used = new Set<string>();
  for (const instruction of instructions) {
    collectInstructionNames(instruction, used);
  }
  let next = 1;
  while (used.has(`MBT${next}`) || used.has(`MBT${next}$`)) {
    next += 1;
  }
  return next;
}

function collectInstructionNames(instruction: Instruction, used: Set<string>): void {
  for (const expression of instructionExpressions(instruction)) {
    collectExpressionNames(expression, used);
  }

  switch (instruction.kind) {
    case "let":
    case "read-key":
    case "dim-string":
    case "dim-array":
      used.add(instruction.name.toUpperCase());
      break;
    case "multi-let":
      for (const assignment of instruction.assignments) {
        used.add(assignment.name.toUpperCase());
      }
      break;
    case "array-let":
      used.add(instruction.name.toUpperCase());
      break;
    case "for":
    case "next":
      used.add(instruction.variable.toUpperCase());
      break;
  }
}

function collectExpressionNames(expression: Expression, used: Set<string>): void {
  switch (expression.kind) {
    case "identifier":
      used.add(expression.name.toUpperCase());
      break;
    case "array-access":
      used.add(expression.name.toUpperCase());
      for (const index of expression.indices) {
        collectExpressionNames(index, used);
      }
      break;
    case "struct-field-access":
      used.add(expression.base.toUpperCase());
      for (const index of expression.indices) {
        collectExpressionNames(index, used);
      }
      break;
    case "function-call":
      for (const argument of expression.args) {
        collectExpressionNames(argument, used);
      }
      break;
    case "parenthesized":
      collectExpressionNames(expression.expression, used);
      break;
    case "unary":
      collectExpressionNames(expression.operand, used);
      break;
    case "binary":
      collectExpressionNames(expression.left, used);
      collectExpressionNames(expression.right, used);
      break;
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
}

function compactGeneratedHousekeepingLets(program: LoweredProgram): LoweredProgram {
  const instructions: Instruction[] = [];
  let index = 0;

  while (index < program.instructions.length) {
    const instruction = program.instructions[index];
    if (!isCompactableGeneratedHousekeepingLet(instruction)) {
      instructions.push(instruction);
      index += 1;
      continue;
    }

    const run: Extract<Instruction, { kind: "let" }>[] = [];
    while (index < program.instructions.length && run.length < 4 && isCompactableGeneratedHousekeepingLet(program.instructions[index])) {
      run.push(program.instructions[index] as Extract<Instruction, { kind: "let" }>);
      index += 1;
    }

    if (run.length === 1) {
      instructions.push(run[0]);
    } else {
      instructions.push({
        kind: "multi-let",
        assignments: run.map((assignment) => ({
          name: assignment.name,
          expression: assignment.expression,
          location: assignment.location
        })),
        location: run[0].location
      });
    }
  }

  return rebuildLabels(program, instructions);
}

function isCompactableGeneratedHousekeepingLet(instruction: Instruction | undefined): instruction is Extract<Instruction, { kind: "let" }> {
  return isGeneratedHousekeepingLet(instruction) && isSimpleExpression(instruction.expression);
}

function isGeneratedHousekeepingLet(instruction: Instruction | undefined): instruction is Extract<Instruction, { kind: "let" }> {
  return instruction?.kind === "let" && generatedHousekeepingNames.has(instruction.name.toUpperCase());
}

const generatedHousekeepingNames = new Set([
  "MBTOUT$",
  "MBTPOUT$",
  "MBTPROW",
  "MBTPCOL",
  "MBTCB",
  "MBTCG",
  "MBTCT",
  "MBTCC",
  "MBTCD",
  "MBTMSG$",
  "MBTF0"
]);

function targetDisplayName(target: TargetId): string {
  switch (target) {
    case "spectrum":
      return "Spectrum";
    case "atari800xl":
      return "Atari 800XL";
    case "c64":
      return "C64";
  }
}
