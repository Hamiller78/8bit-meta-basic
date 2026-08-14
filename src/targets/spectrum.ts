import type { BinaryOperator, Expression } from "../ast.js";
import type { NumberedLine, NumberedProgram } from "../line-numbering.js";
import { resolveLabel } from "../line-numbering.js";

export function renderSpectrum(program: NumberedProgram): string {
  return `${program.lines.map((line) => renderLine(line, program)).join("\n")}\n`;
}

function renderLine(line: NumberedLine, program: NumberedProgram): string {
  const instruction = line.instruction;

  switch (instruction.kind) {
    case "label":
      return `${line.number} REM ${instruction.name}:`;
    case "print":
      return `${line.number} PRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon)}`;
    case "let":
      return `${line.number} LET ${instruction.name}=${renderExpression(instruction.expression)}`;
    case "goto":
      return `${line.number} GO TO ${resolveLabel(program.labelLines, instruction.label)}`;
    case "if-goto":
      return `${line.number} IF ${renderExpression(instruction.condition)} THEN GO TO ${resolveLabel(program.labelLines, instruction.label)}`;
  }
}

export function renderExpression(expression: Expression): string {
  return renderExpressionWithParent(expression, 0, "none");
}

function renderPrintItems(items: readonly Expression[], trailingSemicolon: boolean): string {
  const rendered = items.map((item) => renderExpression(item)).join(";");
  return trailingSemicolon ? `${rendered};` : rendered;
}

function renderExpressionWithParent(expression: Expression, parentPrecedence: number, side: "left" | "right" | "none"): string {
  const rendered = renderExpressionInner(expression);
  const precedence = expressionPrecedence(expression);
  const needsParens = precedence < parentPrecedence || (side === "right" && needsRightParentheses(expression, parentPrecedence));
  return needsParens ? `(${rendered})` : rendered;
}

function renderExpressionInner(expression: Expression): string {
  switch (expression.kind) {
    case "number":
      return formatNumber(expression.value);
    case "string":
      return `"${expression.value}"`;
    case "boolean":
      return expression.value ? "1" : "0";
    case "identifier":
      return expression.name;
    case "parenthesized":
      return `(${renderExpression(expression.expression)})`;
    case "unary":
      return expression.operator === "-"
        ? `-${renderExpressionWithParent(expression.operand, expressionPrecedence(expression), "right")}`
        : `NOT ${renderExpressionWithParent(expression.operand, expressionPrecedence(expression), "right")}`;
    case "binary": {
      const precedence = expressionPrecedence(expression);
      const left = renderExpressionWithParent(expression.left, precedence, "left");
      const right = renderExpressionWithParent(expression.right, precedence, "right");
      return `${left} ${expression.operator} ${right}`;
    }
  }
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
