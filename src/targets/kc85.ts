import { DiagnosticError } from "../diagnostics.js";
import { joystickControl } from "../joystick.js";
import type { Expression } from "../ast.js";
import { normalizeLabel, type Instruction, type LoweredProgram } from "../lowering.js";
import { mapInstructionExpressions } from "./instruction-expressions.js";
import { renderKc85Line } from "./kc85-render.js";
import { kc85VariableMap } from "./kc85-variables.js";
import { lowerByteStorage } from "./byte-storage.js";
import { lowerSequentialFileIo } from "./file-io.js";
import { lowerInkeyReads } from "./inkey-lowering.js";
import { lowerKc85Printer } from "./kc85-printer.js";
import { lowerSafeDispatch } from "./safe-dispatch.js";
import { createGeneratedVariableNameAllocator } from "./string-array-lengths.js";
import { groupInvertedPrints, rebuildLabels, validateConstantCoordinate, type TargetBackend } from "./target.js";

let currentInstructions: readonly Instruction[] = [];

export function setKc85RenderProgram(instructions: readonly Instruction[]): void {
  currentInstructions = instructions;
}

/** Initial HC-BASIC backend; unsupported operations are diagnosed by its renderer. */
export const kc85Target: TargetBackend = {
  id: "kc85",
  gotoSpelling: "GOTO",
  maxLineLength: 72,
  maxLineNumber: 65529,
  variableMap: kc85VariableMap,
  lower(program: LoweredProgram): LoweredProgram {
    const validateExpression = (expression: Expression): Expression => {
      switch (expression.kind) {
        case "string":
          if (/[^\x20-\x7eäöüß]/u.test(expression.value)) {
            throw new DiagnosticError(expression.location, "KC 85/3 text contains an unsupported character.");
          }
          break;
        case "function-call": expression.args.forEach(validateExpression); break;
        case "array-access": case "struct-field-access": expression.indices.forEach(validateExpression); break;
        case "parenthesized": validateExpression(expression.expression); break;
        case "unary": validateExpression(expression.operand); break;
        case "binary": validateExpression(expression.left); validateExpression(expression.right); break;
        default: break;
      }
      return expression;
    };
    const validate = (instruction: Instruction): void => {
      if (instruction.kind === "if-then") instruction.body.forEach(validate);
      mapInstructionExpressions(instruction, validateExpression);
    };
    program.instructions.forEach(validate);
    const byteProgram = lowerByteStorage(lowerKc85Printer(lowerKc85TapeSavePrompt(lowerSequentialFileIo(program, "tape"))), "kc85");
    const allocate = createGeneratedVariableNameAllocator(byteProgram.instructions, "MBKC85SEED");
    let seedStorage: string | undefined;
    const seedRandom = (instruction: Instruction): Instruction => {
      if (instruction.kind === "if-then") return { ...instruction, body: instruction.body.map(seedRandom) };
      if (instruction.kind !== "randomize" || !instruction.seed) return instruction;
      seedStorage ??= allocate();
      return {
        kind: "let", name: seedStorage, location: instruction.location,
        expression: { kind: "function-call", name: "__KC85_SEED_RND", args: [instruction.seed], valueType: "number", location: instruction.location }
      };
    };
    const seeded = rebuildLabels(byteProgram, byteProgram.instructions.map(seedRandom));
    // Keep long literal-only output editable without changing its visible text.
    const splitLongPrint = (instruction: Instruction): Instruction[] => {
      if (instruction.kind !== "print" || instruction.items.length !== 1 || instruction.items[0].kind !== "string" || instruction.items[0].value.length <= 50) return [instruction];
      const literal = instruction.items[0];
      const chunks = literal.value.match(/[\s\S]{1,50}/gu) ?? [];
      return chunks.map((value, index) => ({
        ...instruction,
        ...(index > 0 ? { at: undefined } : {}),
        items: [{ ...literal, value }],
        trailingSemicolon: index < chunks.length - 1 || instruction.trailingSemicolon
      }));
    };
    const split = rebuildLabels(seeded, seeded.instructions.flatMap(splitLongPrint));
    const clock = lowerKc85Clock(split);
    return lowerSafeDispatch(lowerKc85Inverse(groupInvertedPrints(lowerKc85Joystick(lowerKc85ScreenReads(lowerInkeyReads(lowerKc85Beeps(clock.program, clock.vector), "MBKC85KEY"))))), "MBKC85DISPATCH");
  },
  renderLine(lineNumber, instruction, labelLines): string {
    return renderKc85Line(lineNumber, instruction, labelLines, kc85VariableMap(currentInstructions));
  }
};

