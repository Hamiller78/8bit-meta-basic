import type { Instruction, LoweredProgram } from "./lowering.js";
import { normalizeLabel } from "./lowering.js";

export type ReadabilityLevel = 0 | 1 | 2;

export interface NumberedLine {
  readonly number: number;
  readonly instruction: Instruction;
  readonly instructionIndex: number;
}

export interface NumberedProgram {
  readonly lines: readonly NumberedLine[];
  readonly labelLines: ReadonlyMap<string, number>;
}

export function assignLineNumbers(program: LoweredProgram, readability: ReadabilityLevel): NumberedProgram {
  const emittedInstructions = program.instructions
    .map((instruction, instructionIndex) => ({ instruction, instructionIndex }))
    .filter(({ instruction }) => shouldEmitInstruction(instruction, readability));

  const lines = emittedInstructions.map(({ instruction, instructionIndex }, lineIndex) => ({
    number: 10 + lineIndex * 10,
    instruction,
    instructionIndex
  }));
  const labelLines = new Map<string, number>();

  for (const [key, label] of program.labels) {
    labelLines.set(key, resolveLabelLine(lines, label.index));
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

function shouldEmitInstruction(instruction: Instruction, readability: ReadabilityLevel): boolean {
  if (instruction.kind !== "label") {
    return true;
  }

  if (readability === 2) {
    return true;
  }

  return readability === 1 && !instruction.internal;
}

function resolveLabelLine(lines: readonly NumberedLine[], labelIndex: number): number {
  const exactLine = lines.find((line) => line.instructionIndex === labelIndex);
  if (exactLine) {
    return exactLine.number;
  }

  const nextLine = lines.find((line) => line.instructionIndex > labelIndex);
  if (nextLine) {
    return nextLine.number;
  }

  const lastLine = lines.at(-1);
  return lastLine ? lastLine.number + 10 : 10;
}
