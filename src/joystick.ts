import type { Expression } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";

export const joystickControls = { JOY_X: 0, JOY_Y: 1, JOY_FIRE1: 2 } as const;
export type JoystickControl = (typeof joystickControls)[keyof typeof joystickControls];

export function joystickControl(expression: Expression): JoystickControl {
  if (expression.kind !== "number" || !Object.values(joystickControls).some(value => value === expression.value)) {
    throw new DiagnosticError(expression.location, "Joystick selector must be a compile-time constant: JOY_X, JOY_Y, or JOY_FIRE1.");
  }
  return expression.value as JoystickControl;
}

export const testJoystickNames = ["MBTJX", "MBTJY", "MBTJF"] as const;
