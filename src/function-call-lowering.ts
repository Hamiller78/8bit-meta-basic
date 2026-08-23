import type { Expression, FunctionImplementation, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { builtinFunctions } from "./functions.js";
import type { Instruction } from "./lowering.js";
import { normalizeName } from "./symbols.js";

export interface FunctionCallLoweringContext {
  readonly functions: ReadonlyMap<string, FunctionImplementation>;
  nextTempId: number;
}

export function collectFunctionImplementations(statements: readonly Statement[]): ReadonlyMap<string, FunctionImplementation> {
  const functions = new Map<string, FunctionImplementation>();
  for (const statement of statements) {
    if (statement.kind === "function" && statement.implementation) {
      functions.set(normalizeName(statement.name), statement.implementation);
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

      const implementation = context.functions.get(normalizeName(expression.name));
      const args = expression.args.map((arg) => expandFunctionCalls(arg, instructions, context));
      if (!implementation) {
        return { ...expression, args };
      }
      if (args.length !== implementation.parameters.length) {
        throw new DiagnosticError(expression.location, `FUNCTION ${expression.name} expects ${implementation.parameters.length} argument${implementation.parameters.length === 1 ? "" : "s"}.`);
      }
      for (let index = 0; index < args.length; index += 1) {
        instructions.push({
          kind: "let",
          name: implementation.parameters[index].storageName,
          expression: args[index],
          location: expression.location
        });
      }
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
      return { ...expression, indices: expression.indices.map((index) => expandFunctionCalls(index, instructions, context)) };
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
  context: FunctionCallLoweringContext
): boolean {
  if (expression.kind !== "function-call") {
    return false;
  }

  if (expression.name === builtinFunctions.deviceAvailable) {
    expandDeviceAvailableCallIntoDestination(expression, destinationName, instructions);
    return true;
  }

  const implementation = context.functions.get(normalizeName(expression.name));
  if (!implementation) {
    return false;
  }

  const args = expression.args.map((arg) => expandFunctionCalls(arg, instructions, context));
  if (args.length !== implementation.parameters.length) {
    throw new DiagnosticError(expression.location, `FUNCTION ${expression.name} expects ${implementation.parameters.length} argument${implementation.parameters.length === 1 ? "" : "s"}.`);
  }
  for (let index = 0; index < args.length; index += 1) {
    instructions.push({
      kind: "let",
      name: implementation.parameters[index].storageName,
      expression: args[index],
      location: expression.location
    });
  }
  instructions.push({ kind: "gosub", label: implementation.entryLabel, location: expression.location });
  instructions.push({
    kind: "let",
    name: destinationName,
    expression: { kind: "identifier", name: implementation.returnName, location: expression.location },
    location: expression.location
  });
  return true;
}

function expandDeviceAvailableCall(expression: Extract<Expression, { kind: "function-call" }>, instructions: Instruction[], context: FunctionCallLoweringContext): Expression {
  if (expression.args.length !== 1) {
    throw new DiagnosticError(expression.location, "DEVICE_AVAILABLE expects exactly one argument.");
  }
  const [device] = expression.args;
  if (device.kind !== "identifier") {
    throw new DiagnosticError(expression.location, "DEVICE_AVAILABLE currently supports PRINTER and RS232.");
  }

  const deviceKind = deviceKindFromName(device.name, expression.location);
  const tempName = nextTempName(context, "MBDV");
  instructions.push({ kind: "check-device", name: tempName, device: deviceKind, location: expression.location });
  return { kind: "identifier", name: tempName, location: expression.location };
}

function expandDeviceAvailableCallIntoDestination(expression: Extract<Expression, { kind: "function-call" }>, destinationName: string, instructions: Instruction[]): void {
  if (expression.args.length !== 1) {
    throw new DiagnosticError(expression.location, "DEVICE_AVAILABLE expects exactly one argument.");
  }
  const [device] = expression.args;
  if (device.kind !== "identifier") {
    throw new DiagnosticError(expression.location, "DEVICE_AVAILABLE currently supports PRINTER and RS232.");
  }

  const deviceKind = deviceKindFromName(device.name, expression.location);
  instructions.push({ kind: "check-device", name: destinationName, device: deviceKind, location: expression.location });
}

function deviceKindFromName(name: string, location: Expression["location"]): "printer" | "rs232" {
  switch (name.toUpperCase()) {
    case "PRINTER":
      return "printer";
    case "RS232":
      return "rs232";
    default:
      throw new DiagnosticError(location, "DEVICE_AVAILABLE currently supports PRINTER and RS232.");
  }
}

function nextTempName(context: FunctionCallLoweringContext, returnName: string): string {
  const suffix = returnName.endsWith("$") ? "$" : returnName.endsWith("%") ? "%" : "";
  const name = `MBT${context.nextTempId}${suffix}`;
  context.nextTempId += 1;
  return name;
}
