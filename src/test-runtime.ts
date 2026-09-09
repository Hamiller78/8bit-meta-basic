import type { Expression } from "./ast.js";
import { builtinFunctions, canonicalFunctionName } from "./functions.js";
import { joystickControl, testJoystickNames } from "./joystick.js";

export const testJiffiesName = "MBTJIF";
export const testKeyCodeName = "MBTKC";
export const testKeyPressedName = "MBTKP";

export function isTestRuntimeSetterName(name: string): boolean {
  const canonical = canonicalTestRuntimeSetterName(name);
  return canonical !== undefined;
}

type TestRuntimeSetter = typeof builtinFunctions.setJiffies | typeof builtinFunctions.setKeyCode | typeof builtinFunctions.setKeyPressed | typeof builtinFunctions.setJoystick;

export function canonicalTestRuntimeSetterName(name: string): TestRuntimeSetter | undefined {
  const canonical = canonicalFunctionName(name);
  if (canonical === builtinFunctions.setJiffies || canonical === builtinFunctions.setKeyCode || canonical === builtinFunctions.setKeyPressed || canonical === builtinFunctions.setJoystick) {
    return canonical;
  }

  return undefined;
}

export function setterStorageName(name: TestRuntimeSetter, selector?: Expression): string {
  switch (name) {
    case builtinFunctions.setJoystick:
      if (!selector) throw new Error("Missing joystick selector after semantic analysis.");
      return testJoystickNames[joystickControl(selector)];
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
      if (canonicalFunctionName(expression.name) === builtinFunctions.getJoystick) {
        return { kind: "identifier", name: testJoystickNames[joystickControl(expression.args[0])], location: expression.location };
      }
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
