import type { BinaryOperator, Expression, Program, Statement, UnaryOperator } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { builtinFunctions, canonicalFunctionName, isStringFunctionName } from "./functions.js";
import { normalizeName } from "./symbols.js";
import type { ColorValue, TargetEnvironment } from "./targets/environment.js";

type ConstantValue = number | string | boolean | ColorValue;

interface ConstantDefinition {
  readonly name: string;
  readonly value: ConstantValue;
  readonly environment: boolean;
}

export function analyzeProgram(program: Program, environment: TargetEnvironment): Program {
  const constants = new Map<string, ConstantDefinition>();
  for (const [key, value] of environment.constants) {
    constants.set(key, { name: key.toUpperCase(), value, environment: true });
  }

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
        const existing = constants.get(key);
        if (existing?.environment) {
          throw new DiagnosticError(statement.location, `Cannot redeclare environment constant "${statement.name}".`);
        }
        if (existing) {
          throw new DiagnosticError(statement.location, `Duplicate constant "${statement.name}".`);
        }

        const value = evaluateConstant(statement.expression, constants);
        constants.set(key, { name: statement.name, value, environment: false });
        break;
      }
      case "cls": {
        if (!statement.color) {
          analyzed.push(statement);
          break;
        }
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "CLS") });
        break;
      }
      case "border-color": {
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "BORDER_COLOR") });
        break;
      }
      case "text-color": {
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "TEXT_COLOR") });
        break;
      }
      case "let": {
        const existing = constants.get(normalizeName(statement.name));
        if (existing?.environment) {
          throw new DiagnosticError(statement.location, `Cannot assign to environment constant "${statement.name}".`);
        }
        if (existing) {
          throw new DiagnosticError(statement.location, `Cannot assign to constant "${statement.name}".`);
        }
        const expression = foldExpression(statement.expression, constants, inConstantExpression);
        if (expression.kind === "color") {
          throw new DiagnosticError(statement.location, "Assignments require a numeric or string expression.");
        }
        if (isStringVariableName(statement.name)) {
          if (expression.kind !== "string" && !isStringExpression(expression)) {
            throw new DiagnosticError(statement.location, "String variable assignments require a string expression.");
          }
        } else if (expression.kind === "string" || isStringExpression(expression)) {
          throw new DiagnosticError(statement.location, "Assignments require a numeric expression.");
        }
        analyzed.push({ ...statement, expression });
        break;
      }
      case "print":
        analyzed.push({
          ...statement,
          items: statement.items.map((item) => rejectColorExpression(foldExpression(item, constants, inConstantExpression), "PRINT")),
          ...(statement.at
            ? {
                at: {
                  ...statement.at,
                  row: foldExpression(statement.at.row, constants, inConstantExpression),
                  column: foldExpression(statement.at.column, constants, inConstantExpression)
                }
              }
            : {})
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

function analyzeColorExpression(expression: Expression, constants: ReadonlyMap<string, ConstantDefinition>, command: string): Extract<Expression, { kind: "color" }> {
  const color = foldExpression(expression, constants, true);
  if (color.kind !== "color") {
    throw new DiagnosticError(expression.location, `${command} colour must be a compile-time portable colour.`);
  }
  return color;
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
    case "color":
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
    case "function-call":
      return foldFunctionCall(expression, constants, unknownIdentifierIsError);
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

function foldFunctionCall(
  expression: Extract<Expression, { kind: "function-call" }>,
  constants: ReadonlyMap<string, ConstantDefinition>,
  unknownIdentifierIsError: boolean
): Expression {
  const name = canonicalFunctionName(expression.name);

  if (name === builtinFunctions.jiffies) {
    if (expression.args.length !== 0) {
      throw new DiagnosticError(expression.location, "JIFFIES expects no arguments.");
    }

    return { ...expression, name, args: [] };
  }

  if (name === builtinFunctions.space) {
    const args = expression.args.map((arg) => evaluateLiteralExpression(foldExpression(arg, constants, true)));
    if (args.length !== 1) {
      throw new DiagnosticError(expression.location, "SPACE$ expects exactly one argument.");
    }
    const count = requireRepeatCount(args[0], expression, "SPACE$");
    return { kind: "string", value: " ".repeat(count), location: expression.location };
  }

  if (name === builtinFunctions.string) {
    const args = expression.args.map((arg) => evaluateLiteralExpression(foldExpression(arg, constants, true)));
    if (args.length !== 2) {
      throw new DiagnosticError(expression.location, "STRING$ expects exactly two arguments.");
    }
    const char = requireSingleCharacterString(args[0], expression, "STRING$");
    const count = requireRepeatCount(args[1], expression, "STRING$");
    return { kind: "string", value: char.repeat(count), location: expression.location };
  }

  if (name === builtinFunctions.mid) {
    if (expression.args.length !== 3) {
      throw new DiagnosticError(expression.location, "MID$ expects exactly three arguments.");
    }
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError);
    const start = foldExpression(expression.args[1], constants, unknownIdentifierIsError);
    const length = foldExpression(expression.args[2], constants, unknownIdentifierIsError);

    if (!isStringExpression(source)) {
      throw new DiagnosticError(expression.args[0].location, "MID$ first argument must be a string expression.");
    }
    if (isStringExpression(start) || start.kind === "color") {
      throw new DiagnosticError(expression.args[1].location, "MID$ start argument must be numeric.");
    }
    if (isStringExpression(length) || length.kind === "color") {
      throw new DiagnosticError(expression.args[2].location, "MID$ length argument must be numeric.");
    }

    return { ...expression, name, args: [source, start, length] };
  }

  if (name === builtinFunctions.len) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, "LEN expects exactly one argument.");
    }
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError);

    if (!isStringExpression(source)) {
      throw new DiagnosticError(expression.args[0].location, "LEN argument must be a string expression.");
    }

    return { ...expression, name, args: [source] };
  }

  throw new DiagnosticError(expression.location, `Unknown function "${expression.name}".`);
}

