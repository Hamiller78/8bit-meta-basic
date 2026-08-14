import type { Expression } from "../ast.js";
import { resolveLabel } from "../line-numbering.js";
import type { ReadabilityLevel } from "../line-numbering.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { expandPositionedPrints, renderExpression, renderPrintItems, type TargetBackend } from "./target.js";

export const atari800xlTarget: TargetBackend = {
  id: "atari800xl",
  gotoSpelling: "GOTO",
  lower(program: LoweredProgram, _readability: ReadabilityLevel): LoweredProgram {
    return expandPositionedPrints(program, "Atari 800XL", 23, 39, (instruction) => [
      { kind: "position", row: instruction.at!.row, column: instruction.at!.column, location: instruction.location },
      { ...instruction, at: undefined }
    ]);
  },
  renderLine(lineNumber: number, instruction: Instruction, labelLines: ReadonlyMap<string, number>, _readability: ReadabilityLevel): string {
    const variableMap = buildUppercaseVariableMap(currentProgramInstructions);

    switch (instruction.kind) {
      case "label":
        return `${lineNumber} REM ${instruction.name.toUpperCase()}:`;
      case "rem":
        return `${lineNumber} REM ${instruction.text.toUpperCase()}`;
      case "print":
        return `${lineNumber} PRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon, { variableMap })}`;
      case "let":
        return `${lineNumber} ${instruction.name.toUpperCase()}=${renderExpression(instruction.expression, { variableMap })}`;
      case "goto":
        return `${lineNumber} GOTO ${resolveLabel(labelLines, instruction.label)}`;
      case "if-goto":
        return `${lineNumber} IF ${renderExpression(instruction.condition, { variableMap })} THEN GOTO ${resolveLabel(labelLines, instruction.label)}`;
      case "position":
        return `${lineNumber} POSITION ${renderExpression(instruction.column, { variableMap })},${renderExpression(instruction.row, { variableMap })}`;
      case "poke":
      case "sys":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for Atari 800XL.`);
    }
  }
};

let currentProgramInstructions: readonly Instruction[] = [];

export function setAtariRenderProgram(instructions: readonly Instruction[]): void {
  currentProgramInstructions = instructions;
}

function buildUppercaseVariableMap(instructions: readonly Instruction[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();

  for (const instruction of instructions) {
    if (instruction.kind === "let") {
      map.set(instruction.name.toLowerCase(), instruction.name.toUpperCase());
    }
    for (const expression of instructionExpressions(instruction)) {
      collectIdentifiers(expression, map);
    }
  }

  return map;
}

function instructionExpressions(instruction: Instruction): readonly Expression[] {
  switch (instruction.kind) {
    case "print":
      return [...instruction.items, ...(instruction.at ? [instruction.at.row, instruction.at.column] : [])];
    case "let":
      return [instruction.expression];
    case "if-goto":
      return [instruction.condition];
    case "position":
      return [instruction.row, instruction.column];
    case "poke":
      return [instruction.value];
    case "label":
    case "rem":
    case "goto":
    case "sys":
      return [];
  }
}

function collectIdentifiers(expression: Expression, map: Map<string, string>): void {
  switch (expression.kind) {
    case "identifier":
      map.set(expression.name.toLowerCase(), expression.name.toUpperCase());
      break;
    case "parenthesized":
      collectIdentifiers(expression.expression, map);
      break;
    case "unary":
      collectIdentifiers(expression.operand, map);
      break;
    case "binary":
      collectIdentifiers(expression.left, map);
      collectIdentifiers(expression.right, map);
      break;
    case "number":
    case "string":
    case "boolean":
      break;
  }
}
