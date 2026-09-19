import type { Expression } from "./ast.js";
import { type Instruction, type LoweredProgram, normalizeLabel } from "./lowering.js";
import { instructionExpressions, mapInstructionExpressions } from "./targets/instruction-expressions.js";
import { rebuildLabels } from "./targets/target.js";

/**
 * Lowering gives each expression result a unique MBT name. BASIC has a finite
 * variable table, so assign the same storage to results whose values cannot
 * be live at the same time. GOSUB bodies are accounted for separately: a
 * caller value that survives a call must not share storage with the callee.
 */
export function reuseTemporaryStorage(program: LoweredProgram, reservedNames: ReadonlySet<string>): LoweredProgram {
  const instructions = program.instructions;
  const names = new Set<string>();
  const uses: Set<string>[] = [];
  const definitions: Set<string>[] = [];

  for (const instruction of instructions) {
    const used = usedTemporaries(instruction);
    const defined = definedTemporaries(instruction);
    for (const name of [...used]) if (reservedNames.has(name.toLowerCase())) used.delete(name);
    for (const name of [...defined]) if (reservedNames.has(name.toLowerCase())) defined.delete(name);
    uses.push(used);
    definitions.push(defined);
    for (const name of used) names.add(name);
    for (const name of defined) names.add(name);
  }

  if (names.size < 2) return program;

  const labels = new Map<string, number>();
  instructions.forEach((instruction, index) => {
    if (instruction.kind === "label") labels.set(normalizeLabel(instruction.name), index);
  });
  const successors = instructionSuccessors(instructions, labels);
  const liveIn = instructions.map(() => new Set<string>());
  const liveOut = instructions.map(() => new Set<string>());

  let changed = true;
  while (changed) {
    changed = false;
    for (let index = instructions.length - 1; index >= 0; index -= 1) {
      const out = new Set<string>();
      for (const successor of successors[index]) {
        for (const name of liveIn[successor]) out.add(name);
      }
      const inside = new Set(uses[index]);
      for (const name of out) {
        if (!definitions[index].has(name)) inside.add(name);
      }
      if (!sameSet(out, liveOut[index]) || !sameSet(inside, liveIn[index])) {
        liveOut[index] = out;
        liveIn[index] = inside;
        changed = true;
      }
    }
  }

  const conflicts = new Map([...names].map((name) => [name, new Set<string>()]));
  const addConflict = (left: string, right: string): void => {
    if (left === right || temporarySuffix(left) !== temporarySuffix(right)) return;
    conflicts.get(left)?.add(right);
    conflicts.get(right)?.add(left);
  };
  const conflictWithin = (members: ReadonlySet<string>): void => {
    const list = [...members];
    for (let left = 0; left < list.length; left += 1) {
      for (let right = left + 1; right < list.length; right += 1) addConflict(list[left], list[right]);
    }
  };

  for (let index = 0; index < instructions.length; index += 1) {
    conflictWithin(liveIn[index]);
    conflictWithin(liveOut[index]);
    for (const defined of definitions[index]) {
      for (const live of liveOut[index]) addConflict(defined, live);
    }
  }

  const subroutineTemps = collectSubroutineTemporaries(instructions, labels, successors, uses, definitions);
  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index];
    if (instruction.kind !== "gosub") continue;
    for (const callerValue of liveOut[index]) {
      for (const calleeValue of subroutineTemps.get(normalizeLabel(instruction.label)) ?? []) {
        addConflict(callerValue, calleeValue);
      }
    }
  }

  const replacements = colorTemporaries(names, conflicts);
  if ([...replacements].every(([from, to]) => from === to)) return program;
  const renamed = instructions.map((instruction) => renameInstruction(instruction, replacements));
  return rebuildLabels(program, renamed.filter((instruction) => !isRedundantTemporaryCopy(instruction, reservedNames)));
}

function isRedundantTemporaryCopy(instruction: Instruction, reservedNames: ReadonlySet<string>): boolean {
  return instruction.kind === "let" && /^MBT\d+[$%]?$/i.test(instruction.name) &&
    !reservedNames.has(instruction.name.toLowerCase()) &&
    instruction.expression.kind === "identifier" && instruction.expression.name.toUpperCase() === instruction.name.toUpperCase();
}

function usedTemporaries(instruction: Instruction): Set<string> {
  const result = new Set<string>();
  for (const expression of instructionExpressions(instruction)) collectExpressionTemporaries(expression, result);
  if (instruction.kind === "next") addTemporary(instruction.variable, result);
  return result;
}

