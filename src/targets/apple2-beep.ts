import type { BinaryOperator, Expression, SourceLocation } from "../ast.js";
import { normalizeLabel, type Instruction, type LoweredProgram } from "../lowering.js";
import { createGeneratedVariableNameAllocator } from "./string-array-lengths.js";
import { rebuildLabels } from "./target.js";

// $0320-$0339: speaker toggle and counted delay. $0350-$0353: parameters.
// Each low byte of zero means 256 iterations; high bytes count extra blocks.
// LDA $C030 / LDY $0350 / LDX $0351 / DEY / BNE -3 / DEX / BPL -6 /
// DEC $0352 / BNE -20 / DEC $0353 / BPL -25 / RTS.
const routineAddress = 800;
const routine = [173, 48, 192, 172, 80, 3, 174, 81, 3, 136, 208, 253, 202, 16, 250, 206, 82, 3, 208, 236, 206, 83, 3, 16, 231, 96] as const;

/** Use a blocking, cycle-counted speaker routine without claiming a system clock. */
export function lowerApple2Beeps(program: LoweredProgram): LoweredProgram {
  if (!program.instructions.some((instruction) => instruction.kind === "beep")) return program;
  const allocate = createGeneratedVariableNameAllocator(program.instructions, "MBAPPLEBEEP");
  const duration = allocate(), pitch = allocate(), frequency = allocate(), delay = allocate(), remaining = allocate(), chunk = allocate();
  const labels = new Set([...program.labels.keys()].map(normalizeLabel));
  let serial = 0;
  const label = (): string => {
    let value: string;
    do { value = `__mb_apple2_beep_${serial++}`; } while (labels.has(normalizeLabel(value)));
    labels.add(normalizeLabel(value));
    return value;
  };
  const firstLocation = program.instructions[0]?.location ?? { filename: "<generated>", line: 1 };
  const number = (value: number, location: SourceLocation): Expression => ({ kind: "number", value, raw: String(value), location });
  const startup: Instruction[] = routine.map((value, index) => ({ kind: "poke", address: routineAddress + index, value: number(value, firstLocation), location: firstLocation }));
  const output: Instruction[] = [];
  for (const instruction of program.instructions) {
    if (instruction.kind !== "beep") { output.push(instruction); continue; }
    const location = instruction.location;
    const n = (value: number): Expression => number(value, location);
    const id = (name: string): Expression => ({ kind: "identifier", name, location });
    const op = (operator: BinaryOperator, left: Expression, right: Expression): Expression => ({ kind: "binary", operator, left, right, location });
    const int = (value: Expression): Expression => ({ kind: "function-call", name: "INT", args: [value], valueType: "number", location });
    const set = (name: string, expression: Expression): Instruction => ({ kind: "let", name, expression, location });
    const poke = (address: number, value: Expression): Instruction => ({ kind: "poke", address, value, location });
    const place = (name: string): Instruction => ({ kind: "label", name, internal: true, location });
    const branch = (condition: Expression, destination: string): Instruction => ({ kind: "if-goto", condition, label: destination, location });
    const done = label(), countReady = label(), loop = label(), chunkReady = label();
    const blockHigh = (name: string): Expression => int(op("/", op("-", id(name), n(1)), n(256)));
    const low = (name: string): Expression => op("-", id(name), op("*", int(op("/", id(name), n(256))), n(256)));
    output.push(
      set(duration, instruction.duration), set(pitch, instruction.pitch),
      branch(op("<=", id(duration), n(0)), done),
      set(frequency, op("*", n(261.625565), op("^", n(2), op("/", id(pitch), n(12))))),
      set(delay, int(op("+", op("/", op("-", op("/", n(511500), id(frequency)), n(29)), n(5)), n(0.5)))),
      set(remaining, int(op("+", op("*", op("*", id(duration), id(frequency)), n(2)), n(0.5)))),
      branch(op(">", id(remaining), n(0)), countReady), set(remaining, n(1)), place(countReady),
      poke(848, low(delay)), poke(849, blockHigh(delay)),
      place(loop), set(chunk, id(remaining)), branch(op("<=", id(chunk), n(32768)), chunkReady), set(chunk, n(32768)), place(chunkReady),
      poke(850, low(chunk)), poke(851, blockHigh(chunk)), { kind: "sys", address: routineAddress, location },
      set(remaining, op("-", id(remaining), id(chunk))), branch(op(">", id(remaining), n(0)), loop), place(done)
    );
  }
  return rebuildLabels(program, [...startup, ...output]);
}
