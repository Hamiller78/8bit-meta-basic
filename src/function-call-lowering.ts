import type { Expression, FunctionImplementation, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
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

function nextTempName(context: FunctionCallLoweringContext, returnName: string): string {
  const suffix = returnName.endsWith("$") ? "$" : returnName.endsWith("%") ? "%" : "";
  const name = `MBT${context.nextTempId}${suffix}`;
  context.nextTempId += 1;
  return name;
}
