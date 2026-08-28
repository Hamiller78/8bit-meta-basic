import type { BinaryOperator, Expression, Program, Statement, UnaryOperator } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { deviceSourceList, isSourceDeviceName } from "./devices.js";
import {
  attachTestImplementations,
  collectFunctionDefinitions,
  createFunctionScope,
  createTestScope,
  type FunctionDefinition,
  type FunctionScope,
  validateControlFlowBoundaries,
  validateFunctionRecursion
} from "./function-semantics.js";
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

export interface AnalyzeOptions {
  readonly testMode?: boolean;
}

export function analyzeProgram(program: Program, environment: TargetEnvironment, options: AnalyzeOptions = {}): Program {
  const constants = new Map<string, ConstantDefinition>();
  for (const [key, value] of environment.constants) {
    constants.set(key, { name: key.toUpperCase(), value, environment: true });
  }
  const arrays = new Map<string, ArrayDefinition>();
  const scalarNames = new Set<string>();
  const statements = options.testMode ? attachTestImplementations(program.statements) : program.statements;
  const functions = collectFunctionDefinitions(statements);
  const devices = collectOpenDevices(statements);
  validateFunctionRecursion(functions);
  validateControlFlowBoundaries(statements);

  return {
    statements: analyzeStatements(statements, constants, false, arrays, scalarNames, functions, devices, undefined, options.testMode === true)
  };
}

