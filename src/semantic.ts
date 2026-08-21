import type { BinaryOperator, Expression, FunctionImplementation, Program, SourceLocation, Statement, UnaryOperator } from "./ast.js";
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

interface FunctionDefinition {
  readonly name: string;
  readonly key: string;
  readonly valueType: "number" | "string";
  readonly implementation: FunctionImplementation;
  readonly statement: Extract<Statement, { kind: "function" }>;
}

interface FunctionScope {
  readonly functionName: string;
  readonly returnName: string;
  readonly variables: ReadonlyMap<string, string>;
  readonly labels: ReadonlyMap<string, string>;
}

export function analyzeProgram(program: Program, environment: TargetEnvironment): Program {
  const constants = new Map<string, ConstantDefinition>();
  for (const [key, value] of environment.constants) {
    constants.set(key, { name: key.toUpperCase(), value, environment: true });
  }
  const arrays = new Map<string, ArrayDefinition>();
  const scalarNames = new Set<string>();
  const functions = collectFunctionDefinitions(program.statements);
  validateFunctionRecursion(functions);
  validateControlFlowBoundaries(program.statements);

  return {
    statements: analyzeStatements(program.statements, constants, false, arrays, scalarNames, functions)
  };
}

function analyzeStatements(
  statements: readonly Statement[],
  constants: Map<string, ConstantDefinition>,
  inConstantExpression: boolean,
  arrays: Map<string, ArrayDefinition>,
  scalarNames: Set<string>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  scope?: FunctionScope
): readonly Statement[] {
  const analyzed: Statement[] = [];

  for (const statement of statements) {
    switch (statement.kind) {
      case "function": {
        if (scope) {
          throw new DiagnosticError(statement.location, "Nested FUNCTION declarations are not supported.");
        }
        const definition = functions.get(normalizeName(statement.name));
        if (!definition) {
          throw new DiagnosticError(statement.location, `Internal error: missing function definition for "${statement.name}".`);
        }
        analyzed.push(analyzeFunction(definition, constants, arrays, scalarNames, functions));
        break;
      }
      case "local":
        if (!scope) {
          throw new DiagnosticError(statement.location, "LOCAL can only be used inside a FUNCTION.");
        }
        break;
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
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "CLS", arrays, functions, scope) });
        break;
      }
      case "border-color": {
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "BORDER_COLOR", arrays, functions, scope) });
        break;
      }
      case "text-color": {
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "TEXT_COLOR", arrays, functions, scope) });
        break;
      }
      case "screen-background-color": {
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "SCREEN_BACKGROUND_COLOR", arrays, functions, scope) });
        break;
      }
      case "cell-text-color": {
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "CELL_TEXT_COLOR", arrays, functions, scope) });
        break;
      }
      case "cell-background-color": {
        analyzed.push({ ...statement, color: analyzeColorExpression(statement.color, constants, "CELL_BACKGROUND_COLOR", arrays, functions, scope) });
        break;
      }
      case "let": {
        const targetName = resolveScopedName(statement.name, scope);
        const isScopedVariable = scope?.variables.has(normalizeName(statement.name)) ?? false;
        if (!isScopedVariable) {
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
        }
        const expression = foldExpression(statement.expression, constants, inConstantExpression, arrays, functions, scope);
        if (expression.kind === "color") {
          throw new DiagnosticError(statement.location, "Assignments require a numeric or string expression.");
        }
        if (isStringVariableName(targetName)) {
          if (expression.kind !== "string" && !isStringExpression(expression)) {
            throw new DiagnosticError(statement.location, "String variable assignments require a string expression.");
          }
        } else if (isIntegerVariableName(targetName)) {
          if (expression.kind === "string" || isStringExpression(expression)) {
            throw new DiagnosticError(statement.location, "Integer variable assignments require a numeric expression.");
          }
          analyzed.push({ ...statement, name: targetName, expression: intCoercion(expression, statement.location) });
          break;
        } else if (expression.kind === "string" || isStringExpression(expression)) {
          throw new DiagnosticError(statement.location, "Assignments require a numeric expression.");
        }
        analyzed.push({ ...statement, name: targetName, expression });
        break;
      }
      case "array-let": {
        const definition = arrays.get(normalizeName(statement.name));
        if (!definition) {
          throw new DiagnosticError(statement.location, `Array "${statement.name}" must be declared with DIM before use.`);
        }
        const indices = analyzeArrayIndices(statement.name, statement.indices, definition, constants, inConstantExpression, arrays, functions, scope);
        const expression = foldExpression(statement.expression, constants, inConstantExpression, arrays, functions, scope);
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
          items: statement.items.map((item) => rejectColorExpression(foldExpression(item, constants, inConstantExpression, arrays, functions, scope), "PRINT")),
          ...(statement.at
            ? {
                at: {
                  ...statement.at,
                  row: foldExpression(statement.at.row, constants, inConstantExpression, arrays, functions, scope),
                  column: foldExpression(statement.at.column, constants, inConstantExpression, arrays, functions, scope)
                }
              }
            : {})
        });
        break;
      case "if":
        analyzed.push({
          ...statement,
          condition: foldExpression(statement.condition, constants, inConstantExpression, arrays, functions, scope),
          thenBranch: analyzeStatements(statement.thenBranch, constants, inConstantExpression, arrays, scalarNames, functions, scope),
          elseBranch: analyzeStatements(statement.elseBranch, constants, inConstantExpression, arrays, scalarNames, functions, scope)
        });
        break;
      case "for": {
        const isScopedVariable = scope?.variables.has(normalizeName(statement.variable)) ?? false;
        if (!isScopedVariable) {
          const existing = constants.get(normalizeName(statement.variable));
          if (existing?.environment) {
            throw new DiagnosticError(statement.location, `Cannot use environment constant "${statement.variable}" as a FOR loop variable.`);
          }
          if (existing) {
            throw new DiagnosticError(statement.location, `Cannot use constant "${statement.variable}" as a FOR loop variable.`);
          }
          scalarNames.add(normalizeName(statement.variable));
        }
        if (isStringVariableName(statement.variable)) {
          throw new DiagnosticError(statement.location, "FOR loop variable must be numeric.");
        }
        if (isIntegerVariableName(statement.variable)) {
          throw new DiagnosticError(statement.location, "FOR loop variable cannot be an integer variable yet.");
        }

        const loopVariable = resolveScopedName(statement.variable, scope);
        const start = requireNumericExpression(foldExpression(statement.start, constants, inConstantExpression, arrays, functions, scope), "FOR start value");
        const limit = requireNumericExpression(foldExpression(statement.limit, constants, inConstantExpression, arrays, functions, scope), "FOR limit value");
        const step = statement.step
          ? requireNumericExpression(foldExpression(statement.step, constants, inConstantExpression, arrays, functions, scope), "FOR STEP value")
          : undefined;
        analyzed.push({
          ...statement,
          variable: loopVariable,
          start,
          limit,
          ...(step ? { step } : {}),
          body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, scalarNames, functions, scope)
        });
        break;
      }
      case "while":
        analyzed.push({
          ...statement,
          condition: foldExpression(statement.condition, constants, inConstantExpression, arrays, functions, scope),
          body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, scalarNames, functions, scope)
        });
        break;
      case "repeat-until":
        analyzed.push({
          ...statement,
          body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, scalarNames, functions, scope),
          condition: foldExpression(statement.condition, constants, inConstantExpression, arrays, functions, scope)
        });
        break;
      case "label":
        analyzed.push(scope ? { ...statement, name: resolveScopedLabel(statement.name, scope) } : statement);
        break;
      case "goto":
      case "gosub":
        analyzed.push(scope ? { ...statement, label: resolveScopedLabel(statement.label, scope) } : statement);
        break;
      case "return":
        if (scope) {
          if (!statement.expression) {
            throw new DiagnosticError(statement.location, `RETURN inside FUNCTION ${scope.functionName} requires an expression.`);
          }
          analyzed.push({
            ...statement,
            expression: foldExpression(statement.expression, constants, inConstantExpression, arrays, functions, scope)
          });
          break;
        }
        if (statement.expression) {
          throw new DiagnosticError(statement.location, "RETURN with an expression can only be used inside a FUNCTION.");
        }
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
  arrays: ReadonlyMap<string, ArrayDefinition>,
  functions: ReadonlyMap<string, FunctionDefinition> = new Map(),
  scope?: FunctionScope
): readonly Expression[] {
  const expectedIndexCount = definition.valueType === "string" ? definition.dimensions.length - 1 : definition.dimensions.length;
  if (indices.length !== expectedIndexCount) {
    throw new DiagnosticError(
      indices[0]?.location ?? definition.location,
      `Array "${name}" expects ${expectedIndexCount} index expression${expectedIndexCount === 1 ? "" : "s"}.`
    );
  }

  return indices.map((index, position) => {
    const folded = requireNumericExpression(foldExpression(index, constants, inConstantExpression, arrays, functions, scope), "Array index");
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
  arrays: ReadonlyMap<string, ArrayDefinition>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  scope?: FunctionScope
): Extract<Expression, { kind: "color" }> {
  const color = foldExpression(expression, constants, true, arrays, functions, scope);
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
  arrays: ReadonlyMap<string, ArrayDefinition> = new Map(),
  functions: ReadonlyMap<string, FunctionDefinition> = new Map(),
  scope?: FunctionScope
): Expression {
  switch (expression.kind) {
    case "number":
    case "string":
    case "boolean":
    case "color":
      return expression;
    case "identifier": {
      const scopedName = scope?.variables.get(normalizeName(expression.name));
      if (scopedName) {
        return { ...expression, name: scopedName };
      }
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
        indices: analyzeArrayIndices(expression.name, expression.indices, definition, constants, unknownIdentifierIsError, arrays, functions, scope)
      };
    }
    case "function-call":
      return foldFunctionCall(expression, constants, unknownIdentifierIsError, arrays, functions, scope);
    case "parenthesized": {
      const folded = foldExpression(expression.expression, constants, unknownIdentifierIsError, arrays, functions, scope);
      if (isLiteralExpression(folded)) {
        return folded;
      }
      return { ...expression, expression: folded };
    }
    case "unary": {
      const operand = foldExpression(expression.operand, constants, unknownIdentifierIsError, arrays, functions, scope);
      if (isLiteralExpression(operand)) {
        return literalFromValue(evaluateUnary(expression.operator, evaluateLiteralExpression(operand), expression), expression.location);
      }
      return { ...expression, operand };
    }
    case "binary": {
      const left = foldExpression(expression.left, constants, unknownIdentifierIsError, arrays, functions, scope);
      const right = foldExpression(expression.right, constants, unknownIdentifierIsError, arrays, functions, scope);
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
  arrays: ReadonlyMap<string, ArrayDefinition>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  scope?: FunctionScope
): Expression {
  const name = canonicalFunctionName(expression.name);

  if (!name) {
    const functionDefinition = functions.get(normalizeName(expression.name));
    if (functionDefinition) {
      if (expression.args.length !== functionDefinition.implementation.parameters.length) {
        throw new DiagnosticError(
          expression.location,
          `FUNCTION ${functionDefinition.name} expects ${functionDefinition.implementation.parameters.length} argument${functionDefinition.implementation.parameters.length === 1 ? "" : "s"}.`
        );
      }
      return {
        ...expression,
        name: functionDefinition.name,
        valueType: functionDefinition.valueType,
        args: expression.args.map((arg) => foldExpression(arg, constants, unknownIdentifierIsError, arrays, functions, scope))
      };
    }

    const definition = arrays.get(normalizeName(expression.name));
    if (definition) {
      return {
        kind: "array-access",
        name: expression.name,
        valueType: definition.valueType,
        indices: analyzeArrayIndices(expression.name, expression.args, definition, constants, unknownIdentifierIsError, arrays, functions, scope),
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
    const code = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope);

    if (isStringExpression(code) || code.kind === "color") {
      throw new DiagnosticError(expression.args[0].location, "CHR$ argument must be numeric.");
    }

    return { ...expression, name, args: [code] };
  }

  if (name === builtinFunctions.code) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, "CODE expects exactly one argument.");
    }
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope);

    if (!isStringExpression(source)) {
      throw new DiagnosticError(expression.args[0].location, "CODE argument must be a string expression.");
    }

    return { ...expression, name, args: [source] };
  }

  if (name && isNumericRuntimeFunctionName(name)) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, `${name} expects exactly one argument.`);
    }
    const value = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope);

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
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope);
    const start = foldExpression(expression.args[1], constants, unknownIdentifierIsError, arrays, functions, scope);
    const length = foldExpression(expression.args[2], constants, unknownIdentifierIsError, arrays, functions, scope);

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
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope);

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
      return expression.valueType === "string" || isStringFunctionName(expression.name);
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

