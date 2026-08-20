import type { BinaryOperator, Expression, Program, Statement, UnaryOperator } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { builtinFunctions, canonicalFunctionName, isStringFunctionName } from "./functions.js";
import { normalizeName } from "./symbols.js";
import type { ColorValue, TargetEnvironment } from "./targets/environment.js";
import { isIntegerVariableName, isStringVariableName } from "./variables.js";

type ConstantValue = number | string | boolean | ColorValue;

interface ConstantDefinition {
  readonly name: string;
  readonly value: ConstantValue;
  readonly environment: boolean;
}

interface ArrayDefinition {
  readonly name: string;
  readonly valueType: "number" | "string";
  readonly dimensions: readonly number[];
  readonly location: Expression["location"];
}

export function analyzeProgram(program: Program, environment: TargetEnvironment): Program {
  const constants = new Map<string, ConstantDefinition>();
  for (const [key, value] of environment.constants) {
    constants.set(key, { name: key.toUpperCase(), value, environment: true });
  }
  const arrays = new Map<string, ArrayDefinition>();
  const scalarNames = new Set<string>();

  return {
    statements: analyzeStatements(program.statements, constants, false, arrays, scalarNames)
  };
}

function analyzeStatements(
  statements: readonly Statement[],
  constants: Map<string, ConstantDefinition>,
  inConstantExpression: boolean,
  arrays: Map<string, ArrayDefinition>,
  scalarNames: Set<string>
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
      case "dim": {
        const key = normalizeName(statement.name);
        if (constants.has(key)) {
          throw new DiagnosticError(statement.location, `Cannot declare array "${statement.name}" with the same name as a constant.`);
        }
        if (arrays.has(key)) {
          throw new DiagnosticError(statement.location, `Duplicate array "${statement.name}".`);
        }
        if (scalarNames.has(key)) {
          throw new DiagnosticError(statement.location, `Cannot declare array "${statement.name}" after using it as a scalar variable.`);
        }
        if (canonicalFunctionName(statement.name)) {
          throw new DiagnosticError(statement.location, `Cannot declare array "${statement.name}" with the same name as a built-in function.`);
        }
        if (statement.dimensions.length === 0) {
          throw new DiagnosticError(statement.location, "DIM requires at least one dimension.");
        }

        const dimensions = statement.dimensions.map((dimension) => requireArrayDimension(dimension, constants));
        if (isStringVariableName(statement.name) && dimensions.length !== 2) {
          throw new DiagnosticError(statement.location, "String arrays require element count and fixed width, for example DIM NAME$(10, 32).");
        }
        arrays.set(key, { name: statement.name, valueType: isStringVariableName(statement.name) ? "string" : "number", dimensions, location: statement.location });
        analyzed.push({
          ...statement,
          dimensions: dimensions.map((dimension) => ({ kind: "number", value: dimension, raw: dimension.toString(), location: statement.location }))
        });
        break;
      }
      case "cls": {
        if (!statement.color) {
          analyzed.push(statement);
          break;
        }
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "CLS", arrays) });
        break;
      }
      case "border-color": {
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "BORDER_COLOR", arrays) });
        break;
      }
      case "text-color": {
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "TEXT_COLOR", arrays) });
        break;
      }
      case "screen-background-color": {
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "SCREEN_BACKGROUND_COLOR", arrays) });
        break;
      }
      case "cell-text-color": {
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "CELL_TEXT_COLOR", arrays) });
        break;
      }
      case "cell-background-color": {
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "CELL_BACKGROUND_COLOR", arrays) });
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
        if (arrays.has(normalizeName(statement.name))) {
          throw new DiagnosticError(statement.location, `Cannot assign scalar value to array "${statement.name}".`);
        }
        scalarNames.add(normalizeName(statement.name));
        const expression = foldExpression(statement.expression, constants, inConstantExpression, arrays);
        if (expression.kind === "color") {
          throw new DiagnosticError(statement.location, "Assignments require a numeric or string expression.");
        }
        if (isStringVariableName(statement.name)) {
          if (expression.kind !== "string" && !isStringExpression(expression)) {
            throw new DiagnosticError(statement.location, "String variable assignments require a string expression.");
          }
        } else if (isIntegerVariableName(statement.name)) {
          if (expression.kind === "string" || isStringExpression(expression)) {
            throw new DiagnosticError(statement.location, "Integer variable assignments require a numeric expression.");
          }
          analyzed.push({ ...statement, expression: intCoercion(expression, statement.location) });
          break;
        } else if (expression.kind === "string" || isStringExpression(expression)) {
          throw new DiagnosticError(statement.location, "Assignments require a numeric expression.");
        }
        analyzed.push({ ...statement, expression });
        break;
      }
      case "array-let": {
        const definition = arrays.get(normalizeName(statement.name));
        if (!definition) {
          throw new DiagnosticError(statement.location, `Array "${statement.name}" must be declared with DIM before use.`);
        }
        const indices = analyzeArrayIndices(statement.name, statement.indices, definition, constants, inConstantExpression, arrays);
        const expression = foldExpression(statement.expression, constants, inConstantExpression, arrays);
        if (definition.valueType === "string") {
          if (expression.kind === "color" || !isStringExpression(expression)) {
            throw new DiagnosticError(statement.location, "String array assignments require a string expression.");
          }
          validateStringArrayAssignmentLength(statement.name, expression, definition);
          analyzed.push({ ...statement, indices, expression });
          break;
        }
        if (expression.kind === "color") {
          throw new DiagnosticError(statement.location, "Array assignments require a numeric expression.");
        }
        if (expression.kind === "string" || isStringExpression(expression)) {
          throw new DiagnosticError(statement.location, "Array assignments require a numeric expression.");
        }
        analyzed.push({
          ...statement,
          indices,
          expression: isIntegerVariableName(statement.name) ? intCoercion(expression, statement.location) : expression
        });
        break;
      }
      case "print":
        analyzed.push({
          ...statement,
          items: statement.items.map((item) => rejectColorExpression(foldExpression(item, constants, inConstantExpression, arrays), "PRINT")),
          ...(statement.at
            ? {
                at: {
                  ...statement.at,
                  row: foldExpression(statement.at.row, constants, inConstantExpression, arrays),
                  column: foldExpression(statement.at.column, constants, inConstantExpression, arrays)
                }
              }
            : {})
        });
        break;
      case "if":
        analyzed.push({
          ...statement,
          condition: foldExpression(statement.condition, constants, inConstantExpression, arrays),
          thenBranch: analyzeStatements(statement.thenBranch, constants, inConstantExpression, arrays, scalarNames),
          elseBranch: analyzeStatements(statement.elseBranch, constants, inConstantExpression, arrays, scalarNames)
        });
        break;
      case "for": {
        const existing = constants.get(normalizeName(statement.variable));
        if (existing?.environment) {
          throw new DiagnosticError(statement.location, `Cannot use environment constant "${statement.variable}" as a FOR loop variable.`);
        }
        if (existing) {
          throw new DiagnosticError(statement.location, `Cannot use constant "${statement.variable}" as a FOR loop variable.`);
        }
        if (isStringVariableName(statement.variable)) {
          throw new DiagnosticError(statement.location, "FOR loop variable must be numeric.");
        }
        if (isIntegerVariableName(statement.variable)) {
          throw new DiagnosticError(statement.location, "FOR loop variable cannot be an integer variable yet.");
        }

        scalarNames.add(normalizeName(statement.variable));
        const start = requireNumericExpression(foldExpression(statement.start, constants, inConstantExpression, arrays), "FOR start value");
        const limit = requireNumericExpression(foldExpression(statement.limit, constants, inConstantExpression, arrays), "FOR limit value");
        const step = statement.step ? requireNumericExpression(foldExpression(statement.step, constants, inConstantExpression, arrays), "FOR STEP value") : undefined;
        analyzed.push({
          ...statement,
          start,
          limit,
          ...(step ? { step } : {}),
          body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, scalarNames)
        });
        break;
      }
      case "while":
        analyzed.push({
          ...statement,
          condition: foldExpression(statement.condition, constants, inConstantExpression, arrays),
          body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, scalarNames)
        });
        break;
      case "repeat-until":
        analyzed.push({
          ...statement,
          body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, scalarNames),
          condition: foldExpression(statement.condition, constants, inConstantExpression, arrays)
        });
        break;
      case "label":
      case "goto":
      case "gosub":
      case "return":
        analyzed.push(statement);
        break;
    }
  }

  return analyzed;
}