/** Give the user time to start the cassette recorder before output begins. */
function lowerKc85TapeSavePrompt(program: LoweredProgram): LoweredProgram {
  const allocate = createGeneratedVariableNameAllocator(program.instructions, "MBKC85TAPE", "$");
  const labels = new Set([...program.labels.keys()].map(normalizeLabel));
  let next = 0;
  let key: string | undefined;
  const instructions = program.instructions.flatMap((instruction): Instruction[] => {
    if (instruction.kind !== "open-data-file" || instruction.mode !== "write") return [instruction];
    key ??= allocate();
    let label: string;
    do { label = `__mb_kc85_tape_${next++}`; } while (labels.has(normalizeLabel(label)));
    labels.add(normalizeLabel(label));
    const location = instruction.location;
    return [
      { kind: "print", items: [{ kind: "string", value: "START TAPE, PRESS ENTER", location }], trailingSemicolon: false, location },
      { kind: "label", name: label, internal: true, location },
      { kind: "read-key", name: key, location },
      {
        kind: "if-goto", label, location,
        condition: {
          kind: "binary", operator: "<>", location,
          left: { kind: "identifier", name: key, valueType: "string", location },
          right: {
            kind: "function-call", name: "CHR$", valueType: "string", location,
            args: [{ kind: "number", value: 13, raw: "13", location }]
          }
        }
      },
      instruction
    ];
  });
  return rebuildLabels(program, instructions);
}