function analyzeFunction(
  definition: FunctionDefinition,
  constants: Map<string, ConstantDefinition>,
  arrays: Map<string, ArrayDefinition>,
  scalarNames: Set<string>,
  functions: ReadonlyMap<string, FunctionDefinition>
): Statement {
  const scope = createFunctionScope(definition);
  const body = analyzeStatements(definition.statement.body, constants, false, arrays, scalarNames, functions, scope);
  if (!containsFunctionReturn(body)) {
    throw new DiagnosticError(definition.statement.location, `FUNCTION ${definition.name} must contain RETURN expression.`);
  }
  return {
    ...definition.statement,
    parameters: definition.statement.parameters,
    body,
    implementation: definition.implementation
  };
}

function createFunctionScope(definition: FunctionDefinition): FunctionScope {
  const variables = new Map<string, string>();
  for (const parameter of definition.implementation.parameters) {
    variables.set(normalizeName(parameter.sourceName), parameter.storageName);
  }
  for (const local of definition.implementation.locals) {
    variables.set(normalizeName(local.sourceName), local.storageName);
  }

  const labels = new Map<string, string>();
  collectLabels(definition.statement.body, labels);
  for (const [key, label] of labels) {
    labels.set(key, functionLabelName(definition.implementation.entryLabel, label));
  }

  return {
    functionName: definition.name,
    returnName: definition.implementation.returnName,
    variables,
    labels
  };
}

