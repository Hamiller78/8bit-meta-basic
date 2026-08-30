import type { BinaryOperator, Expression } from "../ast.js";
import { DiagnosticError } from "../diagnostics.js";
import type { ReadabilityLevel } from "../line-numbering.js";
import { type Instruction, type LabelDefinition, type LoweredProgram, normalizeLabel } from "../lowering.js";
import type { PortableColor } from "./environment.js";

export type TargetId = "spectrum" | "atari800xl" | "c64";
export type GotoSpelling = "GO TO" | "GOTO";

export interface TargetBackend {
  readonly id: TargetId;
  readonly gotoSpelling: GotoSpelling;
  readonly maxLineLength: number;
  readonly maxLineNumber: number;
  lower(program: LoweredProgram, readability: ReadabilityLevel): LoweredProgram;
  renderLine(lineNumber: number, instruction: Instruction, labelLines: ReadonlyMap<string, number>, readability: ReadabilityLevel): string;
}

export function renderCheckedLine(
  target: TargetBackend,
  lineNumber: number,
  instruction: Instruction,
  labelLines: ReadonlyMap<string, number>,
  readability: ReadabilityLevel
): string {
  const rendered = target.renderLine(lineNumber, instruction, labelLines, readability);
  validateGeneratedLineLength(target, rendered, instruction);
  return rendered;
}

export interface ExpressionRenderOptions {
  readonly variableMap?: ReadonlyMap<string, string>;
  readonly functionRenderer?: (expression: Extract<Expression, { kind: "function-call" }>, options: ExpressionRenderOptions) => string | undefined;
  readonly arrayRenderer?: (expression: Extract<Expression, { kind: "array-access" }>, options: ExpressionRenderOptions) => string;
}

export type SpectrumColorCode = Readonly<Record<PortableColor, number>>;
export type C64ColorCode = Readonly<Record<PortableColor, number>>;
export interface AtariColorCode {
  readonly hue: number;
  readonly luminance: number;
}

export const spectrumColorCodes: SpectrumColorCode = {
  BLACK: 0,
  BLUE: 1,
  RED: 2,
  MAGENTA: 3,
  GREEN: 4,
  CYAN: 5,
  YELLOW: 6,
  WHITE: 7
};

export const c64ColorCodes: C64ColorCode = {
  BLACK: 0,
  BLUE: 6,
  RED: 2,
  MAGENTA: 4,
  GREEN: 5,
  CYAN: 3,
  YELLOW: 7,
  WHITE: 1
};

export const atariColorCodes: Readonly<Record<PortableColor, AtariColorCode>> = {
  BLACK: { hue: 0, luminance: 0 },
  BLUE: { hue: 7, luminance: 8 },
  RED: { hue: 3, luminance: 8 },
  MAGENTA: { hue: 5, luminance: 8 },
  GREEN: { hue: 12, luminance: 8 },
  CYAN: { hue: 10, luminance: 8 },
  YELLOW: { hue: 13, luminance: 12 },
  WHITE: { hue: 0, luminance: 14 }
};

export function renderExpression(expression: Expression, options: ExpressionRenderOptions = {}): string {
  return renderExpressionWithParent(expression, 0, "none", options);
}

export function renderPrintItems(items: readonly Expression[], trailingSemicolon: boolean, options: ExpressionRenderOptions = {}): string {
  const rendered = items.map((item) => renderExpression(item, options)).join(";");
  return trailingSemicolon ? `${rendered};` : rendered;
}

export function renderDataValues(values: readonly Expression[], options: ExpressionRenderOptions = {}): string {
  return values.map((value) => renderExpression(value, options)).join(",");
}

export function expandPositionedPrints(
  program: LoweredProgram,
  targetName: string,
  maxRow: number,
  maxColumn: number,
  expand: (instruction: Extract<Instruction, { kind: "print" }>) => readonly Instruction[]
): LoweredProgram {
  const instructions: Instruction[] = [];

  for (const instruction of program.instructions) {
    if (instruction.kind === "print" && instruction.at) {
      validateConstantCoordinate(instruction.at.row, "row", maxRow, targetName);
      validateConstantCoordinate(instruction.at.column, "column", maxColumn, targetName);
      instructions.push(...expand(lowerPositionedPrintCoordinates(instruction)));
    } else {
      instructions.push(instruction);
    }
  }

  return rebuildLabels(program, instructions);
}

export function rebuildLabels(program: LoweredProgram, instructions: readonly Instruction[]): LoweredProgram {
  const labels = new Map<string, LabelDefinition>();

  instructions.forEach((instruction, index) => {
    if (instruction.kind !== "label") {
      return;
    }
    const definition = program.labels.get(normalizeLabel(instruction.name));
    labels.set(normalizeLabel(instruction.name), {
      name: instruction.name,
      index,
      location: instruction.location,
      internal: instruction.internal,
      ...(definition ? { location: definition.location, internal: definition.internal } : {})
    });
  });

  return { instructions, labels };
}

function lowerPositionedPrintCoordinates(instruction: Extract<Instruction, { kind: "print" }>): Extract<Instruction, { kind: "print" }> {
  if (!instruction.at) {
    return instruction;
  }

  return {
    ...instruction,
    at: {
      row: lowerPositionedPrintCoordinate(instruction.at.row),
      column: lowerPositionedPrintCoordinate(instruction.at.column)
    }
  };
}

