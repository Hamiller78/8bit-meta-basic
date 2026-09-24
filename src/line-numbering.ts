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
  readonly instructions: readonly Instruction[];
  readonly instructionIndices: readonly number[];
}

export interface NumberedProgram {
  readonly lines: readonly NumberedLine[];
  readonly labelLines: ReadonlyMap<string, number>;
}

export interface LineNumberingOptions {
  readonly maxLineNumber: number;
  readonly targetName: string;
  readonly packingBreaks?: ReadonlySet<number>;
}

export function assignLineNumbers(program: LoweredProgram, readability: ReadabilityLevel, options: LineNumberingOptions): NumberedProgram {
  const emittedInstructions = program.instructions
    .map((instruction, instructionIndex) => ({ instruction, instructionIndex }))
    .filter(({ instruction }) => shouldEmitInstruction(instruction, readability));
  const instructionGroups = readability === 0
    ? packEmittedInstructions(emittedInstructions, options.packingBreaks ?? new Set<number>())
    : emittedInstructions.map((entry) => [entry]);
  const increment = chooseLineNumberIncrement(instructionGroups, options);

  const lines: NumberedLine[] = instructionGroups.map((group, lineIndex) => ({
    number: startingLineNumber + lineIndex * increment,
    instruction: group[0].instruction,
    instructionIndex: group[0].instructionIndex,
    instructions: group.map((entry) => entry.instruction),
    instructionIndices: group.map((entry) => entry.instructionIndex)
  }));
  const labelLines = new Map<string, number>();
  const terminalLabelLines: number[] = [];

  for (const [key, label] of program.labels) {
    const line = resolveLabelLine(lines, label.index, increment);
    if (line > options.maxLineNumber) {
      throw new DiagnosticError(
        label.location,
        `Generated ${options.targetName} BASIC label "${label.name}" resolves to line ${line}, exceeding the maximum line number ${options.maxLineNumber}.`
      );
    }
    labelLines.set(key, line);
    if (line > (lines.at(-1)?.number ?? 0)) {
      terminalLabelLines.push(line);
    }
  }

  if (terminalLabelLines.length > 0) {
    const line = Math.min(...terminalLabelLines);
    lines.push({
      number: line,
      instruction: {
        kind: "rem",
        text: "END",
        location: program.instructions.at(-1)?.location ?? { filename: "<generated>", line: 1 }
      },
      instructionIndex: program.instructions.length,
      instructions: [{
        kind: "rem",
        text: "END",
        location: program.instructions.at(-1)?.location ?? { filename: "<generated>", line: 1 }
      }],
      instructionIndices: [program.instructions.length]
    });
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
  emittedInstructions: readonly (readonly { readonly instruction: Instruction; readonly instructionIndex: number }[])[],
  options: LineNumberingOptions
): number {
  if (emittedInstructions.length === 0 || lastLineNumber(emittedInstructions.length, defaultLineNumberIncrement) <= options.maxLineNumber) {
    return defaultLineNumberIncrement;
  }

  if (lastLineNumber(emittedInstructions.length, denseLineNumberIncrement) <= options.maxLineNumber) {
    return denseLineNumberIncrement;
  }

  const maxDenseLines = Math.max(0, options.maxLineNumber - startingLineNumber + 1);
  const overflow = emittedInstructions[maxDenseLines]?.[0] ?? emittedInstructions.at(-1)?.[0];
  throw new DiagnosticError(
    overflow?.instruction.location ?? { filename: "<generated>", line: 1 },
    `Generated ${options.targetName} BASIC program needs ${emittedInstructions.length} numbered lines, but line numbers starting at ${startingLineNumber} cannot exceed ${options.maxLineNumber}.`
  );
}

function lastLineNumber(lineCount: number, increment: number): number {
  return startingLineNumber + (lineCount - 1) * increment;
}

function resolveLabelLine(lines: readonly NumberedLine[], labelIndex: number, increment: number): number {
  const exactLine = lines.find((line) => line.instructionIndices.includes(labelIndex));
  if (exactLine) {
    return exactLine.number;
  }

  const nextLine = lines.find((line) => line.instructionIndices.some((index) => index > labelIndex));
  if (nextLine) {
    return nextLine.number;
  }

  const lastLine = lines.at(-1);
  return lastLine ? lastLine.number + increment : startingLineNumber;
}

type EmittedInstruction = { readonly instruction: Instruction; readonly instructionIndex: number };

function packEmittedInstructions(instructions: readonly EmittedInstruction[], packingBreaks: ReadonlySet<number>): readonly (readonly EmittedInstruction[])[] {
  const groups: EmittedInstruction[][] = [];
  for (let index = 0; index < instructions.length; index += 1) {
    const loop = simpleLoopGroupAt(instructions, index, packingBreaks);
    if (loop) {
      groups.push(loop);
      index += loop.length - 1;
      continue;
    }
    const entry = instructions[index];
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (group && previous && group.length < 4 && !packingBreaks.has(entry.instructionIndex) && canPackTogether(previous, entry)) {
      group.push(entry);
    } else {
      groups.push([entry]);
    }
  }
  return groups;
}

function simpleLoopGroupAt(instructions: readonly EmittedInstruction[], start: number, packingBreaks: ReadonlySet<number>): EmittedInstruction[] | undefined {
  const first = instructions[start];
  if (first?.instruction.kind !== "for") {
    return undefined;
  }
  for (let end = start + 2; end < Math.min(instructions.length, start + 4); end += 1) {
    const candidate = instructions[end];
    if (candidate.instruction.kind !== "next" || candidate.instruction.variable.toLowerCase() !== first.instruction.variable.toLowerCase()) {
      continue;
    }
    const group = instructions.slice(start, end + 1);
    if (group.slice(1, -1).every((entry) => isPackableInstruction(entry.instruction)) &&
        group.every((entry, offset) => offset === 0 || (entry.instructionIndex === group[offset - 1].instructionIndex + 1 && !packingBreaks.has(entry.instructionIndex)))) {
      return [...group];
    }
  }
  return undefined;
}

function canPackTogether(left: EmittedInstruction, right: EmittedInstruction): boolean {
  if (right.instructionIndex !== left.instructionIndex + 1 || !isPackableInstruction(left.instruction) || !isPackableInstruction(right.instruction)) {
    return false;
  }
  return left.instruction.location.filename === right.instruction.location.filename &&
    left.instruction.location.line === right.instruction.location.line &&
    left.instruction.location.column === right.instruction.location.column;
}

function isPackableInstruction(instruction: Instruction): boolean {
  switch (instruction.kind) {
    case "let":
    case "multi-let":
    case "array-let":
    case "cls":
    case "border-color":
    case "text-color":
    case "screen-background-color":
    case "cell-text-color":
    case "cell-background-color":
    case "suppress-scroll-prompt":
    case "program-mode":
    case "paper":
    case "print":
    case "print-device":
    case "open-device":
    case "close-device":
    case "check-device":
    case "read":
    case "restore":
    case "dim-array":
    case "dim-string":
    case "read-key":
    case "randomize":
    case "position":
    case "setcolor":
    case "poke":
    case "print-chr":
    case "sys":
      return true;
    default:
      return false;
  }
}