function requireSingleCharacterString(value: ConstantValue, expression: Expression, functionName: string): string {
  if (typeof value !== "string" || [...value].length !== 1) {
    throw new DiagnosticError(expression.location, `${functionName} first argument must be a string with exactly one character.`);
  }
  return value;
}

function requireRepeatCount(value: ConstantValue, expression: Expression, functionName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new DiagnosticError(expression.location, `${functionName} count must be a non-negative integer.`);
  }
  if (value > 255) {
    throw new DiagnosticError(expression.location, `${functionName} result length must not exceed 255 characters.`);
  }
  return value;
}

function evaluateLiteralExpression(expression: Expression): ConstantValue {
  switch (expression.kind) {
    case "number":
      return expression.value;
    case "string":
      return expression.value;
    case "boolean":
      return expression.value;
    case "color":
      return { kind: "color", color: expression.color };
    case "function-call":
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
      if (isColorValue(value)) {
        throw new DiagnosticError(expression.location, "NOT does not support portable colours.");
      }
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
      if (isColorValue(left) || isColorValue(right)) {
        throw new DiagnosticError(expression.location, "Operator = does not support portable colours.");
      }
      return left === right;
    case "<>":
      if (isColorValue(left) || isColorValue(right)) {
        throw new DiagnosticError(expression.location, "Operator <> does not support portable colours.");
      }
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
      if (isColorValue(left) || isColorValue(right)) {
        throw new DiagnosticError(expression.location, "Operator AND does not support portable colours.");
      }
      return truthy(left) && truthy(right);
    case "OR":
      if (isColorValue(left) || isColorValue(right)) {
        throw new DiagnosticError(expression.location, "Operator OR does not support portable colours.");
      }
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
  if (
    isColorValue(left) ||
    isColorValue(right) ||
    (typeof left !== "number" && typeof left !== "string") ||
    typeof left !== typeof right
  ) {
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
  return value === true;
}

function isLiteralExpression(expression: Expression): boolean {
  return expression.kind === "number" || expression.kind === "string" || expression.kind === "boolean" || expression.kind === "color";
}

function literalFromValue(value: ConstantValue, location: Expression["location"]): Expression {
  if (typeof value === "number") {
    return { kind: "number", value, raw: formatNumber(value), location };
  }
  if (typeof value === "string") {
    return { kind: "string", value, location };
  }
  if (isColorValue(value)) {
    return { kind: "color", color: value.color, location };
  }
  return { kind: "boolean", value, location };
}

function rejectColorExpression(expression: Expression, context: string): Expression {
  if (expression.kind === "color") {
    throw new DiagnosticError(expression.location, `Portable colour ${expression.color} can only be used where a colour is expected, not in ${context}.`);
  }
  return expression;
}

function isStringExpression(expression: Expression): boolean {
  switch (expression.kind) {
    case "string":
      return true;
    case "identifier":
      return isStringVariableName(expression.name);
    case "parenthesized":
      return isStringExpression(expression.expression);
    case "binary":
      return expression.operator === "+" && isStringExpression(expression.left) && isStringExpression(expression.right);
    case "function-call":
      return isStringFunctionName(expression.name);
    case "number":
    case "boolean":
    case "color":
    case "unary":
      return false;
  }
}

function isStringVariableName(name: string): boolean {
  return name.endsWith("$");
}

function isColorValue(value: ConstantValue): value is ColorValue {
  return typeof value === "object" && value.kind === "color";
}

function formatNumber(value: number): string {
  if (Object.is(value, -0)) {
    return "0";
  }
  return Number.isInteger(value) ? value.toString() : value.toString();
}