function requireNumericExpression(expression: Expression, context: string): Expression {
  if (expression.kind === "color" || isStringExpression(expression)) {
    throw new DiagnosticError(expression.location, `${context} must be numeric.`);
  }
  return expression;
}

function requireArrayDimension(expression: Expression, constants: ReadonlyMap<string, ConstantDefinition>): number {
  const folded = foldExpression(expression, constants, true);
  const value = evaluateLiteralExpression(folded);
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new DiagnosticError(expression.location, "Array dimensions must be positive integers.");
  }
  return value;
}

function analyzeArrayIndices(
  name: string,
  indices: readonly Expression[],
  definition: ArrayDefinition,
  constants: ReadonlyMap<string, ConstantDefinition>,
  inConstantExpression: boolean,
  arrays: ReadonlyMap<string, ArrayDefinition>
): readonly Expression[] {
  const expectedIndexCount = definition.valueType === "string" ? definition.dimensions.length - 1 : definition.dimensions.length;
  if (indices.length !== expectedIndexCount) {
    throw new DiagnosticError(
      indices[0]?.location ?? definition.location,
      `Array "${name}" expects ${expectedIndexCount} index expression${expectedIndexCount === 1 ? "" : "s"}.`
    );
  }

  return indices.map((index, position) => {
    const folded = requireNumericExpression(foldExpression(index, constants, inConstantExpression, arrays), "Array index");
    if (folded.kind === "number") {
      const upperExclusive = definition.dimensions[position];
      if (!Number.isInteger(folded.value) || folded.value < 0 || folded.value >= upperExclusive) {
        throw new DiagnosticError(
          folded.location,
          `Array "${name}" index ${formatNumber(folded.value)} is outside the supported range 0..${upperExclusive - 1}.`
        );
      }
    }
    return folded;
  });
}

