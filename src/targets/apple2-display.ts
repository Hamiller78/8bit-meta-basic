import type { Expression } from "../ast.js";
import { normalizeLabel, type Instruction, type LoweredProgram } from "../lowering.js";
import { rebuildLabels } from "./target.js";

// $0300-$030C: uppercase ASCII lowercase bytes and pass them to COUT1.
// $0348-$0349: temporarily saved monitor output vector.
const displayRoutine = [201, 225, 144, 6, 201, 251, 176, 2, 41, 223, 76, 240, 253] as const;

function mayContainLowercase(expression: Expression): boolean {
  switch (expression.kind) {
    case "string": return /[a-z]/u.test(expression.value);
    case "identifier": case "array-access": return expression.valueType === "string" || expression.name.endsWith("$");
    case "struct-field-access": return expression.valueType === "string" || expression.field.endsWith("$");
    case "function-call": return expression.valueType === "string" || expression.name.endsWith("$");
    case "parenthesized": return mayContainLowercase(expression.expression);
    case "binary": return mayContainLowercase(expression.left) || mayContainLowercase(expression.right);
    default: return false;
  }
}

/** Make screen text readable on an unmodified II Plus without changing string values. */
export function lowerApple2PlusDisplay(program: LoweredProgram): LoweredProgram {
  const labels = new Set([...program.labels.keys()].map(normalizeLabel));
  let serial = 0, used = false;
  const label = (): string => {
    let value: string;
    do { value = `__mb_apple_display_${serial++}`; } while (labels.has(normalizeLabel(value)));
    labels.add(normalizeLabel(value));
    return value;
  };
  const lower = (instruction: Instruction): Instruction[] => {
    if (instruction.kind === "if-then") return [{ ...instruction, body: instruction.body.flatMap(lower) }];
    if (instruction.kind !== "print" || !instruction.items.some(mayContainLowercase)) return [instruction];
    used = true;
    const location = instruction.location, plain = label(), done = label();
    const n = (value: number): Expression => ({ kind: "number", value, raw: String(value), location });
    const peek = (value: number): Expression => ({ kind: "function-call", name: "__APPLE2_PEEK", args: [n(value)], valueType: "number", location });
    const poke = (address: number, value: Expression): Instruction => ({ kind: "poke", address, value, location });
    return [
      { kind: "if-goto", condition: { kind: "binary", operator: "<>", left: peek(64435), right: n(234), location }, label: plain, location },
      poke(840, peek(54)), poke(841, peek(55)), poke(54, n(0)), poke(55, n(3)),
      instruction,
      poke(54, peek(840)), poke(55, peek(841)), { kind: "goto", label: done, location },
      { kind: "label", name: plain, internal: true, location }, instruction,
      { kind: "label", name: done, internal: true, location }
    ];
  };
  const output = program.instructions.flatMap(lower);
  if (!used) return program;
  const location = program.instructions[0].location;
  const setup: Instruction[] = displayRoutine.map((value, index) => ({ kind: "poke", address: 768 + index, value: { kind: "number", value, raw: String(value), location }, location }));
  return rebuildLabels(program, [...setup, ...output]);
}
