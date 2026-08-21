import type { Expression } from "../ast.js";
import type { Instruction } from "../lowering.js";

export function instructionExpressions(instruction: Instruction): readonly Expression[] {
  switch (instruction.kind) {
    case "print":
      return [...instruction.items, ...(instruction.at ? [instruction.at.row, instruction.at.column] : [])];
    case "let":
      return [instruction.expression];
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
    case "cls":
    case "border-color":
    case "text-color":
    case "screen-background-color":
    case "cell-text-color":
    case "cell-background-color":
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
