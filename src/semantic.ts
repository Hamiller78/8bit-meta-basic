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
import { canonicalTestRuntimeSetterName } from "./test-runtime.js";
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

interface StructFieldDefinition {
  readonly name: string;
  readonly storageSuffix: string;
  readonly valueType: "number" | "string";
  readonly dimensions: readonly number[];
  readonly location: Expression["location"];
}

interface StructDefinition {
  readonly name: string;
  readonly fields: readonly StructFieldDefinition[];
  readonly location: Expression["location"];
}

interface StructValueDefinition {
  readonly name: string;
  readonly typeName: string;
  readonly dimensions: readonly number[];
  readonly fields: readonly StructFieldDefinition[];
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
  const structs = new Map<string, StructDefinition>();
  const structValues = new Map<string, StructValueDefinition>();
  const scalarNames = new Set<string>();
  const statements = options.testMode ? attachTestImplementations(program.statements) : program.statements;
  predeclareTopLevelSymbols(statements, constants, arrays, structs, structValues);
  const functions = collectFunctionDefinitions(statements);
  const devices = collectOpenDevices(statements);
  validateFunctionRecursion(functions);
  validateControlFlowBoundaries(statements);

  return {
    statements: analyzeStatements(statements, constants, false, arrays, structs, structValues, scalarNames, functions, devices, undefined, options.testMode === true)
  };
}

function predeclareTopLevelSymbols(
  statements: readonly Statement[],
  constants: Map<string, ConstantDefinition>,
  arrays: Map<string, ArrayDefinition>,
  structs: Map<string, StructDefinition>,
  structValues: Map<string, StructValueDefinition>
): void {
  for (const statement of statements) {
    if (statement.kind === "const") {
      const value = evaluateConstant(statement.expression, constants);
      addConstant(statement.name, value, statement.location, constants, "constant");
      continue;
    }

    if (statement.kind === "enum") {
      let nextValue = 0;
      for (const member of statement.members) {
        const value = member.expression ? evaluateEnumValue(member.expression, constants) : nextValue;
        addConstant(member.name, value, member.location, constants, `enum ${statement.name}`);
        nextValue = value + 1;
      }
    }
  }

  for (const statement of statements) {
    if (statement.kind === "struct") {
      addStructDefinition(statement, constants, arrays, structs, structValues);
    }
  }
}

