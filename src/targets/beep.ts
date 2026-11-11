import type { Expression } from "../ast.js";
import { builtinFunctions } from "../functions.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { normalizeLabel } from "../lowering.js";
import { createGeneratedVariableNameAllocator } from "./string-array-lengths.js";
import { rebuildLabels, type TargetId } from "./target.js";

/** Expand portable beeps before target variable allocation and line numbering. */
export function lowerTargetBeeps(program: LoweredProgram, target: Exclude<TargetId, "spectrum">): LoweredProgram {
  if (!program.instructions.some((instruction) => instruction.kind === "beep")) return program;
  const allocate = createGeneratedVariableNameAllocator(program.instructions, "MBBEEP");
  const durationName = allocate();
  const frequencyName = allocate();
  const startName = allocate();
  const nowName = allocate();
  const remainingName = allocate();
  const labels = new Set([...program.labels.keys()].map(normalizeLabel));
  let labelCounter = 0;
  const label = (): string => {
    let name: string;
    do { name = `__mb_beep_${labelCounter++}`; } while (labels.has(normalizeLabel(name)));
    labels.add(normalizeLabel(name));
    return name;
  };
  const instructions: Instruction[] = [];
  for (const instruction of program.instructions) {
    if (instruction.kind !== "beep") { instructions.push(instruction); continue; }
    const loc = instruction.location;
    const num = (value: number): Expression => ({ kind: "number", value, raw: String(value), location: loc });
    const id = (name: string): Expression => ({ kind: "identifier", name, location: loc });
    const op = (operator: Extract<Expression, { kind: "binary" }>["operator"], left: Expression, right: Expression): Expression => ({ kind: "binary", operator, left, right, location: loc });
    const int = (expression: Expression): Expression => ({ kind: "function-call", name: builtinFunctions.int, args: [expression], valueType: "number", location: loc });
    const jiffies = (): Expression => ({ kind: "function-call", name: builtinFunctions.jiffies, args: [], valueType: "number", location: loc });
    const set = (name: string, expression: Expression): Instruction => ({ kind: "let", name, expression, location: loc });
    const poke = (address: number, value: Expression): Instruction => ({ kind: "poke", address, value, location: loc });
    const place = (name: string): Instruction => ({ kind: "label", name, internal: true, location: loc });
    const freq = (pitch: number): number => 261.625565 * Math.pow(2, pitch / 12);
    const convert = (pitch: number): number => target === "c64" ? Math.round(freq(pitch) * 16777216 / 985248)
      : target === "vic20" ? Math.round(255 - 8659 / freq(pitch))
      : target === "atari800xl" ? Math.round(31960 / freq(pitch) - 1)
      : Math.round(53 + 4 * pitch);
    let setting: Expression;
    if (instruction.pitch.kind === "number") {
      setting = num(convert(instruction.pitch.value));
    } else if (target === "agon") {
      setting = int(op("+", op("+", num(53), op("*", num(4), instruction.pitch)), num(0.5)));
    } else {
      const hz = op("*", num(261.625565), op("^", num(2), op("/", instruction.pitch, num(12))));
      const raw = target === "c64" ? op("*", hz, num(16777216 / 985248))
        : target === "vic20" ? op("-", num(255), op("/", num(8659), hz))
        : op("-", op("/", num(31960), hz), num(1));
      setting = int(op("+", raw, num(0.5)));
    }
    const done = label();
    const loop = label();
    const nextChunk = label();
    instructions.push(set(durationName, instruction.duration), set(frequencyName, setting));
    instructions.push({ kind: "if-goto", condition: op("<=", id(durationName), num(0)), label: done, location: loc });
    if (target === "c64") {
      instructions.push(poke(54296, num(15)), poke(54277, num(0)), poke(54278, num(240)));
      instructions.push(poke(54272, op("-", id(frequencyName), op("*", int(op("/", id(frequencyName), num(256))), num(256)))));
      instructions.push(poke(54273, int(op("/", id(frequencyName), num(256)))), poke(54276, num(17)));
    } else if (target === "vic20") {
      const oldVolume: Expression = { kind: "function-call", name: "__CBM_PEEK", args: [num(36878)], location: loc };
      const upperBits: Expression = { kind: "function-call", name: "__CBM_BITAND", args: [oldVolume, num(240)], location: loc };
      instructions.push(poke(36878, op("+", upperBits, num(15))), poke(36875, id(frequencyName)));
    } else if (target === "atari800xl") {
      instructions.push(poke(53768, num(0)), poke(53760, id(frequencyName)), poke(53761, num(175)));
    } else {
      instructions.push(set(remainingName, int(op("+", op("*", id(durationName), num(20)), num(0.999999)))));
      const positive = label();
      const chunkReady = label();
      instructions.push({ kind: "if-goto", condition: op(">", id(remainingName), num(0)), label: positive, location: loc });
      instructions.push(set(remainingName, num(1)), place(positive), place(nextChunk), set(durationName, id(remainingName)));
      instructions.push({ kind: "if-goto", condition: op("<=", id(durationName), num(254)), label: chunkReady, location: loc });
      instructions.push(set(durationName, num(254)), place(chunkReady));
      instructions.push(set(remainingName, op("-", id(remainingName), id(durationName))));
      instructions.push({ ...instruction, duration: id(durationName), pitch: id(frequencyName) });
    }
    const clockRate = target === "agon" ? 5 : target === "atari800xl" ? 50 : 60;
    instructions.push(set(durationName, op("*", id(durationName), num(clockRate))));
    instructions.push(set(startName, jiffies()), place(loop), set(nowName, jiffies()));
    const clockOk = label();
    instructions.push({ kind: "if-goto", condition: op(">=", id(nowName), id(startName)), label: clockOk, location: loc });
    instructions.push(set(startName, id(nowName)), place(clockOk));
    instructions.push(set(durationName, op("-", id(durationName), op("-", id(nowName), id(startName)))));
    instructions.push(set(startName, id(nowName)));
    instructions.push({ kind: "if-goto", condition: op(">", id(durationName), num(0)), label: loop, location: loc });
    if (target === "c64") instructions.push(poke(54276, num(16)));
    else if (target === "vic20") instructions.push(poke(36875, num(0)));
    else if (target === "atari800xl") instructions.push(poke(53761, num(0)));
    else {
      instructions.push({ kind: "if-goto", condition: op(">", id(remainingName), num(0)), label: nextChunk, location: loc });
      instructions.push({ ...instruction, duration: num(0), pitch: num(0) });
    }
    instructions.push(place(done));
  }
  return rebuildLabels(program, instructions);
}
