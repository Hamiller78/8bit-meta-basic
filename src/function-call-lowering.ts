import type { Expression, FunctionImplementation, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { deviceSourceList, parseSourceDeviceName, type DeviceKind } from "./devices.js";
import { builtinFunctions } from "./functions.js";
import type { Instruction } from "./lowering.js";
import { normalizeName } from "./symbols.js";

export interface FunctionCallLoweringContext {
  readonly functions: ReadonlyMap<string, FunctionImplementation>;
  readonly inlineFunctions?: ReadonlyMap<string, InlineFunctionImplementation>;
  readonly expandInlineFunctionCall?: (
    definition: InlineFunctionImplementation,
    args: readonly Expression[],
    destinationName: string | undefined,
    instructions: Instruction[]
  ) => Expression | undefined;
  readonly transformExpandedExpression?: (expression: Expression) => Expression;
  nextTempId: number;
}

export interface InlineFunctionImplementation {
  readonly name: string;
  readonly returnsValue: boolean;
  readonly implementation: FunctionImplementation;
  readonly body: readonly Statement[];
}

export function collectFunctionImplementations(statements: readonly Statement[]): ReadonlyMap<string, FunctionImplementation> {
  const functions = new Map<string, FunctionImplementation>();
  for (const statement of statements) {
    if (statement.kind === "function" && statement.implementation && !statement.inline) {
      functions.set(normalizeName(statement.name), statement.implementation);
    }
  }
  return functions;
}

export function collectInlineFunctionImplementations(statements: readonly Statement[]): ReadonlyMap<string, InlineFunctionImplementation> {
  const functions = new Map<string, InlineFunctionImplementation>();
  for (const statement of statements) {
    if (statement.kind === "function" && statement.implementation && statement.inline) {
      functions.set(normalizeName(statement.name), {
        name: statement.name,
        returnsValue: statement.body.some((bodyStatement) => bodyStatement.kind === "return" && bodyStatement.expression),
        implementation: statement.implementation,
        body: statement.body
      });
    }
  }
  return functions;
}

export function expandFunctionCalls(expression: Expression, instructions: Instruction[], context: FunctionCallLoweringContext): Expression {
  switch (expression.kind) {
    case "function-call": {
      if (expression.name === builtinFunctions.deviceAvailable) {
        return expandDeviceAvailableCall(expression, instructions, context);
      }

      const inlineImplementation = context.inlineFunctions?.get(normalizeName(expression.name));
      if (inlineImplementation) {
        if (!inlineImplementation.returnsValue) {
          throw new DiagnosticError(expression.location, `FUNCTION ${inlineImplementation.name} does not return a value and can only be called as a statement.`);
        }
        const args = expression.args.map((arg) => transformExpandedExpression(expandFunctionCalls(arg, instructions, context), context));
        validateArgumentCount(expression, inlineImplementation.implementation);
        const tempName = nextTempName(context, inlineImplementation.implementation.returnName);
        const result = context.expandInlineFunctionCall?.(inlineImplementation, args, tempName, instructions);
        return result ?? { kind: "identifier", name: tempName, location: expression.location };
      }

      const implementation = context.functions.get(normalizeName(expression.name));
      const args = expression.args.map((arg) => transformExpandedExpression(expandFunctionCalls(arg, instructions, context), context));
      if (!implementation) {
        return { ...expression, args };
      }
      validateArgumentCount(expression, implementation);
      emitParameterAssignments(expression.name, implementation, args, instructions, expression.location);
      instructions.push({ kind: "gosub", label: implementation.entryLabel, location: expression.location });
      const tempName = nextTempName(context, implementation.returnName);
      instructions.push({
        kind: "let",
        name: tempName,
        expression: { kind: "identifier", name: implementation.returnName, location: expression.location },
        location: expression.location
      });
      return { kind: "identifier", name: tempName, location: expression.location };
    }
    case "array-access":
      return { ...expression, indices: expression.indices.map((index) => transformExpandedExpression(expandFunctionCalls(index, instructions, context), context)) };
    case "struct-field-access":
      return { ...expression, indices: expression.indices.map((index) => transformExpandedExpression(expandFunctionCalls(index, instructions, context), context)) };
    case "parenthesized":
      return { ...expression, expression: expandFunctionCalls(expression.expression, instructions, context) };
    case "unary":
      return { ...expression, operand: expandFunctionCalls(expression.operand, instructions, context) };
    case "binary":
      return {
        ...expression,
        left: expandFunctionCalls(expression.left, instructions, context),
        right: expandFunctionCalls(expression.right, instructions, context)
      };
    case "number":
    case "string":
    case "boolean":
    case "color":
    case "identifier":
      return expression;
  }
}

export function expandFunctionCallIntoDestination(
  expression: Expression,
  destinationName: string,
  instructions: Instruction[],
  context: FunctionCallLoweringContext,
  sourceName?: string
): boolean {
  if (expression.kind !== "function-call") {
    return false;
  }

  if (expression.name === builtinFunctions.deviceAvailable) {
    expandDeviceAvailableCallIntoDestination(expression, destinationName, instructions, sourceName);
    return true;
  }

  const implementation = context.functions.get(normalizeName(expression.name));
  const inlineImplementation = context.inlineFunctions?.get(normalizeName(expression.name));
  if (inlineImplementation) {
    if (!inlineImplementation.returnsValue) {
      throw new DiagnosticError(expression.location, `FUNCTION ${inlineImplementation.name} does not return a value and can only be called as a statement.`);
    }
    const args = expression.args.map((arg) => transformExpandedExpression(expandFunctionCalls(arg, instructions, context), context));
    validateArgumentCount(expression, inlineImplementation.implementation);
    context.expandInlineFunctionCall?.(inlineImplementation, args, destinationName, instructions);
    return true;
  }

  if (!implementation) {
    return false;
  }

  const args = expression.args.map((arg) => transformExpandedExpression(expandFunctionCalls(arg, instructions, context), context));
  validateArgumentCount(expression, implementation);
  emitParameterAssignments(expression.name, implementation, args, instructions, expression.location);
  instructions.push({ kind: "gosub", label: implementation.entryLabel, location: expression.location });
  instructions.push({
    kind: "let",
    name: destinationName,
    expression: { kind: "identifier", name: implementation.returnName, location: expression.location },
    ...(sourceName ? { sourceName } : {}),
    location: expression.location
  });
  return true;
}

export function expandFunctionCallForSideEffect(
  expression: Extract<Expression, { kind: "function-call" }>,
  instructions: Instruction[],
  context: FunctionCallLoweringContext
): void {
  const implementation = context.functions.get(normalizeName(expression.name));
  const inlineImplementation = context.inlineFunctions?.get(normalizeName(expression.name));
  if (inlineImplementation) {
    const args = expression.args.map((arg) => transformExpandedExpression(expandFunctionCalls(arg, instructions, context), context));
    validateArgumentCount(expression, inlineImplementation.implementation);
    context.expandInlineFunctionCall?.(inlineImplementation, args, undefined, instructions);
    return;
  }

  if (!implementation) {
    throw new DiagnosticError(expression.location, `Unknown FUNCTION "${expression.name}".`);
  }

  const args = expression.args.map((arg) => transformExpandedExpression(expandFunctionCalls(arg, instructions, context), context));
  validateArgumentCount(expression, implementation);
  emitParameterAssignments(expression.name, implementation, args, instructions, expression.location);
  instructions.push({ kind: "gosub", label: implementation.entryLabel, location: expression.location });
}

function expandDeviceAvailableCall(expression: Extract<Expression, { kind: "function-call" }>, instructions: Instruction[], context: FunctionCallLoweringContext): Expression {
  if (expression.args.length !== 1) {
    throw new DiagnosticError(expression.location, "DEVICE_AVAILABLE expects exactly one argument.");
  }
  const [device] = expression.args;
  if (device.kind !== "identifier") {
    throw new DiagnosticError(expression.location, `DEVICE_AVAILABLE currently supports ${deviceSourceList}.`);
  }

  const deviceKind = deviceKindFromName(device.name, expression.location);
  const tempName = nextTempName(context, "MBDV");
  instructions.push({ kind: "check-device", name: tempName, device: deviceKind, location: expression.location });
  return { kind: "identifier", name: tempName, location: expression.location };
}

function expandDeviceAvailableCallIntoDestination(
  expression: Extract<Expression, { kind: "function-call" }>,
  destinationName: string,
  instructions: Instruction[],
  sourceName?: string
): void {
  if (expression.args.length !== 1) {
    throw new DiagnosticError(expression.location, "DEVICE_AVAILABLE expects exactly one argument.");
  }
  const [device] = expression.args;
  if (device.kind !== "identifier") {
    throw new DiagnosticError(expression.location, `DEVICE_AVAILABLE currently supports ${deviceSourceList}.`);
  }

  const deviceKind = deviceKindFromName(device.name, expression.location);
  instructions.push({ kind: "check-device", name: destinationName, device: deviceKind, ...(sourceName ? { sourceName } : {}), location: expression.location });
}

function deviceKindFromName(name: string, location: Expression["location"]): DeviceKind {
  const device = parseSourceDeviceName(name);
  if (!device) {
    throw new DiagnosticError(location, `DEVICE_AVAILABLE currently supports ${deviceSourceList}.`);
  }
  return device;
}

function nextTempName(context: FunctionCallLoweringContext, returnName: string): string {
  const suffix = returnName.endsWith("$") ? "$" : returnName.endsWith("%") ? "%" : "";
  const name = `MBT${context.nextTempId}${suffix}`;
  context.nextTempId += 1;
  return name;
}

function transformExpandedExpression(expression: Expression, context: FunctionCallLoweringContext): Expression {
  return context.transformExpandedExpression ? context.transformExpandedExpression(expression) : expression;
}

function validateArgumentCount(expression: Extract<Expression, { kind: "function-call" }>, implementation: FunctionImplementation): void {
  if (expression.args.length !== implementation.parameters.length) {
    throw new DiagnosticError(expression.location, `FUNCTION ${expression.name} expects ${implementation.parameters.length} argument${implementation.parameters.length === 1 ? "" : "s"}.`);
  }
}

function emitParameterAssignments(
  functionName: string,
  implementation: FunctionImplementation,
  args: readonly Expression[],
  instructions: Instruction[],
  location: Expression["location"]
): void {
  for (let index = 0; index < args.length; index += 1) {
    const parameter = implementation.parameters[index];
    const arg = args[index];
    if (parameter.structFields) {
      if (arg.kind !== "identifier") {
        throw new DiagnosticError(arg.location, `FUNCTION ${functionName} parameter "${parameter.sourceName}" expects a scalar STRUCT ${parameter.asType} value.`);
      }
      for (const field of parameter.structFields) {
        instructions.push({
          kind: "let",
          name: field.storageName,
          expression: { kind: "identifier", name: `${arg.name}_${field.sourceName.replace(/[$%]$/u, "")}${field.valueType === "string" ? "$" : ""}`, location },
          location
        });
      }
      continue;
    }
    instructions.push({
      kind: "let",
      name: parameter.storageName,
      expression: arg,
      location
    });
  }
}