function resolveScopedName(name: string, scope?: FunctionScope): string {
  return scope?.variables.get(normalizeName(name)) ?? name;
}

function resolveScopedLabel(label: string, scope: FunctionScope): string {
  return scope.labels.get(normalizeName(label)) ?? label;
}

function containsFunctionReturn(statements: readonly Statement[]): boolean {
  return statements.some((statement) => {
    if (statement.kind === "return" && statement.expression) {
      return true;
    }
    if (statement.kind === "if") {
      return containsFunctionReturn(statement.thenBranch) || containsFunctionReturn(statement.elseBranch);
    }
    if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      return containsFunctionReturn(statement.body);
    }
    return false;
  });
}

function collectFunctionDefinitions(statements: readonly Statement[]): ReadonlyMap<string, FunctionDefinition> {
  const functions = new Map<string, FunctionDefinition>();
  let nextId = 1;

  for (const statement of statements) {
    if (statement.kind !== "function") {
      continue;
    }

    const key = normalizeName(statement.name);
    if (canonicalFunctionName(statement.name)) {
      throw new DiagnosticError(statement.location, `Cannot declare FUNCTION "${statement.name}" with the same name as a built-in function.`);
    }
    if (functions.has(key)) {
      throw new DiagnosticError(statement.location, `Duplicate FUNCTION "${statement.name}".`);
    }

    const id = nextId;
    nextId += 1;
    const locals = collectLocalNames(statement);
    validateScopedNames(statement, locals);
    const implementation: FunctionImplementation = {
      entryLabel: `MBF${id}ENTRY`,
      returnName: `MBF${id}R${isStringVariableName(statement.name) ? "$" : ""}`,
      parameters: statement.parameters.map((parameter, index) => ({
        sourceName: parameter,
        storageName: storageName(id, "P", index + 1, parameter)
      })),
      locals: locals.map((local, index) => ({
        sourceName: local,
        storageName: storageName(id, "L", index + 1, local)
      }))
    };

    functions.set(key, {
      name: statement.name,
      key,
      valueType: isStringVariableName(statement.name) ? "string" : "number",
      implementation,
      statement
    });
  }

  return functions;
}

