import type { Expression } from "../ast.js";

type BinaryOperator = Extract<Expression, { kind: "binary" }>["operator"];

export function generatedNumber(value: number, location: Expression["location"]): Expression {
  return { kind: "number", value, raw: String(value), location };
}

export function generatedBinary(operator: BinaryOperator, left: Expression, right: Expression, location: Expression["location"]): Expression {
  return { kind: "binary", operator, left, right, location };
}

/** Simplify generated arithmetic without dropping or duplicating evaluated operands. */
export function simplifyGeneratedExpression(expression: Expression): Expression {
  switch (expression.kind) {
    case "array-access":
      return { ...expression, indices: expression.indices.map(simplifyGeneratedExpression),
        ...(expression.fixedWidthStorageStart ? { fixedWidthStorageStart: simplifyGeneratedExpression(expression.fixedWidthStorageStart) } : {}),
        ...(expression.fixedWidthStorageLength ? { fixedWidthStorageLength: simplifyGeneratedExpression(expression.fixedWidthStorageLength) } : {}) };
    case "struct-field-access": return { ...expression, indices: expression.indices.map(simplifyGeneratedExpression) };
    case "function-call": return { ...expression, args: expression.args.map(simplifyGeneratedExpression) };
    case "parenthesized": return { ...expression, expression: simplifyGeneratedExpression(expression.expression) };
    case "unary": return { ...expression, operand: simplifyGeneratedExpression(expression.operand) };
    case "binary": break;
    default: return expression;
  }

  const left = simplifyGeneratedExpression(expression.left);
  const right = simplifyGeneratedExpression(expression.right);
  const operator = expression.operator;
  if ((operator === "+" || operator === "-" || operator === "*" || operator === "/") && left.kind === "number" && right.kind === "number"
      && Number.isSafeInteger(left.value) && Number.isSafeInteger(right.value)) {
    const value = operator === "+" ? left.value + right.value : operator === "-" ? left.value - right.value : operator === "*" ? left.value * right.value : left.value / right.value;
    if (Number.isSafeInteger(value) && (operator !== "/" || right.value !== 0)) return generatedNumber(value, expression.location);
  }
  if ((operator === "+" || operator === "-") && right.kind === "number" && right.value === 0) return left;
  if (operator === "+" && left.kind === "number" && left.value === 0) return right;
  if (operator === "*" && right.kind === "number" && right.value === 1) return left;
  if (operator === "*" && left.kind === "number" && left.value === 1) return right;

  if ((operator === "+" || operator === "-") && right.kind === "number" && Number.isSafeInteger(right.value)) {
    let previous = left;
    while (previous.kind === "parenthesized") previous = previous.expression;
    if (previous.kind === "binary" && (previous.operator === "+" || previous.operator === "-")
        && previous.right.kind === "number" && Number.isSafeInteger(previous.right.value)) {
      const first = previous.operator === "+" ? previous.right.value : -previous.right.value;
      const second = operator === "+" ? right.value : -right.value;
      const offset = first + second;
      if (Number.isSafeInteger(offset)) {
        if (offset === 0) return previous.left;
        return generatedBinary(offset < 0 ? "-" : "+", previous.left, generatedNumber(Math.abs(offset), right.location), expression.location);
      }
    }
  }
  return { ...expression, left, right };
}
