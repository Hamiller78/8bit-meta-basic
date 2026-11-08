import type { Expression } from "./ast.js";
import { builtinFunctions } from "./functions.js";
import { type Instruction, type LoweredProgram, normalizeLabel } from "./lowering.js";
import { instructionExpressions } from "./targets/instruction-expressions.js";
import { rebuildLabels } from "./targets/target.js";
import { isStringVariableName } from "./variables.js";

interface Effects {
  readonly writes: Set<string>;
  readonly calls: Set<string>;
  unknown: boolean;
}

/** Remove repeated scalar copies when intervening instructions cannot change either value. */
export function removeRedundantCopies(program: LoweredProgram): LoweredProgram {
  const instructions = program.instructions;
  const labels = new Map<string, number>();
  instructions.forEach((instruction, index) => { if (instruction.kind === "label") labels.set(normalizeLabel(instruction.name), index); });
  const loops = matchingLoops(instructions);
  const effects = subroutineEffects(instructions, labels, loops);
  const copies = new Map<string, string>();
  const output: Instruction[] = [];
  const invalidate = (name: string): void => {
    const key = name.toUpperCase();
    for (const [destination, source] of copies) if (destination === key || source === key) copies.delete(destination);
  };

  for (const instruction of instructions) {
    if (instruction.kind === "let") {
      const destination = instruction.name.toUpperCase();
      const source = instruction.expression.kind === "identifier" ? instruction.expression.name.toUpperCase() : undefined;
      if (source && source !== destination && !instruction.storageType && !isStringVariableName(destination) && !isStringVariableName(source) && copies.get(destination) === source) continue;
      invalidate(destination);
      if (source && source !== destination && !instruction.storageType && !isStringVariableName(destination) && !isStringVariableName(source)) copies.set(destination, source);
      if (!instructionExpressions(instruction).every(isPureExpression)) copies.clear();
    } else if (instruction.kind === "gosub" || instruction.kind === "if-gosub" || instruction.kind === "on-gosub") {
      const names = instruction.kind === "on-gosub" ? instruction.labels : [instruction.label];
      if (!instructionExpressions(instruction).every(isPureExpression) || names.some((name) => !effects.has(normalizeLabel(name)) || effects.get(normalizeLabel(name))!.unknown)) copies.clear();
      else for (const name of names) for (const written of effects.get(normalizeLabel(name))!.writes) invalidate(written);
      // A failed ON dispatch may branch to a separate label.
      if (instruction.kind === "on-gosub") copies.clear();
    } else if (instruction.kind === "if-goto") {
      if (!isPureExpression(instruction.condition)) copies.clear();
    } else if (instruction.kind !== "rem") {
      // Labels, branches and all unmodelled side effects start a fresh region.
      copies.clear();
    }
    output.push(instruction);
  }
  return output.length === instructions.length ? program : rebuildLabels(program, output);
}

function subroutineEffects(instructions: readonly Instruction[], labels: ReadonlyMap<string, number>, loops: ReadonlyMap<number, number>): ReadonlyMap<string, Effects> {
  const entries = new Set<string>();
  for (const instruction of instructions) {
    if (instruction.kind === "gosub" || instruction.kind === "if-gosub") entries.add(normalizeLabel(instruction.label));
    if (instruction.kind === "on-gosub") instruction.labels.forEach((label) => entries.add(normalizeLabel(label)));
  }
  const summaries = new Map<string, Effects>();
  for (const entry of entries) {
    const summary: Effects = { writes: new Set(), calls: new Set(), unknown: false };
    summaries.set(entry, summary);
    const start = labels.get(entry);
    if (start === undefined) { summary.unknown = true; continue; }
    const seen = new Set<number>();
    const pending = [start];
    const branch = (label: string): void => {
      const destination = labels.get(normalizeLabel(label));
      if (destination === undefined) summary.unknown = true;
      else pending.push(destination);
    };
    while (pending.length) {
      const index = pending.pop()!;
      if (seen.has(index) || index >= instructions.length) continue;
      seen.add(index);
      const instruction = instructions[index];
      if (!instructionExpressions(instruction).every(isPureExpression)) summary.unknown = true;
      switch (instruction.kind) {
        case "let": summary.writes.add(instruction.name.toUpperCase()); break;
        case "for": case "next": summary.writes.add(instruction.variable.toUpperCase()); break;
        case "label": case "rem": case "array-let": case "goto": case "if-goto": case "on-goto": case "return": case "end": break;
        case "gosub": case "if-gosub": summary.calls.add(normalizeLabel(instruction.label)); break;
        case "on-gosub": instruction.labels.forEach((label) => summary.calls.add(normalizeLabel(label))); branch(instruction.fallbackLabel); break;
        default: summary.unknown = true; break;
      }
      switch (instruction.kind) {
        case "return": case "end": break;
        case "goto": branch(instruction.label); break;
        case "if-goto": branch(instruction.label); pending.push(index + 1); break;
        case "on-goto": instruction.labels.forEach(branch); branch(instruction.fallbackLabel); break;
        case "for": {
          const end = loops.get(index);
          if (end === undefined) summary.unknown = true; else pending.push(end + 1);
          pending.push(index + 1);
          break;
        }
        case "next": {
          const startLoop = loops.get(index);
          if (startLoop === undefined) summary.unknown = true; else pending.push(startLoop + 1);
          pending.push(index + 1);
          break;
        }
        default: pending.push(index + 1); break;
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const summary of summaries.values()) for (const called of summary.calls) {
      const child = summaries.get(called);
      if ((!child || child.unknown) && !summary.unknown) { summary.unknown = true; changed = true; }
      for (const name of child?.writes ?? []) if (!summary.writes.has(name)) { summary.writes.add(name); changed = true; }
    }
  }
  return summaries;
}

function matchingLoops(instructions: readonly Instruction[]): ReadonlyMap<number, number> {
  const stack: number[] = [];
  const result = new Map<number, number>();
  instructions.forEach((instruction, index) => {
    if (instruction.kind === "for") stack.push(index);
    if (instruction.kind === "next") {
      const start = stack.pop();
      if (start !== undefined && instructions[start].kind === "for" && instructions[start].variable.toUpperCase() === instruction.variable.toUpperCase()) {
        result.set(start, index); result.set(index, start);
      }
    }
  });
  return result;
}

const pureFunctions = new Set<string>([builtinFunctions.abs, builtinFunctions.asc, builtinFunctions.atn, builtinFunctions.chr, builtinFunctions.code, builtinFunctions.cos, builtinFunctions.exp, builtinFunctions.int, builtinFunctions.left, builtinFunctions.len, builtinFunctions.mid, builtinFunctions.right, builtinFunctions.sgn, builtinFunctions.sin, builtinFunctions.space, builtinFunctions.sqr, builtinFunctions.str, builtinFunctions.val, builtinFunctions.string]);

function isPureExpression(expression: Expression): boolean {
  switch (expression.kind) {
    case "number": case "string": case "boolean": case "color": case "identifier": return true;
    case "array-access": case "struct-field-access": return expression.indices.every(isPureExpression);
    case "function-call": return pureFunctions.has(expression.name.toUpperCase()) && expression.args.every(isPureExpression);
    case "parenthesized": return isPureExpression(expression.expression);
    case "unary": return isPureExpression(expression.operand);
    case "binary": return isPureExpression(expression.left) && isPureExpression(expression.right);
  }
}