function analyzeStatements(
  statements: readonly Statement[],
  constants: Map<string, ConstantDefinition>,
  inConstantExpression: boolean,
  arrays: Map<string, ArrayDefinition>,
  structs: Map<string, StructDefinition>,
  structValues: Map<string, StructValueDefinition>,
  scalarNames: Set<string>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  devices: ReadonlySet<string>,
  scope?: FunctionScope,
  testMode = false,
  forDepth = 0
): readonly Statement[] {
  const analyzed: Statement[] = [];

  for (const statement of statements) {
    switch (statement.kind) {
      case "comment":
        analyzed.push(statement);
        break;
      case "function": {
        if (scope) {
          throw new DiagnosticError(statement.location, "Nested FUNCTION declarations are not supported.");
        }
        const definition = functions.get(normalizeName(statement.name));
        if (!definition) {
          throw new DiagnosticError(statement.location, `Internal error: missing function definition for "${statement.name}".`);
        }
        analyzed.push(analyzeFunction(definition, constants, arrays, structs, structValues, scalarNames, functions, devices));
        break;
      }
      case "test": {
        if (!testMode) {
          throw new DiagnosticError(statement.location, "TEST blocks are only valid when testMode is enabled.");
        }
        if (scope) {
          throw new DiagnosticError(statement.location, "Nested TEST declarations are not supported.");
        }
        analyzed.push(analyzeTest(statement, constants, arrays, structs, structValues, scalarNames, functions, devices, testMode));
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
        analyzed.push({ ...statement, body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, structs, structValues, scalarNames, functions, devices, undefined, testMode) });
        break;
      }
      case "struct":
        if (scope) {
          addStructDefinition(statement, constants, arrays, structs, structValues);
        }
        break;
      case "enum": {
        if (!scope) {
          break;
        }
        let nextValue = 0;
        for (const member of statement.members) {
          const value = member.expression ? evaluateEnumValue(member.expression, constants) : nextValue;
          addConstant(member.name, value, member.location, constants, `enum ${statement.name}`);
          nextValue = value + 1;
        }
        break;
      }
      case "local":
        if (!scope) {
          throw new DiagnosticError(statement.location, "LOCAL can only be used inside a FUNCTION or TEST.");
        }
        break;
      case "const": {
        if (!scope) {
          break;
        }
        const value = evaluateConstant(statement.expression, constants);
        addConstant(statement.name, value, statement.location, constants, "constant");
        break;
      }
      case "data": {
        analyzed.push({
          ...statement,
          values: statement.values.map((value) => analyzeDataValue(value, constants, arrays, functions, scope, structValues))
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
        if (statement.asType) {
          const expanded = analyzeStructDim(statement, constants, arrays, structs, structValues, scalarNames);
          analyzed.push(...expanded);
          break;
        }
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
      case "program-mode":
        analyzed.push(statement);
        break;
      case "let": {
        const structTarget = structValues.get(normalizeName(resolveScopedName(statement.name, scope))) ?? structValues.get(normalizeName(statement.name));
        if (structTarget) {
          if (structTarget.dimensions.length !== 0) {
            throw new DiagnosticError(statement.location, `Struct array "${statement.name}" requires an index for whole-struct assignment.`);
          }
          const valueDefinition = resolveAssignedStructValue(statement.expression, statement.name, structTarget, structValues, scope);
          const lowered = structTarget.fields.map((field) => ({
            kind: "let" as const,
            name: structFieldStorageName(structTarget.name, field),
            expression: { kind: "identifier" as const, name: structFieldStorageName(valueDefinition.name, field), location: statement.expression.location },
            sourceName: `${statement.name}.${field.name}`,
            location: statement.location
          }));
          analyzed.push(...analyzeStatements(lowered, constants, inConstantExpression, arrays, structs, structValues, scalarNames, functions, devices, scope, testMode, forDepth));
          break;
        }
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
        const expression = foldExpression(statement.expression, constants, inConstantExpression, arrays, functions, scope, structValues);
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
        const targetName = resolveScopedName(statement.name, scope);
        const structTarget = structValues.get(normalizeName(targetName)) ?? structValues.get(normalizeName(statement.name));
        if (structTarget) {
          if (structTarget.dimensions.length !== 1) {
            throw new DiagnosticError(statement.location, `Struct value "${statement.name}" is not an array.`);
          }
          const valueDefinition = resolveAssignedStructValue(statement.expression, targetName, structTarget, structValues, scope);
          const lowered = structTarget.fields.map((field) => ({
            kind: "array-let" as const,
            name: structFieldStorageName(targetName, field),
            indices: statement.indices,
            expression: { kind: "identifier" as const, name: structFieldStorageName(valueDefinition.name, field), location: statement.expression.location },
            location: statement.location
          }));
          analyzed.push(...analyzeStatements(lowered, constants, inConstantExpression, arrays, structs, structValues, scalarNames, functions, devices, scope, testMode, forDepth));
          break;
        }
        const definition = arrays.get(normalizeName(statement.name));
        if (!definition) {
          throw new DiagnosticError(statement.location, `Array "${statement.name}" must be declared with DIM before use.`);
        }
        const indices = analyzeArrayIndices(statement.name, statement.indices, definition, constants, inConstantExpression, arrays, functions, scope);
        const expression = foldExpression(statement.expression, constants, inConstantExpression, arrays, functions, scope, structValues);
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
      case "struct-field-let": {
        const resolved = resolveStructFieldTarget(statement.base, statement.indices, statement.field, statement.location, structValues, constants, inConstantExpression, arrays, functions, scope);
        const lowered: Statement =
          resolved.kind === "array"
            ? { kind: "array-let", name: resolved.name, indices: resolved.indices, expression: statement.expression, location: statement.location }
            : { kind: "let", name: resolved.name, expression: statement.expression, sourceName: `${statement.base}.${statement.field}`, location: statement.location };
        analyzed.push(...analyzeStatements([lowered], constants, inConstantExpression, arrays, structs, structValues, scalarNames, functions, devices, scope, testMode, forDepth));
        break;
      }
      case "function-call-statement": {
        const setter = analyzeTestRuntimeSetterStatement(statement, constants, inConstantExpression, arrays, functions, scope, structValues, testMode);
        if (setter) {
          analyzed.push(setter);
          break;
        }
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
        validateFunctionArguments(definition, statement.expression.args, structValues, scope);
        const expression = {
          ...statement.expression,
          name: definition.name,
          valueType: definition.valueType,
          args: analyzeFunctionCallArguments(definition, statement.expression.args, constants, inConstantExpression, arrays, functions, scope, structValues)
        } satisfies Extract<Expression, { kind: "function-call" }>;
        analyzed.push({ ...statement, expression });
        break;
      }
      case "insert-element":
        analyzed.push(
          analyzeElementMoveStatement(statement, "insert", constants, inConstantExpression, arrays, structValues, functions, scope)
        );
        break;
      case "remove-element":
        analyzed.push(
          analyzeElementMoveStatement(statement, "remove", constants, inConstantExpression, arrays, structValues, functions, scope)
        );
        break;
      case "print":
        analyzed.push({
          ...statement,
          items: statement.items.map((item) => rejectColorExpression(foldExpression(item, constants, inConstantExpression, arrays, functions, scope, structValues), "PRINT")),
          ...(statement.at
            ? {
                at: {
                  ...statement.at,
                  row: foldExpression(statement.at.row, constants, inConstantExpression, arrays, functions, scope, structValues),
                  column: foldExpression(statement.at.column, constants, inConstantExpression, arrays, functions, scope, structValues)
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
          items: statement.items.map((item) => rejectColorExpression(foldExpression(item, constants, inConstantExpression, arrays, functions, scope, structValues), "PRINT_DEVICE"))
        });
        break;
      case "close-device":
        requireOpenDevice(statement.handle, statement.location, devices, "CLOSE_DEVICE");
        analyzed.push(statement);
        break;
      case "end":
        analyzed.push(statement);
        break;
      case "exit-for":
        if (forDepth === 0) {
          throw new DiagnosticError(statement.location, "EXIT FOR can only be used inside a FOR loop.");
        }
        analyzed.push(statement);
        break;
      case "continue-for":
        if (forDepth === 0) {
          throw new DiagnosticError(statement.location, "CONTINUE FOR can only be used inside a FOR loop.");
        }
        analyzed.push(statement);
        break;
      case "if":
        analyzed.push({
          ...statement,
          condition: foldExpression(statement.condition, constants, inConstantExpression, arrays, functions, scope, structValues),
          thenBranch: analyzeStatements(statement.thenBranch, constants, inConstantExpression, arrays, structs, structValues, scalarNames, functions, devices, scope, testMode, forDepth),
          elseBranch: analyzeStatements(statement.elseBranch, constants, inConstantExpression, arrays, structs, structValues, scalarNames, functions, devices, scope, testMode, forDepth)
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
        const start = requireNumericExpression(foldExpression(statement.start, constants, inConstantExpression, arrays, functions, scope, structValues), "FOR start value");
        const limit = requireNumericExpression(foldExpression(statement.limit, constants, inConstantExpression, arrays, functions, scope, structValues), "FOR limit value");
        const step = statement.step
          ? requireNumericExpression(foldExpression(statement.step, constants, inConstantExpression, arrays, functions, scope, structValues), "FOR STEP value")
          : undefined;
        analyzed.push({
          ...statement,
          variable: loopVariable,
          start,
          limit,
          ...(step ? { step } : {}),
          body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, structs, structValues, scalarNames, functions, devices, scope, testMode, forDepth + 1)
        });
        break;
      }
      case "while":
        analyzed.push({
          ...statement,
          condition: foldExpression(statement.condition, constants, inConstantExpression, arrays, functions, scope, structValues),
          body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, structs, structValues, scalarNames, functions, devices, scope, testMode, forDepth)
        });
        break;
      case "repeat-until":
        analyzed.push({
          ...statement,
          body: analyzeStatements(statement.body, constants, inConstantExpression, arrays, structs, structValues, scalarNames, functions, devices, scope, testMode, forDepth),
          condition: foldExpression(statement.condition, constants, inConstantExpression, arrays, functions, scope, structValues)
        });
        break;
      case "randomize": {
        if (!statement.seed) {
          analyzed.push(statement);
          break;
        }
        analyzed.push({
          ...statement,
          seed: requireNumericExpression(foldExpression(statement.seed, constants, inConstantExpression, arrays, functions, scope, structValues), "RANDOMIZE seed")
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
            expression: foldExpression(statement.expression, constants, inConstantExpression, arrays, functions, scope, structValues)
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
        const actual = requireNumericExpression(foldExpression(statement.actual, constants, inConstantExpression, arrays, functions, scope, structValues), assertDisplayName(statement.kind));
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
        const expected = rejectColorExpression(foldExpression(statement.expected, constants, inConstantExpression, arrays, functions, scope, structValues), assertDisplayName(statement.kind));
        const actual = rejectColorExpression(foldExpression(statement.actual, constants, inConstantExpression, arrays, functions, scope, structValues), assertDisplayName(statement.kind));
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
        const actual = foldExpression(statement.actual, constants, inConstantExpression, arrays, functions, scope, structValues);
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
        const row = requireNumericExpression(foldExpression(statement.row, constants, inConstantExpression, arrays, functions, scope, structValues), "ASSERT_PRINTAT row");
        const column = requireNumericExpression(foldExpression(statement.column, constants, inConstantExpression, arrays, functions, scope, structValues), "ASSERT_PRINTAT column");
        const actual = foldExpression(statement.actual, constants, inConstantExpression, arrays, functions, scope, structValues);
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

function analyzeTestRuntimeSetterStatement(
  statement: Extract<Statement, { kind: "function-call-statement" }>,
  constants: Map<string, ConstantDefinition>,
  unknownIdentifierIsError: boolean,
  arrays: Map<string, ArrayDefinition>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  scope: FunctionScope | undefined,
  structValues: Map<string, StructValueDefinition>,
  testMode: boolean
): Statement | undefined {
  const canonical = canonicalTestRuntimeSetterName(statement.expression.name);
  const setter = canonical;
  if (!setter) {
    return undefined;
  }

  if (!testMode || scope?.kind !== "test") {
    throw new DiagnosticError(statement.location, `${setter} can only be used inside a TEST when test mode is enabled.`);
  }

  if (statement.expression.args.length !== 1) {
    throw new DiagnosticError(statement.expression.location, `${setter} expects exactly one argument.`);
  }

  const value = foldExpression(statement.expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope, structValues);
  if (value.kind === "color" || isStringExpression(value)) {
    throw new DiagnosticError(statement.expression.args[0].location, `${setter} expects a numeric argument.`);
  }

  return {
    ...statement,
    expression: {
      ...statement.expression,
      name: setter,
      args: [value],
      valueType: "number"
    }
  };
}

function validateGlobalsBody(statements: readonly Statement[]): void {
  for (const statement of statements) {
    if (statement.kind !== "let" && statement.kind !== "array-let") {
      throw new DiagnosticError(statement.location, "GLOBALS blocks currently support only assignments.");
    }
  }
}

function addStructDefinition(
  statement: Extract<Statement, { kind: "struct" }>,
  constants: ReadonlyMap<string, ConstantDefinition>,
  arrays: ReadonlyMap<string, ArrayDefinition>,
  structs: Map<string, StructDefinition>,
  structValues: ReadonlyMap<string, StructValueDefinition>
): void {
  const key = normalizeName(statement.name);
  if (constants.has(key) || arrays.has(key) || structValues.has(key)) {
    throw new DiagnosticError(statement.location, `Cannot declare STRUCT "${statement.name}" with the same name as an existing symbol.`);
  }
  if (structs.has(key)) {
    throw new DiagnosticError(statement.location, `Duplicate STRUCT "${statement.name}".`);
  }

  const seenFields = new Set<string>();
  const fields = statement.fields.map((field) => {
    const fieldKey = normalizeName(field.name);
    if (seenFields.has(fieldKey)) {
      throw new DiagnosticError(field.location, `Duplicate field "${field.name}" in STRUCT ${statement.name}.`);
    }
    seenFields.add(fieldKey);
    const dimensions = field.dimensions.map((dimension) => requireArrayDimension(dimension, constants));
    if (isStringVariableName(field.name)) {
      if (dimensions.length !== 1) {
        throw new DiagnosticError(field.location, `String field "${field.name}" in STRUCT ${statement.name} requires a fixed width, for example ${field.name}(32).`);
      }
    } else if (dimensions.length !== 0) {
      throw new DiagnosticError(field.location, `Numeric field "${field.name}" in STRUCT ${statement.name} must not have dimensions.`);
    }
    return {
      name: field.name,
      storageSuffix: field.name,
      valueType: isStringVariableName(field.name) ? "string" : "number",
      dimensions,
      location: field.location
    } satisfies StructFieldDefinition;
  });

  if (fields.length === 0) {
    throw new DiagnosticError(statement.location, `STRUCT ${statement.name} requires at least one field.`);
  }
  structs.set(key, { name: statement.name, fields, location: statement.location });
}

function analyzeStructDim(
  statement: Extract<Statement, { kind: "dim" }>,
  constants: ReadonlyMap<string, ConstantDefinition>,
  arrays: Map<string, ArrayDefinition>,
  structs: ReadonlyMap<string, StructDefinition>,
  structValues: Map<string, StructValueDefinition>,
  scalarNames: Set<string>
): readonly Statement[] {
  const key = normalizeName(statement.name);
  if (constants.has(key)) {
    throw new DiagnosticError(statement.location, `Cannot declare struct value "${statement.name}" with the same name as a constant.`);
  }
  if (arrays.has(key) || scalarNames.has(key) || structValues.has(key)) {
    throw new DiagnosticError(statement.location, `Duplicate struct value "${statement.name}".`);
  }
  if (canonicalFunctionName(statement.name)) {
    throw new DiagnosticError(statement.location, `Cannot declare struct value "${statement.name}" with the same name as a built-in function.`);
  }

  const struct = structs.get(normalizeName(statement.asType ?? ""));
  if (!struct) {
    throw new DiagnosticError(statement.location, `Unknown STRUCT type "${statement.asType}".`);
  }
  if (statement.dimensions.length > 1) {
    throw new DiagnosticError(statement.location, "Struct arrays currently support exactly one element-count dimension.");
  }

  const dimensions = statement.dimensions.map((dimension) => requireArrayDimension(dimension, constants));
  structValues.set(key, { name: statement.name, typeName: struct.name, dimensions, fields: struct.fields, location: statement.location });

  if (dimensions.length === 0) {
    for (const field of struct.fields) {
      scalarNames.add(normalizeName(structFieldStorageName(statement.name, field)));
    }
    return [];
  }

  return struct.fields.map((field) => {
    const fieldDimensions = field.valueType === "string" ? [dimensions[0], field.dimensions[0]] : dimensions;
    const fieldName = structFieldStorageName(statement.name, field);
    arrays.set(normalizeName(fieldName), { name: fieldName, valueType: field.valueType, dimensions: fieldDimensions, location: statement.location });
    return {
      kind: "dim",
      name: fieldName,
      dimensions: fieldDimensions.map((dimension) => ({ kind: "number", value: dimension, raw: dimension.toString(), location: statement.location })),
      location: statement.location
    };
  });
}

function structFieldStorageName(base: string, field: StructFieldDefinition): string {
  const suffix = field.valueType === "string" ? "$" : isIntegerVariableName(field.name) ? "%" : "";
  const baseName = base.replace(/[$%]$/u, "");
  const fieldName = field.storageSuffix.replace(/[$%]$/u, "");
  return `${baseName}_${fieldName}${suffix}`;
}

function findStructField(definition: StructValueDefinition, fieldName: string, location: Expression["location"]): StructFieldDefinition {
  const field = definition.fields.find((candidate) => normalizeName(candidate.name) === normalizeName(fieldName));
  if (!field) {
    throw new DiagnosticError(location, `STRUCT ${definition.typeName} has no field "${fieldName}".`);
  }
  return field;
}

function resolveStructFieldTarget(
  base: string,
  indices: readonly Expression[],
  fieldName: string,
  location: Expression["location"],
  structValues: ReadonlyMap<string, StructValueDefinition>,
  constants: ReadonlyMap<string, ConstantDefinition>,
  inConstantExpression: boolean,
  arrays: ReadonlyMap<string, ArrayDefinition>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  scope?: FunctionScope
): { readonly kind: "array"; readonly name: string; readonly indices: readonly Expression[]; readonly valueType: "number" | "string" } | { readonly kind: "scalar"; readonly name: string; readonly valueType: "number" | "string" } {
  const resolvedBase = resolveScopedName(base, scope);
  const definition = structValues.get(normalizeName(resolvedBase)) ?? structValues.get(normalizeName(base));
  if (!definition) {
    throw new DiagnosticError(location, `Unknown struct value "${base}".`);
  }
  const field = findStructField(definition, fieldName, location);
  const storageName = structFieldStorageName(resolvedBase, field);
  if (definition.dimensions.length === 0) {
    if (indices.length !== 0) {
      throw new DiagnosticError(location, `Struct value "${base}" is not an array.`);
    }
    return { kind: "scalar", name: storageName, valueType: field.valueType };
  }
  const arrayDefinition = arrays.get(normalizeName(storageName));
  if (!arrayDefinition) {
    throw new DiagnosticError(location, `Internal error: missing backing array for "${base}.${fieldName}".`);
  }
  return {
    kind: "array",
    name: storageName,
    valueType: field.valueType,
    indices: analyzeArrayIndices(storageName, indices, arrayDefinition, constants, inConstantExpression, arrays, functions, scope)
  };
}

function analyzeElementMoveStatement(
  statement: Extract<Statement, { kind: "insert-element" | "remove-element" }>,
  mode: "insert" | "remove",
  constants: ReadonlyMap<string, ConstantDefinition>,
  inConstantExpression: boolean,
  arrays: ReadonlyMap<string, ArrayDefinition>,
  structValues: ReadonlyMap<string, StructValueDefinition>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  scope?: FunctionScope
): Statement {
  if (statement.target.kind !== "identifier") {
    throw new DiagnosticError(statement.target.location, `${mode === "insert" ? "INSERT_ELEMENT" : "REMOVE_ELEMENT"} first argument must be an array name.`);
  }
  const targetName = resolveScopedName(statement.target.name, scope);
  const index = requireNumericExpression(foldExpression(statement.index, constants, inConstantExpression, arrays, functions, scope, structValues), `${mode === "insert" ? "INSERT_ELEMENT" : "REMOVE_ELEMENT"} index`);
  const structTarget = structValues.get(normalizeName(targetName));
  if (structTarget) {
    if (structTarget.dimensions.length !== 1) {
      throw new DiagnosticError(statement.target.location, `${mode === "insert" ? "INSERT_ELEMENT" : "REMOVE_ELEMENT"} requires a struct array.`);
    }
    if (statement.kind === "insert-element") {
      const valueDefinition = resolveInsertedStructValue(statement.value, targetName, structTarget, structValues, scope);
      return {
        ...statement,
        target: { kind: "identifier", name: targetName, location: statement.target.location },
        index,
        elementCount: structTarget.dimensions[0],
        fields: structTarget.fields.map((field) => ({
          arrayName: structFieldStorageName(targetName, field),
          valueType: field.valueType,
          insertExpression: { kind: "identifier", name: structFieldStorageName(valueDefinition.name, field), location: statement.value.location } satisfies Expression
        }))
      };
    }
    return {
      ...statement,
      target: { kind: "identifier", name: targetName, location: statement.target.location },
      index,
      elementCount: structTarget.dimensions[0],
      fields: structTarget.fields.map((field) => ({ arrayName: structFieldStorageName(targetName, field), valueType: field.valueType }))
    };
  }

  const array = arrays.get(normalizeName(targetName));
  if (!array) {
    throw new DiagnosticError(statement.target.location, `Array "${statement.target.name}" must be declared with DIM before use.`);
  }
  if (array.dimensions.length !== (array.valueType === "string" ? 2 : 1)) {
    throw new DiagnosticError(statement.target.location, `${mode === "insert" ? "INSERT_ELEMENT" : "REMOVE_ELEMENT"} currently supports one-dimensional arrays.`);
  }
  if (statement.kind === "remove-element") {
    return { ...statement, target: { kind: "identifier", name: targetName, location: statement.target.location }, index, elementCount: array.dimensions[0], fields: [{ arrayName: targetName, valueType: array.valueType }] };
  }
  const value = foldExpression(statement.value, constants, inConstantExpression, arrays, functions, scope, structValues);
  if (array.valueType === "string") {
    if (!isStringExpression(value)) {
      throw new DiagnosticError(statement.value.location, "INSERT_ELEMENT value for a string array must be a string expression.");
    }
    validateStringArrayAssignmentLength(targetName, value, array);
  } else if (value.kind === "color" || isStringExpression(value)) {
    throw new DiagnosticError(statement.value.location, "INSERT_ELEMENT value for a numeric array must be numeric.");
  }
  return {
    ...statement,
    target: { kind: "identifier", name: targetName, location: statement.target.location },
    index,
    value,
    elementCount: array.dimensions[0],
    fields: [{ arrayName: targetName, valueType: array.valueType, insertExpression: value }]
  };
}

function validateFunctionArguments(
  definition: FunctionDefinition,
  args: readonly Expression[],
  structValues: ReadonlyMap<string, StructValueDefinition>,
  scope?: FunctionScope
): void {
  for (let index = 0; index < definition.implementation.parameters.length; index += 1) {
    const parameter = definition.implementation.parameters[index];
    if (!parameter.asType) {
      continue;
    }
    const arg = args[index];
    if (arg?.kind !== "identifier") {
      throw new DiagnosticError(arg?.location ?? definition.statement.location, `FUNCTION ${definition.name} parameter "${parameter.sourceName}" expects a scalar STRUCT ${parameter.asType} value.`);
    }
    const resolvedName = resolveScopedName(arg.name, scope);
    const value = structValues.get(normalizeName(resolvedName)) ?? structValues.get(normalizeName(arg.name));
    if (!value || value.dimensions.length !== 0 || normalizeName(value.typeName) !== normalizeName(parameter.asType)) {
      throw new DiagnosticError(arg.location, `FUNCTION ${definition.name} parameter "${parameter.sourceName}" expects a scalar STRUCT ${parameter.asType} value.`);
    }
  }
}

function analyzeFunctionCallArguments(
  definition: FunctionDefinition,
  args: readonly Expression[],
  constants: ReadonlyMap<string, ConstantDefinition>,
  unknownIdentifierIsError: boolean,
  arrays: ReadonlyMap<string, ArrayDefinition>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  scope: FunctionScope | undefined,
  structValues: ReadonlyMap<string, StructValueDefinition>
): readonly Expression[] {
  return args.map((arg, index) => {
    const parameter = definition.implementation.parameters[index];
    if (parameter?.asType) {
      if (arg.kind !== "identifier") {
        throw new DiagnosticError(arg.location, `FUNCTION ${definition.name} parameter "${parameter.sourceName}" expects a scalar STRUCT ${parameter.asType} value.`);
      }
      return { ...arg, name: scope?.variables.get(normalizeName(arg.name)) ?? arg.name };
    }
    return foldExpression(arg, constants, unknownIdentifierIsError, arrays, functions, scope, structValues);
  });
}

function resolveInsertedStructValue(
  value: Expression,
  targetName: string,
  target: StructValueDefinition,
  structValues: ReadonlyMap<string, StructValueDefinition>,
  scope?: FunctionScope
): StructValueDefinition {
  if (value.kind !== "identifier") {
    throw new DiagnosticError(value.location, "INSERT_ELEMENT value for a struct array must be a scalar struct value.");
  }
  const resolvedName = resolveScopedName(value.name, scope);
  const definition = structValues.get(normalizeName(resolvedName)) ?? structValues.get(normalizeName(value.name));
  if (!definition || definition.dimensions.length !== 0) {
    throw new DiagnosticError(value.location, "INSERT_ELEMENT value for a struct array must be a scalar struct value.");
  }
  if (normalizeName(definition.typeName) !== normalizeName(target.typeName)) {
    throw new DiagnosticError(value.location, `Cannot insert STRUCT ${definition.typeName} into ${targetName} AS ${target.typeName}.`);
  }
  return definition;
}

function resolveAssignedStructValue(
  value: Expression,
  targetName: string,
  target: StructValueDefinition,
  structValues: ReadonlyMap<string, StructValueDefinition>,
  scope?: FunctionScope
): StructValueDefinition {
  if (value.kind !== "identifier") {
    throw new DiagnosticError(value.location, "Struct assignment requires a scalar struct value.");
  }
  const resolvedName = resolveScopedName(value.name, scope);
  const definition = structValues.get(normalizeName(resolvedName)) ?? structValues.get(normalizeName(value.name));
  if (!definition || definition.dimensions.length !== 0) {
    throw new DiagnosticError(value.location, "Struct assignment requires a scalar struct value.");
  }
  if (normalizeName(definition.typeName) !== normalizeName(target.typeName)) {
    throw new DiagnosticError(value.location, `Cannot assign STRUCT ${definition.typeName} to ${targetName} AS ${target.typeName}.`);
  }
  return definition;
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
  scope?: FunctionScope,
  structValues: ReadonlyMap<string, StructValueDefinition> = new Map()
): Expression {
  const folded = foldExpression(expression, constants, true, arrays, functions, scope, structValues);
  if (folded.kind === "number" || folded.kind === "string" || folded.kind === "boolean") {
    return folded;
  }
  if (folded.kind === "color") {
    throw new DiagnosticError(expression.location, "DATA values cannot be portable colours.");
  }
  throw new DiagnosticError(expression.location, "DATA values must be compile-time numeric, string, or boolean values.");
}

function addConstant(
  name: string,
  value: ConstantValue,
  location: Expression["location"],
  constants: Map<string, ConstantDefinition>,
  context: "constant" | string
): void {
  const key = normalizeName(name);
  const existing = constants.get(key);
  if (existing?.environment) {
    throw new DiagnosticError(location, `Cannot redeclare environment constant "${name}".`);
  }
  if (existing) {
    throw new DiagnosticError(location, context === "constant" ? `Duplicate constant "${name}".` : `Duplicate ${context} member "${name}".`);
  }

  constants.set(key, { name, value, environment: false });
}

function evaluateEnumValue(expression: Expression, constants: ReadonlyMap<string, ConstantDefinition>): number {
  const value = evaluateConstant(expression, constants);
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new DiagnosticError(expression.location, "ENUM values must be compile-time integer constants.");
  }
  return value;
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
  scope?: FunctionScope,
  structValues: ReadonlyMap<string, StructValueDefinition> = new Map()
): readonly Expression[] {
  const expectedIndexCount = definition.valueType === "string" ? definition.dimensions.length - 1 : definition.dimensions.length;
  if (indices.length !== expectedIndexCount) {
    throw new DiagnosticError(
      indices[0]?.location ?? definition.location,
      `Array "${name}" expects ${expectedIndexCount} index expression${expectedIndexCount === 1 ? "" : "s"}.`
    );
  }

  return indices.map((index, position) => {
    const folded = requireNumericExpression(foldExpression(index, constants, inConstantExpression, arrays, functions, scope, structValues), "Array index");
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
  scope?: FunctionScope,
  structValues: ReadonlyMap<string, StructValueDefinition> = new Map()
): Expression {
  switch (expression.kind) {
    case "number":
    case "string":
    case "boolean":
    case "color":
      return expression;
    case "identifier": {
      const scopedName = scope?.variables.get(normalizeName(expression.name));
      if (structValues.has(normalizeName(scopedName ?? expression.name)) || structValues.has(normalizeName(expression.name))) {
        throw new DiagnosticError(expression.location, `Struct value "${expression.name}" cannot be used as a scalar expression.`);
      }
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
        indices: analyzeArrayIndices(expression.name, expression.indices, definition, constants, unknownIdentifierIsError, arrays, functions, scope, structValues)
      };
    }
    case "struct-field-access": {
      const resolved = resolveStructFieldTarget(
        expression.base,
        expression.indices,
        expression.field,
        expression.location,
        structValues,
        constants,
        unknownIdentifierIsError,
        arrays,
        functions,
        scope
      );
      if (resolved.kind === "scalar") {
        return { kind: "identifier", name: resolved.name, location: expression.location };
      }
      return { kind: "array-access", name: resolved.name, valueType: resolved.valueType, indices: resolved.indices, location: expression.location };
    }
    case "function-call":
      return foldFunctionCall(expression, constants, unknownIdentifierIsError, arrays, functions, scope, structValues);
    case "parenthesized": {
      const folded = foldExpression(expression.expression, constants, unknownIdentifierIsError, arrays, functions, scope, structValues);
      if (isLiteralExpression(folded)) {
        return folded;
      }
      return { ...expression, expression: folded };
    }
    case "unary": {
      const operand = foldExpression(expression.operand, constants, unknownIdentifierIsError, arrays, functions, scope, structValues);
      if (isLiteralExpression(operand)) {
        return literalFromValue(evaluateUnary(expression.operator, evaluateLiteralExpression(operand), expression), expression.location);
      }
      return { ...expression, operand };
    }
    case "binary": {
      const left = foldExpression(expression.left, constants, unknownIdentifierIsError, arrays, functions, scope, structValues);
      const right = foldExpression(expression.right, constants, unknownIdentifierIsError, arrays, functions, scope, structValues);
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
  scope?: FunctionScope,
  structValues: ReadonlyMap<string, StructValueDefinition> = new Map()
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
      validateFunctionArguments(functionDefinition, expression.args, structValues, scope);
      return {
        ...expression,
        name: functionDefinition.name,
        valueType: functionDefinition.valueType,
        args: analyzeFunctionCallArguments(functionDefinition, expression.args, constants, unknownIdentifierIsError, arrays, functions, scope, structValues)
      };
    }

    const definition = arrays.get(normalizeName(expression.name));
    if (definition) {
      return {
        kind: "array-access",
        name: expression.name,
        valueType: definition.valueType,
        indices: analyzeArrayIndices(expression.name, expression.args, definition, constants, unknownIdentifierIsError, arrays, functions, scope, structValues),
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

  if (name === builtinFunctions.setJiffies || name === builtinFunctions.setKeyCode || name === builtinFunctions.setKeyPressed) {
    throw new DiagnosticError(expression.location, `${name} can only be used as a statement inside a TEST.`);
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
    const code = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope, structValues);

    if (isStringExpression(code) || code.kind === "color") {
      throw new DiagnosticError(expression.args[0].location, "CHR$ argument must be numeric.");
    }

    return { ...expression, name, args: [code] };
  }

  if (name === builtinFunctions.code || name === builtinFunctions.asc) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, `${name} expects exactly one argument.`);
    }
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope, structValues);

    if (!isStringExpression(source)) {
      throw new DiagnosticError(expression.args[0].location, `${name} argument must be a string expression.`);
    }

    return { ...expression, name, args: [source] };
  }

  if (name === builtinFunctions.str) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, "STR$ expects exactly one argument.");
    }
    const value = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope, structValues);

    if (isStringExpression(value) || value.kind === "color") {
      throw new DiagnosticError(expression.args[0].location, "STR$ argument must be numeric.");
    }

    return { ...expression, name, args: [value] };
  }

  if (name === builtinFunctions.val) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, "VAL expects exactly one argument.");
    }
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope, structValues);

    if (!isStringExpression(source)) {
      throw new DiagnosticError(expression.args[0].location, "VAL argument must be a string expression.");
    }

    return { ...expression, name, args: [source] };
  }

  if (name && isNumericRuntimeFunctionName(name)) {
    if (expression.args.length !== 1) {
      throw new DiagnosticError(expression.location, `${name} expects exactly one argument.`);
    }
    const value = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope, structValues);

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
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope, structValues);
    const start = foldExpression(expression.args[1], constants, unknownIdentifierIsError, arrays, functions, scope, structValues);
    const length = expression.args[2] ? foldExpression(expression.args[2], constants, unknownIdentifierIsError, arrays, functions, scope, structValues) : undefined;

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
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope, structValues);
    const length = foldExpression(expression.args[1], constants, unknownIdentifierIsError, arrays, functions, scope, structValues);

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
    const source = foldExpression(expression.args[0], constants, unknownIdentifierIsError, arrays, functions, scope, structValues);

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
    case "struct-field-access":
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
    case "struct-field-access":
      return expression.valueType === "string" || isStringVariableName(expression.field);
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
    } else if (statement.kind === "globals") {
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
  structs: Map<string, StructDefinition>,
  structValues: Map<string, StructValueDefinition>,
  scalarNames: Set<string>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  devices: ReadonlySet<string>
): Statement {
  const implementation = implementationWithStructFields(definition.implementation, structs, definition.statement.location);
  const functionStatement = { ...definition.statement, implementation };
  const scopedDefinition = { ...definition, statement: functionStatement, implementation };
  const scope = createFunctionScope(scopedDefinition);
  const functionStructValues = new Map(structValues);
  for (const parameter of implementation.parameters) {
    if (!parameter.asType || !parameter.structFields) {
      continue;
    }
    const struct = structs.get(normalizeName(parameter.asType));
    if (!struct) {
      throw new DiagnosticError(definition.statement.location, `Unknown STRUCT type "${parameter.asType}" used by FUNCTION ${definition.name}.`);
    }
    functionStructValues.set(normalizeName(parameter.sourceName), {
      name: parameter.storageName,
      typeName: struct.name,
      dimensions: [],
      fields: struct.fields,
      location: definition.statement.location
    });
    functionStructValues.set(normalizeName(parameter.storageName), {
      name: parameter.storageName,
      typeName: struct.name,
      dimensions: [],
      fields: struct.fields,
      location: definition.statement.location
    });
  }
  const body = analyzeStatements(functionStatement.body, constants, false, arrays, structs, functionStructValues, scalarNames, functions, devices, scope, false);
  return {
    ...functionStatement,
    parameters: functionStatement.parameters,
    body,
    implementation
  };
}