function analyzeStatements(
  statements: readonly Statement[],
  constants: Map<string, ConstantDefinition>,
  inConstantExpression: boolean,
  arrays: Map<string, ArrayDefinition>,
  scalarNames: Set<string>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  devices: ReadonlySet<string>,
  scope?: FunctionScope,
  testMode = false
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
        analyzed.push(analyzeFunction(definition, constants, arrays, scalarNames, functions, devices));
        break;
      }
      case "test": {
        if (!testMode) {
          throw new DiagnosticError(statement.location, "TEST blocks are only valid when testMode is enabled.");
        }
        if (scope) {
          throw new DiagnosticError(statement.location, "Nested TEST declarations are not supported.");
        }
        analyzed.push(analyzeTest(statement, constants, arrays, scalarNames, functions, devices, testMode));
        break;
      }
      case "globals": {
        if (!testMode) {
          throw new DiagnosticError(statement.location, "GLOBALS blocks are only valid when testMode is enabled.");
        }
        if (scope) {
          throw new DiagnosticError(statement.location, "Nested GLOBALS blocks are not supported.");
        }
        validateGlobalsBody(statement.body);
        analyzed.push({ ...statement, body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, scalarNames, functions, devices, undefined, testMode) });
        break;
      }
      case "local":
        if (!scope) {
          throw new DiagnosticError(statement.location, "LOCAL can only be used inside a FUNCTION or TEST.");
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
      case "data": {
        analyzed.push({
          ...statement,
          values: statement.values.map((value) => analyzeDataValue(value, constants, arrays, functions, scope))
        });
        break;
      }
      case "read": {
        analyzed.push({
          ...statement,
          targets: statement.targets.map((target) => analyzeReadTarget(target, statement.location, constants, arrays, scalarNames, scope))
        });
        break;
      }
      case "restore":
        analyzed.push(statement);
        break;
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
      case "suppress-scroll-prompt":
        analyzed.push(statement);
        break;
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
          analyzed.push({ ...statement, name: targetName, sourceName: statement.sourceName ?? statement.name, expression: intCoercion(expression, statement.location) });
          break;
        } else if (expression.kind === "string" || isStringExpression(expression)) {
          throw new DiagnosticError(statement.location, "Assignments require a numeric expression.");
        }
        analyzed.push({ ...statement, name: targetName, sourceName: statement.sourceName ?? statement.name, expression });
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
      case "function-call-statement": {
        if (canonicalFunctionName(statement.expression.name) || arrays.has(normalizeName(statement.expression.name))) {
          throw new DiagnosticError(statement.location, "Standalone calls are supported only for user-defined FUNCTIONs.");
        }
        const definition = functions.get(normalizeName(statement.expression.name));
        if (!definition) {
          throw new DiagnosticError(statement.location, `Unknown FUNCTION "${statement.expression.name}".`);
        }
        if (statement.expression.args.length !== definition.implementation.parameters.length) {
          throw new DiagnosticError(
            statement.expression.location,
            `FUNCTION ${definition.name} expects ${definition.implementation.parameters.length} argument${definition.implementation.parameters.length === 1 ? "" : "s"}.`
          );
        }
        const expression = {
          ...statement.expression,
          name: definition.name,
          valueType: definition.valueType,
          args: statement.expression.args.map((arg) => foldExpression(arg, constants, inConstantExpression, arrays, functions, scope))
        } satisfies Extract<Expression, { kind: "function-call" }>;
        analyzed.push({ ...statement, expression });
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
      case "open-device":
        analyzed.push(statement);
        break;
      case "print-device":
        requireOpenDevice(statement.handle, statement.location, devices, "PRINT_DEVICE");
        analyzed.push({
          ...statement,
          items: statement.items.map((item) => rejectColorExpression(foldExpression(item, constants, inConstantExpression, arrays, functions, scope), "PRINT_DEVICE"))
        });
        break;
      case "close-device":
        requireOpenDevice(statement.handle, statement.location, devices, "CLOSE_DEVICE");
        analyzed.push(statement);
        break;
      case "end":
        analyzed.push(statement);
        break;
      case "if":
        analyzed.push({
          ...statement,
          condition: foldExpression(statement.condition, constants, inConstantExpression, arrays, functions, scope),
          thenBranch: analyzeStatements(statement.thenBranch, constants, inConstantExpression, arrays, scalarNames, functions, devices, scope, testMode),
          elseBranch: analyzeStatements(statement.elseBranch, constants, inConstantExpression, arrays, scalarNames, functions, devices, scope, testMode)
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
          body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, scalarNames, functions, devices, scope, testMode)
        });
        break;
      }
      case "while":
        analyzed.push({
          ...statement,
          condition: foldExpression(statement.condition, constants, inConstantExpression, arrays, functions, scope),
          body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, scalarNames, functions, devices, scope, testMode)
        });
        break;
      case "repeat-until":
        analyzed.push({
          ...statement,
          body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, scalarNames, functions, devices, scope, testMode),
          condition: foldExpression(statement.condition, constants, inConstantExpression, arrays, functions, scope)
        });
        break;
      case "randomize": {
        if (!statement.seed) {
          analyzed.push(statement);
          break;
        }
        analyzed.push({
          ...statement,
          seed: requireNumericExpression(foldExpression(statement.seed, constants, inConstantExpression, arrays, functions, scope), "RANDOMIZE seed")
        });
        break;
      }
      case "label":
        analyzed.push(scope ? { ...statement, name: resolveScopedLabel(statement.name, scope) } : statement);
        break;
      case "goto":
      case "gosub":
        analyzed.push(scope ? { ...statement, label: resolveScopedLabel(statement.label, scope) } : statement);
        break;
      case "return":
        if (scope) {
          if (scope.kind === "test") {
            if (statement.expression) {
              throw new DiagnosticError(statement.location, `RETURN inside TEST ${scope.functionName} cannot return a value.`);
            }
            analyzed.push(statement);
            break;
          }
          if (scope.returnsValue && !statement.expression) {
            throw new DiagnosticError(statement.location, `RETURN inside FUNCTION ${scope.functionName} requires an expression because the function returns a value.`);
          }
          if (!scope.returnsValue && statement.expression) {
            throw new DiagnosticError(statement.location, `RETURN inside FUNCTION ${scope.functionName} cannot return a value because the function has no return value.`);
          }
          if (!statement.expression) {
            analyzed.push(statement);
            break;
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
      case "assert-true":
      case "assert-false": {
        if (!testMode || scope?.kind !== "test") {
          throw new DiagnosticError(statement.location, `${assertDisplayName(statement.kind)} can only be used inside a TEST when testMode is enabled.`);
        }
        const actual = requireNumericExpression(foldExpression(statement.actual, constants, inConstantExpression, arrays, functions, scope), assertDisplayName(statement.kind));
        analyzed.push({ ...statement, actual });
        break;
      }
      case "assert-eq":
      case "assert-ne": {
        if (!testMode || scope?.kind !== "test") {
          throw new DiagnosticError(statement.location, `${assertDisplayName(statement.kind)} can only be used inside a TEST when testMode is enabled.`);
        }
        if (!statement.expected) {
          throw new DiagnosticError(statement.location, `${assertDisplayName(statement.kind)} requires expected and actual expressions.`);
        }
        const expected = rejectColorExpression(foldExpression(statement.expected, constants, inConstantExpression, arrays, functions, scope), assertDisplayName(statement.kind));
        const actual = rejectColorExpression(foldExpression(statement.actual, constants, inConstantExpression, arrays, functions, scope), assertDisplayName(statement.kind));
        if (isStringExpression(expected) !== isStringExpression(actual)) {
          throw new DiagnosticError(statement.location, `${assertDisplayName(statement.kind)} requires expected and actual expressions of the same type.`);
        }
        analyzed.push({ ...statement, expected, actual });
        break;
      }
      case "assert-print": {
        if (!testMode || scope?.kind !== "test") {
          throw new DiagnosticError(statement.location, "ASSERT_PRINT can only be used inside a TEST when testMode is enabled.");
        }
        const actual = foldExpression(statement.actual, constants, inConstantExpression, arrays, functions, scope);
        if (!isStringExpression(actual)) {
          throw new DiagnosticError(statement.location, "ASSERT_PRINT requires a string expression.");
        }
        analyzed.push({ ...statement, actual });
        break;
      }
      case "assert-printat": {
        if (!testMode || scope?.kind !== "test") {
          throw new DiagnosticError(statement.location, "ASSERT_PRINTAT can only be used inside a TEST when testMode is enabled.");
        }
        if (!statement.row || !statement.column) {
          throw new DiagnosticError(statement.location, "ASSERT_PRINTAT requires row, column, and expected text expressions.");
        }
        const row = requireNumericExpression(foldExpression(statement.row, constants, inConstantExpression, arrays, functions, scope), "ASSERT_PRINTAT row");
        const column = requireNumericExpression(foldExpression(statement.column, constants, inConstantExpression, arrays, functions, scope), "ASSERT_PRINTAT column");
        const actual = foldExpression(statement.actual, constants, inConstantExpression, arrays, functions, scope);
        if (!isStringExpression(actual)) {
          throw new DiagnosticError(statement.location, "ASSERT_PRINTAT expected text must be a string expression.");
        }
        analyzed.push({ ...statement, row, column, actual });
        break;
      }
      case "assert-screen-border-color":
      case "assert-screen-background-color":
      case "assert-screen-text-color":
      case "assert-cell-text-color":
      case "assert-cell-background-color": {
        if (!testMode || scope?.kind !== "test") {
          throw new DiagnosticError(statement.location, `${assertDisplayName(statement.kind)} can only be used inside a TEST when testMode is enabled.`);
        }
        analyzed.push({
          ...statement,
          actual: analyzeColorExpression(statement.actual, constants, assertDisplayName(statement.kind), arrays, functions, scope)
        });
        break;
      }
    }
  }

  return analyzed;
}

