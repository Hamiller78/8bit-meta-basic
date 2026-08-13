import type { Instruction, LoweredProgram } from "./lowering.js";
import { normalizeLabel } from "./lowering.js";

export interface NumberedLine {
  readonly number: number;
  readonly instruction: Instruction;
}

export interface NumberedProgram {
  readonly lines: readonly NumberedLine[];
  readonly labelLines: ReadonlyMap<string, number>;
}

export function assignLineNumbers(program: LoweredProgram): NumberedProgram {
  const lines = program.instructions.map((instruction, index) => ({
    number: 10 + index * 10,
    instruction
  }));
  const labelLines = new Map<string, number>();

  for (const [key, label] of program.labels) {
    const line = lines[label.index];
    if (!line) {
      throw new Error(`Internal error: label "${label.name}" has no numbered line.`);
    }
    labelLines.set(key, line.number);
  }

  return { lines, labelLines };
}

export function resolveLabel(labelLines: ReadonlyMap<string, number>, label: string): number {
  const line = labelLines.get(normalizeLabel(label));
  if (line === undefined) {
    throw new Error(`Internal error: unresolved label "${label}".`);
  }

  return line;
}