function definedTemporaries(instruction: Instruction): Set<string> {
  const result = new Set<string>();
  switch (instruction.kind) {
    case "let":
    case "check-device":
    case "read-key":
      addTemporary(instruction.name, result);
      break;
    case "multi-let":
      for (const assignment of instruction.assignments) addTemporary(assignment.name, result);
      break;
    case "read":
      for (const target of instruction.targets) addTemporary(target, result);
      break;
    case "for":
    case "next":
      addTemporary(instruction.variable, result);
      break;
    default:
      break;
  }
  return result;
}

function collectExpressionTemporaries(expression: Expression, result: Set<string>): void {
  switch (expression.kind) {
    case "identifier":
      addTemporary(expression.name, result);
      break;
    case "array-access":
      addTemporary(expression.name, result);
      for (const index of expression.indices) collectExpressionTemporaries(index, result);
      if (expression.fixedWidthStorageLength) collectExpressionTemporaries(expression.fixedWidthStorageLength, result);
      if (expression.fixedWidthStorageStart) collectExpressionTemporaries(expression.fixedWidthStorageStart, result);
      break;
    case "struct-field-access":
      addTemporary(expression.base, result);
      for (const index of expression.indices) collectExpressionTemporaries(index, result);
      break;
    case "function-call":
      for (const arg of expression.args) collectExpressionTemporaries(arg, result);
      break;
    case "parenthesized":
      collectExpressionTemporaries(expression.expression, result);
      break;
    case "unary":
      collectExpressionTemporaries(expression.operand, result);
      break;
    case "binary":
      collectExpressionTemporaries(expression.left, result);
      collectExpressionTemporaries(expression.right, result);
      break;
    default:
      break;
  }
}

function addTemporary(name: string, result: Set<string>): void {
  if (/^MBT\d+[$%]?$/i.test(name)) result.add(name.toUpperCase());
}

function instructionSuccessors(instructions: readonly Instruction[], labels: ReadonlyMap<string, number>): number[][] {
  const forStack: number[] = [];
  const matchingLoop = new Map<number, number>();
  instructions.forEach((instruction, index) => {
    if (instruction.kind === "for") forStack.push(index);
    if (instruction.kind === "next") {
      const start = forStack.pop();
      if (start !== undefined) {
        matchingLoop.set(start, index);
        matchingLoop.set(index, start);
      }
    }
  });

  return instructions.map((instruction, index) => {
    const next = index + 1 < instructions.length ? [index + 1] : [];
    const target = instruction.kind === "goto" || instruction.kind === "if-goto" || instruction.kind === "trap"
      ? labels.get(normalizeLabel(instruction.label ?? ""))
      : undefined;
    switch (instruction.kind) {
      case "goto":
        return target === undefined ? [] : [target];
      case "if-goto":
      case "trap":
        return target === undefined ? next : [...next, target];
      case "return":
      case "end":
        return [];
      case "for": {
        const matchingNext = matchingLoop.get(index);
        const afterLoop = matchingNext === undefined ? undefined : matchingNext + 1;
        return afterLoop === undefined || afterLoop >= instructions.length ? next : [...next, afterLoop];
      }
      case "next": {
        const matchingFor = matchingLoop.get(index);
        return matchingFor === undefined ? next : [...next, matchingFor + 1];
      }
      default:
        return next;
    }
  });
}

function collectSubroutineTemporaries(
  instructions: readonly Instruction[],
  labels: ReadonlyMap<string, number>,
  successors: readonly (readonly number[])[],
  uses: readonly ReadonlySet<string>[],
  definitions: readonly ReadonlySet<string>[]
): ReadonlyMap<string, ReadonlySet<string>> {
  const calls = new Set(instructions.filter((instruction): instruction is Extract<Instruction, { kind: "gosub" }> => instruction.kind === "gosub")
    .map((instruction) => normalizeLabel(instruction.label)));
  const direct = new Map<string, Set<string>>();
  const nested = new Map<string, Set<string>>();

  for (const label of calls) {
    const entry = labels.get(label);
    const members = new Set<string>();
    const childCalls = new Set<string>();
    const seen = new Set<number>();
    const pending = entry === undefined ? [] : [entry];
    while (pending.length > 0) {
      const index = pending.pop()!;
      if (seen.has(index)) continue;
      seen.add(index);
      for (const name of uses[index]) members.add(name);
      for (const name of definitions[index]) members.add(name);
      const instruction = instructions[index];
      if (instruction.kind === "gosub") childCalls.add(normalizeLabel(instruction.label));
      pending.push(...successors[index]);
    }
    direct.set(label, members);
    nested.set(label, childCalls);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const label of calls) {
      const members = direct.get(label)!;
      for (const child of nested.get(label) ?? []) {
        for (const name of direct.get(child) ?? []) {
          if (!members.has(name)) {
            members.add(name);
            changed = true;
          }
        }
      }
    }
  }
  return direct;
}

