import type { Instruction, LoweredProgram } from "./lowering.js";
import { normalizeLabel } from "./lowering.js";
import { DiagnosticError } from "./diagnostics.js";

export type ReadabilityLevel = 0 | 1 | 2;

const startingLineNumber = 10;
const defaultLineNumberIncrement = 10;
const denseLineNumberIncrement = 1;

export interface NumberedLine {
  readonly number: number;
  readonly instruction: Instruction;
  readonly instructionIndex: number;
}

export interface NumberedProgram {
  readonly lines: readonly NumberedLine[];
  readonly labelLines: ReadonlyMap<string, number>;
}

export interface LineNumberingOptions {
  readonly maxLineNumber: number;
  readonly targetName: string;
}

export function assignLineNumbers(program: LoweredProgram, readability: ReadabilityLevel, options: LineNumberingOptions): NumberedProgram {
  const emittedInstructions = program.instructions
    .map((instruction, instructionIndex) => ({ instruction, instructionIndex }))
    .filter(({ instruction }) => shouldEmitInstruction(instruction, readability));
  const increment = chooseLineNumberIncrement(emittedInstructions, options);

  const lines = emittedInstructions.map(({ instruction, instructionIndex }, lineIndex) => ({
    number: startingLineNumber + lineIndex * increment,
    instruction,
    instructionIndex
  }));
  const labelLines = new Map<string, number>();

  for (const [key, label] of program.labels) {
    const line = resolveLabelLine(lines, label.index, increment);
    if (line > options.maxLineNumber) {
      throw new DiagnosticError(
        label.location,
        `Generated ${options.targetName} BASIC label "${label.name}" resolves to line ${line}, exceeding the maximum line number ${options.maxLineNumber}.`
      );
    }
    labelLines.set(key, line);
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

function chooseLineNumberIncrement(
  emittedInstructions: readonly { readonly instruction: Instruction; readonly instructionIndex: number }[],
  options: LineNumberingOptions
): number {
  if (emittedInstructions.length === 0 || lastLineNumber(emittedInstructions.length, defaultLineNumberIncrement) <= options.maxLineNumber) {
    return defaultLineNumberIncrement;
  }

  if (lastLineNumber(emittedInstructions.length, denseLineNumberIncrement) <= options.maxLineNumber) {
    return denseLineNumberIncrement;
  }

  const maxDenseLines = Math.max(0, options.maxLineNumber - startingLineNumber + 1);
  const overflow = emittedInstructions[maxDenseLines] ?? emittedInstructions.at(-1);
  throw new DiagnosticError(
    overflow?.instruction.location ?? { filename: "<generated>", line: 1 },
    `Generated ${options.targetName} BASIC program needs ${emittedInstructions.length} numbered lines, but line numbers starting at ${startingLineNumber} cannot exceed ${options.maxLineNumber}.`
  );
}

function lastLineNumber(lineCount: number, increment: number): number {
  return startingLineNumber + (lineCount - 1) * increment;
}

function resolveLabelLine(lines: readonly NumberedLine[], labelIndex: number, increment: number): number {
  const exactLine = lines.find((line) => line.instructionIndex === labelIndex);
  if (exactLine) {
    return exactLine.number;
  }

  const nextLine = lines.find((line) => line.instructionIndex > labelIndex);
  if (nextLine) {
    return nextLine.number;
  }

  const lastLine = lines.at(-1);
  return lastLine ? lastLine.number + increment : startingLineNumber;
}
