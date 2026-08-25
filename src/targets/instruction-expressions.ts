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
      return [instruction.condition];
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