function collectLocalNames(statement: Extract<Statement, { kind: "function" }>): readonly string[] {
  const locals: string[] = [];
  collectLocalsFromStatements(statement.body, locals);
  return locals;
}

function collectLocalsFromStatements(statements: readonly Statement[], locals: string[]): void {
  for (const statement of statements) {
    if (statement.kind === "local") {
      locals.push(...statement.names);
      continue;
    }
    if (statement.kind === "function") {
      continue;
    }
    if (statement.kind === "if") {
      collectLocalsFromStatements(statement.thenBranch, locals);
      collectLocalsFromStatements(statement.elseBranch, locals);
    } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      collectLocalsFromStatements(statement.body, locals);
    }
  }
}

function validateScopedNames(statement: Extract<Statement, { kind: "function" }>, locals: readonly string[]): void {
  const seen = new Map<string, SourceLocation>();
  for (const name of statement.parameters) {
    addScopedName(name, statement.location, seen, "parameter");
  }
  for (const name of locals) {
    addScopedName(name, statement.location, seen, "local variable");
  }
}

function addScopedName(name: string, location: SourceLocation, seen: Map<string, SourceLocation>, kind: string): void {
  const key = normalizeName(name);
  const existing = seen.get(key);
  if (existing) {
    throw new DiagnosticError(location, `Duplicate ${kind} "${name}" first declared at ${existing.filename}:${existing.line}.`);
  }
  seen.set(key, location);
}

