import type { BinaryOperator, Expression } from "../ast.js";
import { DiagnosticError } from "../diagnostics.js";
import type { ReadabilityLevel } from "../line-numbering.js";
import { type Instruction, type LabelDefinition, type LoweredProgram, normalizeLabel } from "../lowering.js";

export type TargetId = "spectrum" | "atari800xl" | "c64";
export type GotoSpelling = "GO TO" | "GOTO";

export interface TargetBackend {
  readonly id: TargetId;
  readonly gotoSpelling: GotoSpelling;
  lower(program: LoweredProgram, readability: ReadabilityLevel): LoweredProgram;
  renderLine(lineNumber: number, instruction: Instruction, labelLines: ReadonlyMap<string, number>, readability: ReadabilityLevel): string;
}

export interface ExpressionRenderOptions {
  readonly variableMap?: ReadonlyMap<string, string>;
}

export function renderExpression(expression: Expression, options: ExpressionRenderOptions = {}): string {
  return renderExpressionWithParent(expression, 0, "none", options);
}

export function renderPrintItems(items: readonly Expression[], trailingSemicolon: boolean, options: ExpressionRenderOptions = {}): string {
  const rendered = items.map((item) => renderExpression(item, options)).join(";");
  return trailingSemicolon ? `${rendered};` : rendered;
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
      instructions.push(...expand(instruction));
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
    if (!definition) {
      throw new Error(`Internal error: missing label definition for ${instruction.name}.`);
    }
    labels.set(normalizeLabel(instruction.name), { ...definition, index });
  });

  return { instructions, labels };
}

function validateConstantCoordinate(expression: Expression, axis: "row" | "column", max: number, targetName: string): void {
  if (expression.kind !== "number") {
    return;
  }

  if (!Number.isInteger(expression.value) || expression.value < 0 || expression.value > max) {
    throw new DiagnosticError(
      expression.location,
      `${targetName} PRINT AT ${axis} coordinate ${formatNumber(expression.value)} is outside the supported range 0..${max}.`
    );
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
    case "identifier":
      return options.variableMap?.get(expression.name.toLowerCase()) ?? expression.name;
    case "parenthesized":
      return `(${renderExpression(expression.expression, options)})`;
    case "unary":
      return expression.operator === "-"
        ? `-${renderExpressionWithParent(expression.operand, expressionPrecedence(expression), "right", options)}`
        : `NOT (${renderExpression(expression.operand, options)} <> 0)`;
    case "binary": {
      if (expression.operator === "AND" || expression.operator === "OR") {
        return `${renderTruthy(expression.left, options)} ${expression.operator} ${renderTruthy(expression.right, options)}`;
      }
      const precedence = expressionPrecedence(expression);
      const left = renderExpressionWithParent(expression.left, precedence, "left", options);
      const right = renderExpressionWithParent(expression.right, precedence, "right", options);
      return `${left} ${expression.operator} ${right}`;
    }
  }
}

function renderTruthy(expression: Expression, options: ExpressionRenderOptions): string {
  return `((${renderExpression(expression, options)}) <> 0)`;
}

function expressionPrecedence(expression: Expression): number {
  switch (expression.kind) {
    case "number":
    case "string":
    case "boolean":
    case "identifier":
    case "parenthesized":
      return 7;
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
      return 5;
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
