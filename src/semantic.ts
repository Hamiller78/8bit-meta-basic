import type { BinaryOperator, Expression, Program, Statement, UnaryOperator } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { normalizeName } from "./symbols.js";

type ConstantValue = number | string | boolean;

interface ConstantDefinition {
  readonly name: string;
  readonly value: ConstantValue;
}

export function analyzeProgram(program: Program): Program {
  const constants = new Map<string, ConstantDefinition>();

  return {
    statements: analyzeStatements(program.statements, constants, false)
  };
}

function analyzeStatements(
  statements: readonly Statement[],
  constants: Map<string, ConstantDefinition>,
  inConstantExpression: boolean
): readonly Statement[] {
  const analyzed: Statement[] = [];

  for (const statement of statements) {
    switch (statement.kind) {
      case "const": {
        const key = normalizeName(statement.name);
        if (constants.has(key)) {
          throw new DiagnosticError(statement.location, `Duplicate constant "${statement.name}".`);
        }

        const value = evaluateConstant(statement.expression, constants);
        constants.set(key, { name: statement.name, value });
        break;
      }
      case "let": {
        if (constants.has(normalizeName(statement.name))) {
          throw new DiagnosticError(statement.location, `Cannot assign to constant "${statement.name}".`);
        }
        const expression = foldExpression(statement.expression, constants, inConstantExpression);
        if (expression.kind === "string") {
          throw new DiagnosticError(statement.location, "Assignments require a numeric expression.");
        }
        analyzed.push({ ...statement, expression });
        break;
      }
      case "print":
        analyzed.push({
          ...statement,
          items: statement.items.map((item) => foldExpression(item, constants, inConstantExpression))
        });
        break;
      case "if":
        analyzed.push({
          ...statement,
          condition: foldExpression(statement.condition, constants, inConstantExpression),
          thenBranch: analyzeStatements(statement.thenBranch, constants, inConstantExpression),
          elseBranch: analyzeStatements(statement.elseBranch, constants, inConstantExpression)
        });
        break;
      case "label":
      case "goto":
        analyzed.push(statement);
        break;
    }
  }

  return analyzed;
}

function evaluateConstant(expression: Expression, constants: ReadonlyMap<string, ConstantDefinition>): ConstantValue {
  const folded = foldExpression(expression, constants, true);
  return evaluateLiteralExpression(folded);
}

function foldExpression(
  expression: Expression,
  constants: ReadonlyMap<string, ConstantDefinition>,
  unknownIdentifierIsError: boolean
): Expression {
  switch (expression.kind) {
    case "number":
    case "string":
    case "boolean":
      return expression;
    case "identifier": {
      const constant = constants.get(normalizeName(expression.name));
      if (constant) {
        return literalFromValue(constant.value, expression.location);
      }
      if (unknownIdentifierIsError) {
        throw new DiagnosticError(expression.location, `Unknown constant "${expression.name}".`);
      }
      return expression;
    }
    case "parenthesized": {
      const folded = foldExpression(expression.expression, constants, unknownIdentifierIsError);
      if (isLiteralExpression(folded)) {
        return folded;
      }
      return { ...expression, expression: folded };
    }
    case "unary": {
      const operand = foldExpression(expression.operand, constants, unknownIdentifierIsError);
      if (isLiteralExpression(operand)) {
        return literalFromValue(evaluateUnary(expression.operator, evaluateLiteralExpression(operand), expression), expression.location);
      }
      return { ...expression, operand };
    }
    case "binary": {
      const left = foldExpression(expression.left, constants, unknownIdentifierIsError);
      const right = foldExpression(expression.right, constants, unknownIdentifierIsError);
      if (isLiteralExpression(left) && isLiteralExpression(right)) {
        return literalFromValue(
          evaluateBinary(expression.operator, evaluateLiteralExpression(left), evaluateLiteralExpression(right), expression),
          expression.location
        );
      }
      return { ...expression, left, right };
    }
  }
}

function evaluateLiteralExpression(expression: Expression): ConstantValue {
  switch (expression.kind) {
    case "number":
      return expression.value;
    case "string":
      return expression.value;
    case "boolean":
      return expression.value;
    default:
      throw new DiagnosticError(expression.location, "Constant expression must be fully known at compile time.");
  }
}

function evaluateUnary(operator: UnaryOperator, value: ConstantValue, expression: Expression): ConstantValue {
  switch (operator) {
    case "-":
      if (typeof value !== "number") {
        throw new DiagnosticError(expression.location, "Unary - requires a numeric operand.");
      }
      return -value;
    case "NOT":
      return !truthy(value);
  }
}

function evaluateBinary(operator: BinaryOperator, left: ConstantValue, right: ConstantValue, expression: Expression): ConstantValue {
  switch (operator) {
    case "+":
      if (typeof left === "number" && typeof right === "number") {
        return left + right;
      }
      if (typeof left === "string" && typeof right === "string") {
        return left + right;
      }
      throw new DiagnosticError(expression.location, "Operator + requires two numbers or two strings.");
    case "-":
      return numericBinary(operator, left, right, expression, (a, b) => a - b);
    case "*":
      return numericBinary(operator, left, right, expression, (a, b) => a * b);
    case "/":
      if (right === 0) {
        throw new DiagnosticError(expression.location, "Division by zero in constant expression.");
      }
      return numericBinary(operator, left, right, expression, (a, b) => a / b);
    case "=":
      return left === right;
    case "<>":
      return left !== right;
    case "<":
      return comparableBinary(operator, left, right, expression, (a, b) => a < b);
    case "<=":
      return comparableBinary(operator, left, right, expression, (a, b) => a <= b);
    case ">":
      return comparableBinary(operator, left, right, expression, (a, b) => a > b);
    case ">=":
      return comparableBinary(operator, left, right, expression, (a, b) => a >= b);
    case "AND":
      return truthy(left) && truthy(right);
    case "OR":
      return truthy(left) || truthy(right);
  }
}

function numericBinary(
  operator: BinaryOperator,
  left: ConstantValue,
  right: ConstantValue,
  expression: Expression,
  evaluate: (left: number, right: number) => number
): number {
  if (typeof left !== "number" || typeof right !== "number") {
    throw new DiagnosticError(expression.location, `Operator ${operator} requires numeric operands.`);
  }

  return evaluate(left, right);
}

function comparableBinary(
  operator: BinaryOperator,
  left: ConstantValue,
  right: ConstantValue,
  expression: Expression,
  evaluate: (left: number | string, right: number | string) => boolean
): boolean {
  if ((typeof left !== "number" && typeof left !== "string") || typeof left !== typeof right) {
    throw new DiagnosticError(expression.location, `Operator ${operator} requires comparable operands of the same type.`);
  }

  return evaluate(left, right as number | string);
}

function truthy(value: ConstantValue): boolean {
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value.length > 0;
  }
  return value;
}

function isLiteralExpression(expression: Expression): boolean {
  return expression.kind === "number" || expression.kind === "string" || expression.kind === "boolean";
}

function literalFromValue(value: ConstantValue, location: Expression["location"]): Expression {
  if (typeof value === "number") {
    return { kind: "number", value, raw: formatNumber(value), location };
  }
  if (typeof value === "string") {
    return { kind: "string", value, location };
  }
  return { kind: "boolean", value, location };
}

function formatNumber(value: number): string {
  if (Object.is(value, -0)) {
    return "0";
  }
  return Number.isInteger(value) ? value.toString() : value.toString();
}