function validateGlobalsBody(statements: readonly Statement[]): void {
  for (const statement of statements) {
    if (statement.kind !== "let" && statement.kind !== "array-let") {
      throw new DiagnosticError(statement.location, "GLOBALS blocks currently support only assignments.");
    }
  }
}

function requireNumericExpression(expression: Expression, context: string): Expression {
  if (expression.kind === "color" || isStringExpression(expression)) {
    throw new DiagnosticError(expression.location, `${context} must be numeric.`);
  }
  return expression;
}

function analyzeDataValue(
  expression: Expression,
  constants: ReadonlyMap<string, ConstantDefinition>,
  arrays: ReadonlyMap<string, ArrayDefinition>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  scope?: FunctionScope
): Expression {
  const folded = foldExpression(expression, constants, true, arrays, functions, scope);
  if (folded.kind === "number" || folded.kind === "string" || folded.kind === "boolean") {
    return folded;
  }
  if (folded.kind === "color") {
    throw new DiagnosticError(expression.location, "DATA values cannot be portable colours.");
  }
  throw new DiagnosticError(expression.location, "DATA values must be compile-time numeric, string, or boolean values.");
}

function analyzeReadTarget(
  target: string,
  location: Expression["location"],
  constants: ReadonlyMap<string, ConstantDefinition>,
  arrays: ReadonlyMap<string, ArrayDefinition>,
  scalarNames: Set<string>,
  scope?: FunctionScope
): string {
  const scopedName = resolveScopedName(target, scope);
  const isScopedVariable = scope?.variables.has(normalizeName(target)) ?? false;
  if (!isScopedVariable) {
    const existing = constants.get(normalizeName(target));
    if (existing?.environment) {
      throw new DiagnosticError(location, `Cannot READ into environment constant "${target}".`);
    }
    if (existing) {
      throw new DiagnosticError(location, `Cannot READ into constant "${target}".`);
    }
    if (arrays.has(normalizeName(target))) {
      throw new DiagnosticError(location, `Cannot READ scalar value into array "${target}".`);
    }
    if (canonicalFunctionName(target)) {
      throw new DiagnosticError(location, `Cannot READ into built-in function name "${target}".`);
    }
    scalarNames.add(normalizeName(target));
  }
  return scopedName;
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
      if (expression.operator === "^" && (left.kind === "color" || right.kind === "color" || isStringExpression(left) || isStringExpression(right))) {
        throw new DiagnosticError(expression.location, "Operator ^ requires numeric operands.");
      }
      if (expression.operator === "MOD" && (left.kind === "color" || right.kind === "color" || isStringExpression(left) || isStringExpression(right))) {
        throw new DiagnosticError(expression.location, "Operator MOD requires numeric operands.");
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
      if (!functionDefinition.returnsValue) {
        throw new DiagnosticError(expression.location, `FUNCTION ${functionDefinition.name} does not return a value and can only be called as a statement.`);
      }
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

  if (name === builtinFunctions.freeMemory) {
    if (expression.args.length !== 0) {
      throw new DiagnosticError(expression.location, "FREE_MEMORY expects no arguments.");
    }

    return { ...expression, name, args: [] };
  }

  if (name === builtinFunctions.keyCode) {
    if (expression.args.length !== 0) {
      throw new DiagnosticError(expression.location, "KEY_CODE expects no arguments.");
    }

    return { ...expression, name, args: [] };
  }

  if (name === builtinFunctions.keyPressed) {
    if (expression.args.length !== 0) {
      throw new DiagnosticError(expression.location, "KEY_PRESSED expects no arguments.");
    }

    return { ...expression, name, args: [] };
  }

  if (name === builtinFunctions.rnd) {
    if (expression.args.length !== 0) {
      throw new DiagnosticError(expression.location, "RND expects no arguments.");
    }

    return { ...expression, name, args: [] };
  }

  if (name === builtinFunctions.deviceAvailable) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, "DEVICE_AVAILABLE expects exactly one argument.");
    }
    const [device] = expression.args;
    if (device.kind !== "identifier" || !isSupportedDeviceName(device.name)) {
      throw new DiagnosticError(expression.location, `DEVICE_AVAILABLE currently supports ${deviceSourceList}.`);
    }

    return { ...expression, name, args: [device] };
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

  if (name === builtinFunctions.code || name === builtinFunctions.asc) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, `${name} expects exactly one argument.`);
    }
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope);

    if (!isStringExpression(source)) {
      throw new DiagnosticError(expression.args[0].location, `${name} argument must be a string expression.`);
    }

    return { ...expression, name, args: [source] };
  }

  if (name === builtinFunctions.str) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, "STR$ expects exactly one argument.");
    }
    const value = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope);

    if (isStringExpression(value) || value.kind === "color") {
      throw new DiagnosticError(expression.args[0].location, "STR$ argument must be numeric.");
    }

    return { ...expression, name, args: [value] };
  }

  if (name === builtinFunctions.val) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, "VAL expects exactly one argument.");
    }
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope);

    if (!isStringExpression(source)) {
      throw new DiagnosticError(expression.args[0].location, "VAL argument must be a string expression.");
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
    if (expression.args.length !== 2 && expression.args.length !== 3) {
      throw new DiagnosticError(expression.location, "MID$ expects two or three arguments.");
    }
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope);
    const start = foldExpression(expression.args[1], constants, unknownIdentifierIsError, arrays, functions, scope);
    const length = expression.args[2] ? foldExpression(expression.args[2], constants, unknownIdentifierIsError, arrays, functions, scope) : undefined;

    if (!isStringExpression(source)) {
      throw new DiagnosticError(expression.args[0].location, "MID$ first argument must be a string expression.");
    }
    if (isStringExpression(start) || start.kind === "color") {
      throw new DiagnosticError(expression.args[1].location, "MID$ start argument must be numeric.");
    }
    if (length && (isStringExpression(length) || length.kind === "color")) {
      throw new DiagnosticError(expression.args[2].location, "MID$ length argument must be numeric.");
    }

    return { ...expression, name, args: length ? [source, start, length] : [source, start] };
  }

  if (name === builtinFunctions.left || name === builtinFunctions.right) {
    if (expression.args.length !== 2) {
      throw new DiagnosticError(expression.location, `${name} expects exactly two arguments.`);
    }
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope);
    const length = foldExpression(expression.args[1], constants, unknownIdentifierIsError, arrays, functions, scope);

    if (!isStringExpression(source)) {
      throw new DiagnosticError(expression.args[0].location, `${name} first argument must be a string expression.`);
    }
    if (isStringExpression(length) || length.kind === "color") {
      throw new DiagnosticError(expression.args[1].location, `${name} length argument must be numeric.`);
    }

    return { ...expression, name, args: [source, length] };
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

