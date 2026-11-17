import type { Instruction, LoweredProgram } from "../lowering.js";
import { createGeneratedVariableNameAllocator } from "./string-array-lengths.js";
import { rebuildLabels } from "./target.js";

/** Expand dispatch when native ON rejects an out-of-range selector. */
export function lowerSafeDispatch(program: LoweredProgram, prefix: string): LoweredProgram {
  const allocate = createGeneratedVariableNameAllocator(program.instructions, prefix);
  const instructions: Instruction[] = [];
  for (const instruction of program.instructions) {
    if (instruction.kind !== "on-goto" && instruction.kind !== "on-gosub") {
      instructions.push(instruction);
      continue;
    }
    const temporary = allocate();
    instructions.push({ kind: "let", name: temporary, expression: instruction.expression, location: instruction.location });
    for (const [index, label] of instruction.labels.entries()) {
      instructions.push({
        kind: instruction.kind === "on-goto" ? "if-goto" : "if-gosub",
        condition: {
          kind: "binary", operator: "=", location: instruction.location,
          left: { kind: "identifier", name: temporary, location: instruction.location },
          right: { kind: "number", value: index + 1, raw: String(index + 1), location: instruction.location }
        },
        label, location: instruction.location
      });
    }
  }
  return rebuildLabels(program, instructions);
}
