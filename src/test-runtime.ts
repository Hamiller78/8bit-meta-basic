import type { Expression } from "./ast.js";
import { builtinFunctions, canonicalFunctionName } from "./functions.js";

export const testJiffiesName = "MBTJIF";
export const testKeyCodeName = "MBTKC";
export const testKeyPressedName = "MBTKP";

export function isTestRuntimeSetterName(name: string): boolean {
  const canonical = canonicalTestRuntimeSetterName(name);
  return canonical !== undefined;
}

export function canonicalTestRuntimeSetterName(name: string): typeof builtinFunctions.setJiffies | typeof builtinFunctions.setKeyCode | typeof builtinFunctions.setKeyPressed | undefined {
  const canonical = canonicalFunctionName(name);
  if (canonical === builtinFunctions.setJiffies || canonical === builtinFunctions.setKeyCode || canonical === builtinFunctions.setKeyPressed) {
    return canonical;
  }

  return undefined;
}

export function setterStorageName(name: typeof builtinFunctions.setJiffies | typeof builtinFunctions.setKeyCode | typeof builtinFunctions.setKeyPressed): string {
  switch (name) {
    case builtinFunctions.setJiffies:
      return testJiffiesName;
    case builtinFunctions.setKeyCode:
      return testKeyCodeName;
    case builtinFunctions.setKeyPressed:
      return testKeyPressedName;
  }
}

export function replaceTestRuntimeFunctionCalls(expression: Expression): Expression {
  switch (expression.kind) {
    case "function-call": {
      const replacement = testRuntimeFunctionStorageName(expression.name);
      if (replacement) {
        return { kind: "identifier", name: replacement, location: expression.location };
      }
      return { ...expression, args: expression.args.map(replaceTestRuntimeFunctionCalls) };
    }
    case "array-access":
      return { ...expression, indices: expression.indices.map(replaceTestRuntimeFunctionCalls) };
    case "struct-field-access":
      return { ...expression, indices: expression.indices.map(replaceTestRuntimeFunctionCalls) };
    case "parenthesized":
      return { ...expression, expression: replaceTestRuntimeFunctionCalls(expression.expression) };
    case "unary":
      return { ...expression, operand: replaceTestRuntimeFunctionCalls(expression.operand) };
    case "binary":
      return { ...expression, left: replaceTestRuntimeFunctionCalls(expression.left), right: replaceTestRuntimeFunctionCalls(expression.right) };
    case "number":
    case "string":
    case "boolean":
    case "color":
    case "identifier":
      return expression;
  }
}

function testRuntimeFunctionStorageName(name: string): string | undefined {
  const canonical = canonicalFunctionName(name);
  switch (canonical) {
    case builtinFunctions.jiffies:
      return testJiffiesName;
    case builtinFunctions.keyCode:
      return testKeyCodeName;
    case builtinFunctions.keyPressed:
      return testKeyPressedName;
    default:
      return undefined;
  }
}