function isSupportedDeviceName(name: string): boolean {
  return isSourceDeviceName(name);
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
    case "MOD":
      if (right === 0) {
        throw new DiagnosticError(expression.location, "Modulo by zero in constant expression.");
      }
      return numericBinary(operator, left, right, expression, (a, b) => a - Math.trunc(a / b) * b);
    case "^":
      return numericBinary(operator, left, right, expression, (a, b) => a ** b);
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

function collectOpenDevices(statements: readonly Statement[], opened = new Map<string, Statement["location"]>()): ReadonlySet<string> {
  for (const statement of statements) {
    if (statement.kind === "open-device") {
      const key = normalizeName(statement.handle);
      const existing = opened.get(key);
      if (existing) {
        throw new DiagnosticError(statement.location, `Duplicate device handle "${statement.handle}" first opened at ${existing.filename}:${existing.line}.`);
      }
      opened.set(key, statement.location);
    } else if (statement.kind === "if") {
      collectOpenDevices(statement.thenBranch, opened);
      collectOpenDevices(statement.elseBranch, opened);
    } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat-until") {
      collectOpenDevices(statement.body, opened);
    } else if (statement.kind === "function" || statement.kind === "test") {
      collectOpenDevices(statement.body, opened);
    }
  }

  return new Set(opened.keys());
}