function storageName(functionId: number, kind: "P" | "L", index: number, sourceName: string): string {
  const suffix = isStringVariableName(sourceName) ? "$" : isIntegerVariableName(sourceName) ? "%" : "";
  return `MBF${functionId}${kind}${index}${suffix}`;
}

function functionLabelName(entryLabel: string, label: string): string {
  return `${entryLabel}${sanitizeLabel(label)}`;
}

function sanitizeLabel(label: string): string {
  const clean = label.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  return clean.length > 0 ? clean : "LABEL";
}

function validateControlFlowBoundaries(statements: readonly Statement[]): void {
  const topLevelLabels = collectLabels(statements.filter((statement) => statement.kind !== "function"));
  const functionLabelSets = statements
    .filter((statement): statement is Extract<Statement, { kind: "function" }> => statement.kind === "function")
    .map((statement) => collectLabels(statement.body));
  const allFunctionLabels = mergeLabelSets(functionLabelSets);
  validateLabelReferences(statements.filter((statement) => statement.kind !== "function"), topLevelLabels, allFunctionLabels);

  for (const statement of statements) {
    if (statement.kind !== "function") {
      continue;
    }
    const functionLabels = collectLabels(statement.body);
    const forbiddenLabels = mergeLabelSets([topLevelLabels, ...functionLabelSets.filter((labels) => labels !== functionLabels)]);
    validateLabelReferences(statement.body, functionLabels, forbiddenLabels);
  }
}

function mergeLabelSets(labelSets: readonly ReadonlyMap<string, string>[]): ReadonlyMap<string, string> {
  const merged = new Map<string, string>();
  for (const labels of labelSets) {
    for (const [key, label] of labels) {
      merged.set(key, label);
    }
  }
  return merged;
}

function collectLabels(statements: readonly Statement[], labels = new Map<string, string>()): Map<string, string> {
  for (const statement of statements) {
    if (statement.kind === "label") {
      labels.set(normalizeName(statement.name), statement.name);
    } else if (statement.kind === "if") {
      collectLabels(statement.thenBranch, labels);
      collectLabels(statement.elseBranch, labels);
    } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      collectLabels(statement.body, labels);
    }
  }
  return labels;
}