function lowerPositionedPrintCoordinate(expression: Expression): Expression {
  if (expression.kind === "number") {
    return { ...expression, value: expression.value - 1, raw: formatNumber(expression.value - 1) };
  }

  return {
    kind: "binary",
    operator: "-",
    left: expression,
    right: { kind: "number", value: 1, raw: "1", location: expression.location },
    location: expression.location
  };
}

function validateConstantCoordinate(expression: Expression, axis: "row" | "column", max: number, targetName: string): void {
  if (expression.kind !== "number") {
    return;
  }

  const humanMax = max + 1;
  if (!Number.isInteger(expression.value) || expression.value < 1 || expression.value > humanMax) {
    throw new DiagnosticError(
      expression.location,
      `${targetName} PRINT_AT ${axis} coordinate ${formatNumber(expression.value)} is outside the supported range 1..${humanMax}.`
    );
  }
}

function validateGeneratedLineLength(target: TargetBackend, rendered: string, instruction: Instruction): void {
  const length = [...rendered].length;
  if (length <= target.maxLineLength) {
    return;
  }

  throw new DiagnosticError(
    instruction.location,
    `Generated ${targetDisplayName(target.id)} BASIC line is ${length} characters, exceeding the practical editable line limit of ${target.maxLineLength}.`
  );
}

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

function renderExpressionWithParent(
  expression: Expression,
  parentPrecedence: number,
  side: "left" | "right" | "none",
  options: ExpressionRenderOptions
): string {
  const rendered = renderExpressionInner(expression, options);
  const precedence = expressionPrecedence(expression);
  const needsParens = precedence < parentPrecedence || (side === "right" && needsRightParentheses(expression, parentPrecedence));
  return needsParens ? `(${rendered})` : rendered;
}

function renderExpressionInner(expression: Expression, options: ExpressionRenderOptions): string {
  switch (expression.kind) {
    case "number":
      return formatNumber(expression.value);
    case "string":
      return `"${expression.value}"`;
    case "boolean":
      return expression.value ? "1" : "0";
    case "color":
      throw new DiagnosticError(expression.location, `Portable colour ${expression.color} cannot be rendered as a numeric expression.`);
    case "identifier":
      return options.variableMap?.get(expression.name.toLowerCase()) ?? expression.name;
    case "array-access":
      if (!options.arrayRenderer) {
        throw new DiagnosticError(expression.location, `Array ${expression.name} cannot be rendered for this target.`);
      }
      return options.arrayRenderer(expression, options);
    case "struct-field-access":
      throw new DiagnosticError(expression.location, `Struct field ${expression.base}.${expression.field} must be resolved before target rendering.`);
    case "function-call": {
      const rendered = options.functionRenderer?.(expression, options);
      if (rendered !== undefined) {
        return rendered;
      }
      throw new DiagnosticError(expression.location, `Function ${expression.name} must be resolved at compile time.`);
    }
    case "parenthesized":
      return `(${renderExpression(expression.expression, options)})`;
    case "unary":
      if (expression.operator === "-" && expression.operand.kind === "binary" && expression.operand.operator === "^") {
        return `-(${renderExpression(expression.operand, options)})`;
      }
      return expression.operator === "-"
        ? `-${renderExpressionWithParent(expression.operand, expressionPrecedence(expression), "right", options)}`
        : `NOT (${renderExpression(expression.operand, options)} <> 0)`;
    case "binary": {
      if (expression.operator === "AND" || expression.operator === "OR") {
        return `${renderTruthy(expression.left, options)} ${expression.operator} ${renderTruthy(expression.right, options)}`;
      }
      if (expression.operator === "MOD") {
        return renderModuloExpression(expression.left, expression.right, options);
      }
      const precedence = expressionPrecedence(expression);
      const left = renderExpressionWithParent(expression.left, precedence, "left", options);
      const right = renderExpressionWithParent(expression.right, precedence, "right", options);
      return `${left} ${expression.operator} ${right}`;
    }
  }
}

function renderModuloExpression(leftExpression: Expression, rightExpression: Expression, options: ExpressionRenderOptions): string {
  const left = renderExpression(leftExpression, options);
  const right = renderExpression(rightExpression, options);
  return `(${left}) - INT((${left}) / (${right})) * (${right})`;
}

function renderTruthy(expression: Expression, options: ExpressionRenderOptions): string {
  return `((${renderExpression(expression, options)}) <> 0)`;
}

function expressionPrecedence(expression: Expression): number {
  switch (expression.kind) {
    case "number":
    case "string":
    case "boolean":
    case "color":
    case "identifier":
    case "array-access":
    case "struct-field-access":
    case "function-call":
    case "parenthesized":
      return 8;
    case "unary":
      return 6;
    case "binary":
      return binaryPrecedence(expression.operator);
  }
}

function binaryPrecedence(operator: BinaryOperator): number {
  switch (operator) {
    case "OR":
      return 1;
    case "AND":
      return 2;
    case "=":
    case "<>":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return 3;
    case "+":
    case "-":
      return 4;
    case "*":
    case "/":
    case "MOD":
      return 5;
    case "^":
      return 7;
    default:
      return 0;
  }
}

function needsRightParentheses(expression: Expression, parentPrecedence: number): boolean {
  return expression.kind === "binary" && expressionPrecedence(expression) === parentPrecedence;
}

function formatNumber(value: number): string {
  if (Object.is(value, -0)) {
    return "0";
  }
  return value.toString();
}