function validateStringArrayAssignmentLength(name: string, expression: Expression, definition: ArrayDefinition): void {
  if (expression.kind !== "string") {
    return;
  }
  const width = definition.dimensions[definition.dimensions.length - 1];
  if ([...expression.value].length > width) {
    throw new DiagnosticError(expression.location, `String array "${name}" element width is ${width}, but assigned string has length ${[...expression.value].length}.`);
  }
}

function intCoercion(expression: Expression, location: Expression["location"]): Expression {
  return {
    kind: "function-call",
    name: builtinFunctions.int,
    args: [expression],
    location
  };
}

function analyzeColorExpression(
  expression: Expression,
  constants: ReadonlyMap<string, ConstantDefinition>,
  command: string,
  arrays: ReadonlyMap<string, ArrayDefinition>
): Extract<Expression, { kind: "color" }> {
  const color = foldExpression(expression, constants, true, arrays);
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
  unknownIdentifierIsError: boolean,
  arrays: ReadonlyMap<string, ArrayDefinition> = new Map()
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
    case "array-access": {
      const definition = arrays.get(normalizeName(expression.name));
      if (!definition) {
        throw new DiagnosticError(expression.location, `Array "${expression.name}" must be declared with DIM before use.`);
      }
      return {
        ...expression,
        valueType: definition.valueType,
        indices: analyzeArrayIndices(expression.name, expression.indices, definition, constants, unknownIdentifierIsError, arrays)
      };
    }
    case "function-call":
      return foldFunctionCall(expression, constants, unknownIdentifierIsError, arrays);
    case "parenthesized": {
      const folded = foldExpression(expression.expression, constants, unknownIdentifierIsError, arrays);
      if (isLiteralExpression(folded)) {
        return folded;
      }
      return { ...expression, expression: folded };
    }
    case "unary": {
      const operand = foldExpression(expression.operand, constants, unknownIdentifierIsError, arrays);
      if (isLiteralExpression(operand)) {
        return literalFromValue(evaluateUnary(expression.operator, evaluateLiteralExpression(operand), expression), expression.location);
      }
      return { ...expression, operand };
    }
    case "binary": {
      const left = foldExpression(expression.left, constants, unknownIdentifierIsError, arrays);
      const right = foldExpression(expression.right, constants, unknownIdentifierIsError, arrays);
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
  unknownIdentifierIsError: boolean,
  arrays: ReadonlyMap<string, ArrayDefinition>
): Expression {
  const name = canonicalFunctionName(expression.name);

  if (!name) {
    const definition = arrays.get(normalizeName(expression.name));
    if (definition) {
      return {
        kind: "array-access",
        name: expression.name,
        valueType: definition.valueType,
        indices: analyzeArrayIndices(expression.name, expression.args, definition, constants, unknownIdentifierIsError, arrays),
        location: expression.location
      };
    }
  }

  if (name === builtinFunctions.jiffies) {
    if (expression.args.length !== 0) {
      throw new DiagnosticError(expression.location, "JIFFIES expects no arguments.");
    }

    return { ...expression, name, args: [] };
  }

  if (name === builtinFunctions.keyCode) {
    if (expression.args.length !== 0) {
      throw new DiagnosticError(expression.location, "KEY_CODE expects no arguments.");
    }

    return { ...expression, name, args: [] };
  }

  if (name === builtinFunctions.chr) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, "CHR$ expects exactly one argument.");
    }
    const code = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays);

    if (isStringExpression(code) || code.kind === "color") {
      throw new DiagnosticError(expression.args[0].location, "CHR$ argument must be numeric.");
    }

    return { ...expression, name, args: [code] };
  }

  if (name === builtinFunctions.code) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, "CODE expects exactly one argument.");
    }
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays);

    if (!isStringExpression(source)) {
      throw new DiagnosticError(expression.args[0].location, "CODE argument must be a string expression.");
    }

    return { ...expression, name, args: [source] };
  }

  if (name && isNumericRuntimeFunctionName(name)) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, `${name} expects exactly one argument.`);
    }
    const value = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays);

    if (isStringExpression(value) || value.kind === "color") {
      throw new DiagnosticError(expression.args[0].location, `${name} argument must be numeric.`);
    }

    return { ...expression, name, args: [value] };
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
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays);
    const start = foldExpression(expression.args[1], constants, unknownIdentifierIsError, arrays);
    const length = foldExpression(expression.args[2], constants, unknownIdentifierIsError, arrays);

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
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays);

    if (!isStringExpression(source)) {
      throw new DiagnosticError(expression.args[0].location, "LEN argument must be a string expression.");
    }

    return { ...expression, name, args: [source] };
  }

  throw new DiagnosticError(expression.location, `Unknown function "${expression.name}".`);
}

function isNumericRuntimeFunctionName(name: string): boolean {
  return (
    name === builtinFunctions.abs ||
    name === builtinFunctions.atn ||
    name === builtinFunctions.cos ||
    name === builtinFunctions.exp ||
    name === builtinFunctions.int ||
    name === builtinFunctions.sgn ||
    name === builtinFunctions.sin ||
    name === builtinFunctions.sqr
  );
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
    case "array-access":
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
    case "array-access":
      return expression.valueType === "string";
    case "number":
    case "boolean":
    case "color":
    case "unary":
      return false;
  }
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