function requireOpenDevice(handle: string, location: Statement["location"], devices: ReadonlySet<string>, commandName: "PRINT_DEVICE" | "CLOSE_DEVICE"): void {
  if (!devices.has(normalizeName(handle))) {
    throw new DiagnosticError(location, `${commandName} uses unknown device handle "${handle}". Open it first with OPEN_DEVICE.`);
  }
}

function analyzeFunction(
  definition: FunctionDefinition,
  constants: Map<string, ConstantDefinition>,
  arrays: Map<string, ArrayDefinition>,
  scalarNames: Set<string>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  devices: ReadonlySet<string>
): Statement {
  const scope = createFunctionScope(definition);
  const body = analyzeStatements(definition.statement.body, constants, false, arrays, scalarNames, functions, devices, scope, false);
  return {
    ...definition.statement,
    parameters: definition.statement.parameters,
    body,
    implementation: definition.implementation
  };
}

function analyzeTest(
  statement: Extract<Statement, { kind: "test" }>,
  constants: Map<string, ConstantDefinition>,
  arrays: Map<string, ArrayDefinition>,
  scalarNames: Set<string>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  devices: ReadonlySet<string>,
  testMode: boolean
): Statement {
  const scope = createTestScope(statement);
  const body = analyzeStatements(statement.body, constants, false, arrays, scalarNames, functions, devices, scope, testMode);
  return {
    ...statement,
    body,
    implementation: statement.implementation
  };
}

function resolveScopedName(name: string, scope?: FunctionScope): string {
  return scope?.variables.get(normalizeName(name)) ?? name;
}

function resolveScopedLabel(label: string, scope: FunctionScope): string {
  return scope.labels.get(normalizeName(label)) ?? label;
}

function assertDisplayName(kind: Extract<Statement, { kind: string }>["kind"]): string {
  switch (kind) {
    case "assert-true":
      return "ASSERT_TRUE";
    case "assert-false":
      return "ASSERT_FALSE";
    case "assert-eq":
      return "ASSERT_EQ";
    case "assert-ne":
      return "ASSERT_NE";
    case "assert-printat":
      return "ASSERT_PRINTAT";
    case "assert-screen-border-color":
      return "ASSERT_SCREEN_BORDER_COLOR";
    case "assert-screen-background-color":
      return "ASSERT_SCREEN_BACKGROUND_COLOR";
    case "assert-screen-text-color":
      return "ASSERT_SCREEN_TEXT_COLOR";
    case "assert-cell-text-color":
      return "ASSERT_CELL_TEXT_COLOR";
    case "assert-cell-background-color":
      return "ASSERT_CELL_BACKGROUND_COLOR";
    default:
      return "ASSERT";
  }
}