function colorTemporaries(names: ReadonlySet<string>, conflicts: ReadonlyMap<string, ReadonlySet<string>>): ReadonlyMap<string, string> {
  const replacements = new Map<string, string>();
  for (const suffix of ["", "%", "$"]) {
    const members = [...names].filter((name) => temporarySuffix(name) === suffix).sort(compareTemporaryNames);
    const palette = [...members];
    const colors = new Map<string, number>();
    const uncolored = new Set(members);
    while (uncolored.size > 0) {
      const node = [...uncolored].sort((left, right) => {
        const leftNeighbors = conflicts.get(left) ?? new Set<string>();
        const rightNeighbors = conflicts.get(right) ?? new Set<string>();
        const leftColors = new Set([...leftNeighbors].map((neighbor) => colors.get(neighbor)).filter((color) => color !== undefined));
        const rightColors = new Set([...rightNeighbors].map((neighbor) => colors.get(neighbor)).filter((color) => color !== undefined));
        return rightColors.size - leftColors.size || rightNeighbors.size - leftNeighbors.size || compareTemporaryNames(left, right);
      })[0];
      const blocked = new Set([...(conflicts.get(node) ?? [])].map((neighbor) => colors.get(neighbor)));
      let color = 0;
      while (blocked.has(color)) color += 1;
      colors.set(node, color);
      uncolored.delete(node);
    }
    for (const name of members) replacements.set(name, palette[colors.get(name)!]);
  }
  return replacements;
}

function renameInstruction(instruction: Instruction, replacements: ReadonlyMap<string, string>): Instruction {
  const rename = (name: string): string => replacements.get(name.toUpperCase()) ?? name;
  const mapped = mapInstructionExpressions(instruction, (expression) => renameExpression(expression, replacements));
  switch (mapped.kind) {
    case "let":
    case "check-device":
    case "read-key":
    case "dim-string":
    case "dim-array":
    case "array-let":
      return { ...mapped, name: rename(mapped.name) };
    case "multi-let":
      return { ...mapped, assignments: mapped.assignments.map((assignment) => ({ ...assignment, name: rename(assignment.name) })) };
    case "read":
      return { ...mapped, targets: mapped.targets.map(rename) };
    case "for":
    case "next":
      return { ...mapped, variable: rename(mapped.variable) };
    default:
      return mapped;
  }
}

function renameExpression(expression: Expression, replacements: ReadonlyMap<string, string>): Expression {
  const rename = (name: string): string => replacements.get(name.toUpperCase()) ?? name;
  switch (expression.kind) {
    case "identifier":
      return { ...expression, name: rename(expression.name) };
    case "array-access":
      return {
        ...expression,
        name: rename(expression.name),
        indices: expression.indices.map((index) => renameExpression(index, replacements)),
        ...(expression.fixedWidthStorageLength ? { fixedWidthStorageLength: renameExpression(expression.fixedWidthStorageLength, replacements) } : {}),
        ...(expression.fixedWidthStorageStart ? { fixedWidthStorageStart: renameExpression(expression.fixedWidthStorageStart, replacements) } : {})
      };
    case "struct-field-access":
      return { ...expression, base: rename(expression.base), indices: expression.indices.map((index) => renameExpression(index, replacements)) };
    case "function-call":
      return { ...expression, args: expression.args.map((arg) => renameExpression(arg, replacements)) };
    case "parenthesized":
      return { ...expression, expression: renameExpression(expression.expression, replacements) };
    case "unary":
      return { ...expression, operand: renameExpression(expression.operand, replacements) };
    case "binary":
      return { ...expression, left: renameExpression(expression.left, replacements), right: renameExpression(expression.right, replacements) };
    default:
      return expression;
  }
}

function temporarySuffix(name: string): string {
  return name.endsWith("$") || name.endsWith("%") ? name.slice(-1) : "";
}

function compareTemporaryNames(left: string, right: string): number {
  return Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]);
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((name) => right.has(name));
}