function validateLabelReferences(statements: readonly Statement[], labels: ReadonlyMap<string, string>, forbiddenLabels: ReadonlyMap<string, string>): void {
  for (const statement of statements) {
    if (statement.kind === "goto" || statement.kind === "gosub") {
      const key = normalizeName(statement.label);
      if (!labels.has(key) && forbiddenLabels.has(key)) {
        throw new DiagnosticError(statement.location, `${statement.kind.toUpperCase()} ${statement.label} cannot cross a FUNCTION boundary.`);
      }
      continue;
    }
    if (statement.kind === "if") {
      validateLabelReferences(statement.thenBranch, labels, forbiddenLabels);
      validateLabelReferences(statement.elseBranch, labels, forbiddenLabels);
    } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      validateLabelReferences(statement.body, labels, forbiddenLabels);
    }
  }
}

function validateFunctionRecursion(functions: ReadonlyMap<string, FunctionDefinition>): void {
  const graph = new Map<string, readonly string[]>();
  for (const [key, definition] of functions) {
    const calls = new Set<string>();
    collectFunctionCallsFromStatements(definition.statement.body, functions, calls);
    graph.set(key, [...calls]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (key: string): void => {
    if (visited.has(key)) {
      return;
    }
    if (visiting.has(key)) {
      const start = stack.indexOf(key);
      const cycle = [...stack.slice(start), key].map((cycleKey) => functions.get(cycleKey)?.name ?? cycleKey).join(" -> ");
      throw new DiagnosticError(functions.get(key)?.statement.location ?? { filename: "<unknown>", line: 1 }, `Recursive function calls are not supported: ${cycle}.`);
    }

    visiting.add(key);
    stack.push(key);
    for (const next of graph.get(key) ?? []) {
      visit(next);
    }
    stack.pop();
    visiting.delete(key);
    visited.add(key);
  };

  for (const key of functions.keys()) {
    visit(key);
  }
}

function collectFunctionCallsFromStatements(
  statements: readonly Statement[],
  functions: ReadonlyMap<string, FunctionDefinition>,
  calls: Set<string>
): void {
  for (const statement of statements) {
    for (const expression of statementExpressions(statement)) {
      collectFunctionCalls(expression, functions, calls);
    }
    if (statement.kind === "if") {
      collectFunctionCallsFromStatements(statement.thenBranch, functions, calls);
      collectFunctionCallsFromStatements(statement.elseBranch, functions, calls);
    } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      collectFunctionCallsFromStatements(statement.body, functions, calls);
    }
  }
}

function statementExpressions(statement: Statement): readonly Expression[] {
  switch (statement.kind) {
    case "const":
      return [statement.expression];
    case "dim":
      return statement.dimensions;
    case "cls":
      return statement.color ? [statement.color] : [];
    case "border-color":
    case "text-color":
    case "screen-background-color":
    case "cell-text-color":
    case "cell-background-color":
      return [statement.color];
    case "print":
      return [...(statement.at ? [statement.at.row, statement.at.column] : []), ...statement.items];
    case "let":
      return [statement.expression];
    case "array-let":
      return [...statement.indices, statement.expression];
    case "return":
      return statement.expression ? [statement.expression] : [];
    case "for":
      return [statement.start, statement.limit, ...(statement.step ? [statement.step] : [])];
    case "while":
      return [statement.condition];
    case "repeat-until":
      return [statement.condition];
    case "if":
      return [statement.condition];
    case "label":
    case "goto":
    case "gosub":
    case "local":
    case "function":
      return [];
  }
}

function collectFunctionCalls(expression: Expression, functions: ReadonlyMap<string, FunctionDefinition>, calls: Set<string>): void {
  switch (expression.kind) {
    case "function-call": {
      const key = normalizeName(expression.name);
      if (functions.has(key)) {
        calls.add(key);
      }
      for (const arg of expression.args) {
        collectFunctionCalls(arg, functions, calls);
      }
      break;
    }
    case "array-access":
      for (const index of expression.indices) {
        collectFunctionCalls(index, functions, calls);
      }
      break;
    case "parenthesized":
      collectFunctionCalls(expression.expression, functions, calls);
      break;
    case "unary":
      collectFunctionCalls(expression.operand, functions, calls);
      break;
    case "binary":
      collectFunctionCalls(expression.left, functions, calls);
      collectFunctionCalls(expression.right, functions, calls);
      break;
    case "number":
    case "string":
    case "boolean":
    case "color":
    case "identifier":
      break;
  }
}