/** Install a 16-bit 50 Hz interrupt counter in CAOS's user interrupt area. */
function lowerKc85Clock(program: LoweredProgram): { program: LoweredProgram; vector?: { low: string; high: string } } {
  const allocate = createGeneratedVariableNameAllocator(program.instructions, "MBKC85CLOCK");
  const labels = new Set([...program.labels.keys()].map(normalizeLabel));
  let next = 0, used = false;
  const label = (): string => {
    let value: string;
    do { value = `__mb_kc85_clock_${next++}`; } while (labels.has(normalizeLabel(value)));
    labels.add(normalizeLabel(value));
    return value;
  };
  const lower = (instruction: Instruction): { instruction: Instruction; prefix: Instruction[] } => {
    const prefix: Instruction[] = [];
    const rewrite = (expression: Expression): Expression => {
      if (expression.kind === "function-call") {
        const args = expression.args.map(rewrite);
        if (expression.name.toUpperCase() !== "JIFFIES") return { ...expression, args };
        used = true;
        const location = expression.location, high = allocate(), low = allocate(), retry = label();
        const id = (name: string): Expression => ({ kind: "identifier", name, location });
        const num = (value: number): Expression => ({ kind: "number", value, raw: String(value), location });
        const call = (name: string): Expression => ({ kind: "function-call", name, args: [], valueType: "number", location });
        prefix.push(
          { kind: "label", name: retry, internal: true, location },
          { kind: "let", name: high, expression: call("__KC85_CLOCK_HIGH"), location },
          { kind: "let", name: low, expression: call("__KC85_CLOCK_LOW"), location },
          { kind: "if-goto", condition: { kind: "binary", operator: "<>", left: id(high), right: call("__KC85_CLOCK_HIGH"), location }, label: retry, location }
        );
        return { kind: "binary", operator: "+", left: { kind: "binary", operator: "*", left: id(high), right: num(256), location }, right: id(low), location };
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
  if (!used) return { program };
  const location = program.instructions[0].location;
  const vector = { low: allocate(), high: allocate() };
  const num = (value: number): Expression => ({ kind: "number", value, raw: String(value), location });
  const id = (name: string): Expression => ({ kind: "identifier", name, location });
  const call = (name: string): Expression => ({ kind: "function-call", name, args: [], valueType: "number", location });
  const out = (value: number): Instruction => ({ kind: "port-out", port: 142, value: num(value), location });
  const poke = (address: number, value: number): Instruction => ({ kind: "poke", address, value: num(value), location });
  const restore: Instruction[] = [out(3), { kind: "poke", address: 492, value: id(vector.low), location }, { kind: "poke", address: 493, value: id(vector.high), location }];
  // PUSH HL; LD HL,(01E0); INC HL; LD (01E0),HL; POP HL; EI; RETI.
  const handler = [229, 42, 224, 1, 35, 34, 224, 1, 225, 251, 237, 77];
  const setup: Instruction[] = [out(3),
    { kind: "let", name: vector.low, expression: call("__KC85_IRQ_LOW"), location },
    { kind: "let", name: vector.high, expression: call("__KC85_IRQ_HIGH"), location },
    ...handler.map((byte, index) => poke(468 + index, byte)),
    poke(480, 0), poke(481, 0), poke(492, 212), poke(493, 1), out(165), out(137)];
  const stopAtEnd = (instruction: Instruction): Instruction[] => {
    if (instruction.kind === "end") return [...restore, instruction];
    if (instruction.kind === "if-then") return [{ ...instruction, body: instruction.body.flatMap(stopAtEnd) }];
    return [instruction];
  };
  const stopped = rewritten.flatMap(stopAtEnd);
  return { program: rebuildLabels(program, [...setup, ...stopped, ...restore]), vector };
}

function lowerKc85Inverse(program: LoweredProgram): LoweredProgram {
  if (!program.instructions.some(instruction => instruction.kind === "inverse-text")) return program;
  const storage = createGeneratedVariableNameAllocator(program.instructions, "MBKC85INVERSE")();
  return rebuildLabels(program, program.instructions.flatMap((instruction): Instruction[] => {
    if (instruction.kind !== "inverse-text") return [instruction];
    const location = instruction.location;
    return [
      { kind: "let", name: storage, expression: { kind: "function-call", name: "__KC85_COLOR", args: [], valueType: "number", location }, location },
      { ...instruction, storage }
    ];
  }));
}

/** Read joystick 1 from the M008/M021 PIO, sampling once per call. */
function lowerKc85Joystick(program: LoweredProgram): LoweredProgram {
  const allocate = createGeneratedVariableNameAllocator(program.instructions, "MBKC85JOY");
  let used = false;
  const lower = (instruction: Instruction): { instruction: Instruction; prefix: Instruction[] } => {
    const prefix: Instruction[] = [];
    const rewrite = (expression: Expression): Expression => {
      if (expression.kind === "function-call") {
        const args = expression.args.map(rewrite);
        if (expression.name.toUpperCase() !== "GET_JOYSTICK") return { ...expression, args };
        used = true;
        const control = joystickControl(args[0]), location = expression.location, raw = allocate();
        const num = (value: number): Expression => ({ kind: "number", value, raw: String(value), location });
        const op = (operator: Extract<Expression, { kind: "binary" }>["operator"], left: Expression, right: Expression): Expression => ({ kind: "binary", operator, left, right, location });
        const pressed = (mask: number): Expression => op("=", { kind: "function-call", name: "__KC85_JOY_BIT", args: [{ kind: "identifier", name: raw, location }, num(mask)], valueType: "number", location }, num(0));
        prefix.push({ kind: "let", name: raw, expression: { kind: "function-call", name: "__KC85_JOY_RAW", args: [], valueType: "number", location }, location });
        const result = allocate();
        const id = (): Expression => ({ kind: "identifier", name: result, location });
        prefix.push({ kind: "let", name: result, expression: control === 2 ? op("-", num(0), pressed(32)) : pressed(control === 0 ? 4 : 1), location });
        if (control !== 2) prefix.push({ kind: "let", name: result, expression: op("-", id(), pressed(control === 0 ? 8 : 2)), location });
        return id();
      }
      if (expression.kind === "array-access" || expression.kind === "struct-field-access") return { ...expression, indices: expression.indices.map(rewrite) };
      if (expression.kind === "parenthesized") return { ...expression, expression: rewrite(expression.expression) };
      if (expression.kind === "unary") return { ...expression, operand: rewrite(expression.operand) };
      if (expression.kind === "binary") return { ...expression, left: rewrite(expression.left), right: rewrite(expression.right) };
      return expression;
    };
    if (instruction.kind === "if-then") {
      const condition = rewrite(instruction.condition);
      const body = instruction.body.flatMap(item => { const result = lower(item); return [...result.prefix, result.instruction]; });
      return { instruction: { ...instruction, condition, body }, prefix };
    }
    return { instruction: mapInstructionExpressions(instruction, rewrite), prefix };
  };
  const instructions = program.instructions.flatMap(item => { const result = lower(item); return [...result.prefix, result.instruction]; });
  if (!used) return program;
  const location = program.instructions[0].location;
  return rebuildLabels(program, [{ kind: "port-out", port: 146, value: { kind: "number", value: 79, raw: "79", location }, location }, ...instructions]);
}

function lowerKc85Beeps(program: LoweredProgram, vector?: { low: string; high: string }): LoweredProgram {
  if (!program.instructions.some((instruction) => instruction.kind === "beep")) return program;
  const allocate = createGeneratedVariableNameAllocator(program.instructions, "MBKC85BEEP");
  const duration = allocate(), pitch = allocate(), counter = allocate(), remaining = allocate(), chunk = allocate();
  const high = vector ? allocate() : "", low = vector ? allocate() : "", start = vector ? allocate() : "", elapsed = vector ? allocate() : "";
  const labels = new Set([...program.labels.keys()].map(normalizeLabel));
  let next = 0;
  const label = (): string => {
    let value: string;
    do { value = `__mb_kc85_beep_${next++}`; } while (labels.has(normalizeLabel(value)));
    labels.add(normalizeLabel(value));
    return value;
  };
  const output: Instruction[] = [];
  for (const instruction of program.instructions) {
    if (instruction.kind !== "beep") { output.push(instruction); continue; }
    const location = instruction.location;
    const num = (value: number): Expression => ({ kind: "number", value, raw: String(value), location });
    const id = (name: string): Expression => ({ kind: "identifier", name, location });
    const op = (operator: Extract<Expression, { kind: "binary" }>["operator"], left: Expression, right: Expression): Expression => ({ kind: "binary", operator, left, right, location });
    const int = (value: Expression): Expression => ({ kind: "function-call", name: "INT", args: [value], valueType: "number", location });
    const abs = (value: Expression): Expression => ({ kind: "function-call", name: "ABS", args: [value], valueType: "number", location });
    const call = (name: string): Expression => ({ kind: "function-call", name, args: [], valueType: "number", location });
    const set = (name: string, expression: Expression): Instruction => ({ kind: "let", name, expression, location });
    const place = (name: string): Instruction => ({ kind: "label", name, internal: true, location });
    const done = label(), counterReady = label(), ticksReady = label(), loop = label(), chunkReady = label();
    const play = (soundCounter: Expression, ticks: Expression): Instruction[] => {
      const wait = label();
      if (!vector) return [
        { ...instruction, duration: ticks, pitch: soundCounter }, place(wait),
        { kind: "if-goto", condition: call("__KC85_TONE_ACTIVE"), label: wait, location }
      ];
      const readStart = label(), readNow = label(), elapsedReady = label();
      const snapshot = (retry: string): Instruction[] => [
        place(retry), set(high, call("__KC85_CLOCK_HIGH")), set(low, call("__KC85_CLOCK_LOW")),
        { kind: "if-goto", condition: op("<>", id(high), call("__KC85_CLOCK_HIGH")), label: retry, location }
      ];
      const clockValue = (): Expression => op("+", op("*", id(high), num(256)), id(low));
      return [
        { kind: "port-out", port: 137, value: call("__KC85_MAX_VOLUME"), location },
        { kind: "port-out", port: 140, value: op("+", num(5), op("*", num(32), abs(op("<", soundCounter, num(0))))), location },
        { kind: "port-out", port: 140, value: abs(soundCounter), location },
        ...snapshot(readStart), set(start, clockValue()),
        ...snapshot(readNow), set(elapsed, op("-", clockValue(), id(start))),
        { kind: "if-goto", condition: op(">=", id(elapsed), num(0)), label: elapsedReady, location },
        set(elapsed, op("+", id(elapsed), num(65536))), place(elapsedReady),
        { kind: "if-goto", condition: op("<", id(elapsed), ticks), label: readNow, location },
        { kind: "port-out", port: 140, value: num(3), location }
      ];
    };
    const constantCounter = instruction.pitch.kind === "number"
      ? Math.round(209.031 / Math.pow(2, instruction.pitch.value / 12))
      : undefined;
    const encodedCounter = constantCounter === undefined ? undefined
      : constantCounter > 255 ? -Math.round(constantCounter / 16) : constantCounter;
    const constantTicks = instruction.duration.kind === "number" ? Math.max(1, Math.ceil(instruction.duration.value * 50)) : undefined;
    // SOUND accepts 255 ticks; a clocked tone can run much longer before
    // splitting while leaving ample time to observe a wrapping counter.
    const maxTicks = vector ? 32767 : 255;
    if (encodedCounter !== undefined && constantTicks !== undefined && instruction.duration.kind === "number" && instruction.duration.value > 0 && constantTicks <= maxTicks) {
      output.push(...play(num(encodedCounter), num(constantTicks)));
      continue;
    }
    output.push(
      set(duration, instruction.duration), set(pitch, instruction.pitch),
      { kind: "if-goto", condition: op("<=", id(duration), num(0)), label: done, location },
      ...(encodedCounter !== undefined ? [set(counter, num(encodedCounter))] : [
        set(counter, int(op("+", op("/", num(209.031), op("^", num(2), op("/", id(pitch), num(12)))), num(0.5)))),
        { kind: "if-goto" as const, condition: op("<=", id(counter), num(255)), label: counterReady, location },
        set(counter, op("-", num(0), int(op("+", op("/", id(counter), num(16)), num(0.5))))), place(counterReady)
      ]),
      set(remaining, constantTicks !== undefined ? num(constantTicks) : int(op("+", op("*", id(duration), num(50)), num(0.999999)))),
      { kind: "if-goto", condition: op(">", id(remaining), num(0)), label: ticksReady, location },
      set(remaining, num(1)), place(ticksReady),
      place(loop), set(chunk, id(remaining)),
      { kind: "if-goto", condition: op("<=", id(chunk), num(maxTicks)), label: chunkReady, location },
      set(chunk, num(maxTicks)), place(chunkReady),
      ...play(id(counter), id(chunk)),
      set(remaining, op("-", id(remaining), id(chunk))),
      { kind: "if-goto", condition: op(">", id(remaining), num(0)), label: loop, location },
      place(done)
    );
  }
  return rebuildLabels(program, output);
}

function lowerKc85ScreenReads(program: LoweredProgram): LoweredProgram {
  const allocate = createGeneratedVariableNameAllocator(program.instructions, "MBKC85SCREEN");
  const lower = (instruction: Instruction): { instruction: Instruction; prefix: Instruction[] } => {
    const prefix: Instruction[] = [];
    const rewrite = (expression: Expression): Expression => {
      switch (expression.kind) {
        case "function-call": {
          const args = expression.args.map(rewrite);
          if (expression.name !== "SCREEN_CODE") return { ...expression, args };
          validateConstantCoordinate(args[0], "row", 29, "KC 85", "SCREEN_CODE");
          validateConstantCoordinate(args[1], "column", 39, "KC 85", "SCREEN_CODE");
          const location = expression.location;
          const row = allocate(), column = allocate(), savedRow = allocate(), savedColumn = allocate(), value = allocate();
          const id = (name: string): Expression => ({ kind: "identifier", name, location });
          const call = (name: string): Expression => ({ kind: "function-call", name, args: [], valueType: "number", location });
          prefix.push(
            { kind: "let", name: row, expression: args[0], location },
            { kind: "let", name: column, expression: args[1], location },
            { kind: "let", name: savedRow, expression: call("__KC85_ROW"), location },
            { kind: "let", name: savedColumn, expression: call("__KC85_COLUMN"), location },
            { kind: "set-position", row: id(row), column: id(column), location },
            { kind: "let", name: value, expression: call("__KC85_SCREEN"), location },
            { kind: "set-position", row: id(savedRow), column: id(savedColumn), location }
          );
          return id(value);
        }
        case "array-access": return { ...expression, indices: expression.indices.map(rewrite) };
        case "struct-field-access": return { ...expression, indices: expression.indices.map(rewrite) };
        case "parenthesized": return { ...expression, expression: rewrite(expression.expression) };
        case "unary": return { ...expression, operand: rewrite(expression.operand) };
        case "binary": return { ...expression, left: rewrite(expression.left), right: rewrite(expression.right) };
        default: return expression;
      }
    };
    if (instruction.kind === "if-then") {
      const condition = rewrite(instruction.condition);
      const body = instruction.body.flatMap((item) => {
        const result = lower(item);
        return [...result.prefix, result.instruction];
      });
      return { instruction: { ...instruction, condition, body }, prefix };
    }
    return { instruction: mapInstructionExpressions(instruction, rewrite), prefix };
  };
  return rebuildLabels(program, program.instructions.flatMap((instruction) => {
    const result = lower(instruction);
    return [...result.prefix, result.instruction];
  }));
}
