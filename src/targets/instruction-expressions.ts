import type { Expression } from "../ast.js";
import type { Instruction } from "../lowering.js";

export function instructionExpressions(instruction: Instruction): readonly Expression[] {
  switch (instruction.kind) {
    case "print":
      return [...instruction.items, ...(instruction.at ? [instruction.at.row, instruction.at.column] : [])];
    case "print-device":
      return instruction.items;
    case "data":
      return instruction.values;
    case "let":
      return [instruction.expression];
    case "multi-let":
      return instruction.assignments.map((assignment) => assignment.expression);
    case "array-let":
      return [...instruction.indices, instruction.expression];
    case "for":
      return [instruction.start, instruction.limit, ...(instruction.step ? [instruction.step] : [])];
    case "if-goto":
    case "if-gosub":
      return [instruction.condition];
    case "if-then":
      return [instruction.condition, ...instruction.body.flatMap(instructionExpressions)];
    case "on-goto":
    case "on-gosub":
      return [instruction.expression];
    case "position":
      return [instruction.row, instruction.column];
    case "poke":
      return [instruction.value];
    case "randomize":
      return instruction.seed ? [instruction.seed] : [];
    case "read-key":
    case "check-device":
    case "trap":
    case "wait-rs232-transmit":
    case "open-device":
    case "close-device":
    case "read":
    case "restore":
    case "end":
    case "cls":
    case "border-color":
    case "text-color":
    case "screen-background-color":
    case "cell-text-color":
    case "cell-background-color":
    case "suppress-scroll-prompt":
    case "program-mode":
    case "paper":
    case "setcolor":
    case "print-chr":
    case "dim-string":
    case "dim-array":
    case "label":
    case "rem":
    case "goto":
    case "gosub":
    case "return":
    case "next":
    case "sys":
      return [];
  }
}

export function mapInstructionExpressions(instruction: Instruction, map: (expression: Expression) => Expression): Instruction {
  switch (instruction.kind) {
    case "print":
      return {
        ...instruction,
        items: instruction.items.map(map),
        ...(instruction.at ? { at: { row: map(instruction.at.row), column: map(instruction.at.column) } } : {})
      };
    case "print-device":
      return { ...instruction, items: instruction.items.map(map) };
    case "data":
      return { ...instruction, values: instruction.values.map(map) };
    case "let":
      return { ...instruction, expression: map(instruction.expression) };
    case "multi-let":
      return { ...instruction, assignments: instruction.assignments.map((assignment) => ({ ...assignment, expression: map(assignment.expression) })) };
    case "array-let":
      return { ...instruction, indices: instruction.indices.map(map), expression: map(instruction.expression) };
    case "for":
      return { ...instruction, start: map(instruction.start), limit: map(instruction.limit), ...(instruction.step ? { step: map(instruction.step) } : {}) };
    case "if-goto":
    case "if-gosub":
      return { ...instruction, condition: map(instruction.condition) };
    case "if-then":
      return { ...instruction, condition: map(instruction.condition), body: instruction.body.map((bodyInstruction) => mapInstructionExpressions(bodyInstruction, map)) };
    case "on-goto":
    case "on-gosub":
      return { ...instruction, expression: map(instruction.expression) };
    case "position":
      return { ...instruction, row: map(instruction.row), column: map(instruction.column) };
    case "poke":
      return { ...instruction, value: map(instruction.value) };
    case "randomize":
      return instruction.seed ? { ...instruction, seed: map(instruction.seed) } : instruction;
    default:
      return instruction;
  }
}