function analyzeTest(
  statement: Extract<Statement, { kind: "test" }>,
  constants: Map<string, ConstantDefinition>,
  arrays: Map<string, ArrayDefinition>,
  structs: Map<string, StructDefinition>,
  structValues: Map<string, StructValueDefinition>,
  scalarNames: Set<string>,
  functions: ReadonlyMap<string, FunctionDefinition>,
  devices: ReadonlySet<string>,
  testMode: boolean
): Statement {
  const scope = createTestScope(statement);
  const body = analyzeStatements(statement.body, constants, false, arrays, structs, structValues, scalarNames, functions, devices, scope, testMode);
  return {
    ...statement,
    body,
    implementation: statement.implementation
  };
}

function implementationWithStructFields(
  implementation: Extract<Statement, { kind: "function" }>["implementation"],
  structs: ReadonlyMap<string, StructDefinition>,
  location: Expression["location"]
): NonNullable<Extract<Statement, { kind: "function" }>["implementation"]> {
  if (!implementation) {
    throw new DiagnosticError(location, "Internal error: FUNCTION implementation missing before analysis.");
  }
  return {
    ...implementation,
    parameters: implementation.parameters.map((parameter) => {
      if (!parameter.asType) {
        return parameter;
      }
      const struct = structs.get(normalizeName(parameter.asType));
      if (!struct) {
        throw new DiagnosticError(location, `Unknown STRUCT type "${parameter.asType}" used by parameter "${parameter.sourceName}".`);
      }
      return {
        ...parameter,
        structFields: struct.fields.map((field) => ({
          sourceName: field.name,
          storageName: structFieldStorageName(parameter.storageName, field),
          valueType: field.valueType
        }))
      };
    })
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
