import type { Expression, SourceLocation } from "../ast.js";
import { normalizeLabel, type Instruction, type LoweredProgram } from "../lowering.js";
import { mapInstructionExpressions } from "./instruction-expressions.js";
import { createGeneratedVariableNameAllocator } from "./string-array-lengths.js";
import { rebuildLabels } from "./target.js";

// Read the DS1216 No-Slot Clock under $C300 (IIe) or $F800 (II Plus). The routine occupies
// $0360-$03A0 and its eight-byte snapshot occupies $03B0-$03B7. Interrupts
// are masked only during the 64-bit unlock and 64-bit read, then restored.
// The unlock and input loops use the DS1216's least-significant-bit-first protocol.
// PHP/SEI; select the clock's ROM; reset the serial reader; send the eight-byte
// key via ROM offsets 0/1; rotate 64 bits read from offset 4 into $03B0-$03B7;
// release the C8 ROM with $CFFF; PLP/RTS. The key follows the RTS.
const readerAddress = 864;
const reader = [8, 120, 173, 255, 207, 173, 0, 195, 173, 4, 195, 162, 8,
  189, 152, 3, 56, 106, 72, 169, 0, 42, 168, 185, 0, 195, 104, 74, 208, 244,
  202, 208, 236, 162, 0, 160, 8, 173, 4, 195, 74, 126, 176, 3, 136, 208,
  246, 232, 224, 8, 208, 239, 173, 255, 207, 40, 96, 92, 163, 58, 197,
  92, 163, 58, 197] as const;

/** Snapshot the hardware clock for every JIFFIES expression. */
export function lowerApple2Clock(program: LoweredProgram): LoweredProgram {
  const allocate = createGeneratedVariableNameAllocator(program.instructions, "MBAPPLECLOCK");
  const labels = new Set([...program.labels.keys()].map(normalizeLabel));
  let serial = 0, used = false;
  const label = (): string => {
    let name: string;
    do { name = `__mb_apple_clock_${serial++}`; } while (labels.has(normalizeLabel(name)));
    labels.add(normalizeLabel(name));
    return name;
  };
  const lower = (instruction: Instruction): { instruction: Instruction; prefix: Instruction[] } => {
    const prefix: Instruction[] = [];
    const rewrite = (expression: Expression): Expression => {
      if (expression.kind === "function-call") {
        const args = expression.args.map(rewrite);
        if (expression.name.toUpperCase() !== "JIFFIES") return { ...expression, args };
        used = true;
        const location = expression.location, raw = allocate(), hour = allocate(), day = allocate(), result = allocate();
        const twelve = label(), hoursDone = label(), noonDone = label(), noonAfter = label();
        const n = (value: number): Expression => ({ kind: "number", value, raw: String(value), location });
        const id = (name: string): Expression => ({ kind: "identifier", name, location });
        const op = (operator: "+" | "-" | "*" | "/" | ">=" | "=", left: Expression, right: Expression): Expression => ({ kind: "binary", operator, left, right, location });
        const int = (value: Expression): Expression => ({ kind: "function-call", name: "INT", args: [value], valueType: "number", location });
        const peek = (address: number): Expression => ({ kind: "function-call", name: "__APPLE2_CLOCK_BYTE", args: [n(address)], valueType: "number", location });
        const bcd = (value: Expression): Expression => op("-", value, op("*", n(6), int(op("/", value, n(16)))));
        const set = (name: string, value: Expression): Instruction => ({ kind: "let", name, expression: value, location });
        const branch = (condition: Expression, destination: string): Instruction => ({ kind: "if-goto", condition, label: destination, location });
        const place = (name: string): Instruction => ({ kind: "label", name, internal: true, location });
        prefix.push(
          { kind: "sys", address: readerAddress, location }, set(raw, peek(947)),
          branch(op(">=", id(raw), n(128)), twelve), set(hour, bcd(id(raw))),
          { kind: "goto", label: hoursDone, location }, place(twelve),
          set(hour, op("-", id(raw), op("*", n(32), int(op("/", id(raw), n(32)))))),
          set(hour, bcd(id(hour))), branch(op("=", id(hour), n(12)), noonDone),
          { kind: "goto", label: noonAfter, location }, place(noonDone), set(hour, n(0)),
          place(noonAfter),
          set(hour, op("+", id(hour), op("*", n(12), op("-", int(op("/", id(raw), n(32))), n(4))))),
          place(hoursDone),
          set(day, op("-", peek(948), op("*", n(8), int(op("/", peek(948), n(8)))))),
          set(day, op("-", id(day), op("*", n(7), int(op("/", id(day), n(7)))))),
          set(result, op("+", op("*", id(day), n(5184000)), op("+", op("+", op("+", op("*", id(hour), n(216000)), op("*", bcd(peek(946)), n(3600))), op("*", bcd(peek(945)), n(60))), int(op("*", bcd(peek(944)), n(0.6))))))
        );
        return id(result);
      }
      if (expression.kind === "array-access" || expression.kind === "struct-field-access") return { ...expression, indices: expression.indices.map(rewrite) };
      if (expression.kind === "parenthesized") return { ...expression, expression: rewrite(expression.expression) };
      if (expression.kind === "unary") return { ...expression, operand: rewrite(expression.operand) };
      if (expression.kind === "binary") return { ...expression, left: rewrite(expression.left), right: rewrite(expression.right) };
      return expression;
    };
    if (instruction.kind === "if-then") {
      const condition = rewrite(instruction.condition);
      const body = instruction.body.flatMap((item) => { const result = lower(item); return [...result.prefix, result.instruction]; });
      return { instruction: { ...instruction, condition, body }, prefix };
    }
    return { instruction: mapInstructionExpressions(instruction, rewrite), prefix };
  };
  const rewritten = program.instructions.flatMap((instruction) => { const result = lower(instruction); return [...result.prefix, result.instruction]; });
  if (!used) return program;
  const location: SourceLocation = program.instructions[0].location;
  const startup: Instruction[] = reader.map((value, index) => ({ kind: "poke", address: readerAddress + index, value: { kind: "number", value, raw: String(value), location }, location }));
  // Apple's ROM identification byte is $EA on the II Plus and $06 on the IIe.
  // The Plus uses a No-Slot Clock fitted under its F8 monitor ROM, rather than
  // the IIe's CD ROM. Patch the four high address bytes in the installed reader.
  const ready = label();
  const number = (value: number): Expression => ({ kind: "number", value, raw: String(value), location });
  startup.push({ kind: "if-goto", condition: { kind: "binary", operator: "<>", left: { kind: "function-call", name: "__APPLE2_CLOCK_BYTE", args: [number(64435)], valueType: "number", location }, right: number(234), location }, label: ready, location });
  for (const offset of [7, 10, 25, 39]) startup.push({ kind: "poke", address: readerAddress + offset, value: number(248), location });
  startup.push({ kind: "label", name: ready, internal: true, location });
  return rebuildLabels(program, [...startup, ...rewritten]);
}
