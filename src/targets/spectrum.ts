import type { Expression } from "../ast.js";
import { resolveLabel } from "../line-numbering.js";
import type { ReadabilityLevel } from "../line-numbering.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { expandPositionedPrints, rebuildLabels, renderExpression, renderPrintItems, spectrumColorCodes, type TargetBackend } from "./target.js";

export const spectrumTarget: TargetBackend = {
  id: "spectrum",
  gotoSpelling: "GO TO",
  lower(program: LoweredProgram, _readability: ReadabilityLevel): LoweredProgram {
    const expanded = expandPositionedPrints(program, "Spectrum", 21, 31, (instruction) => [instruction]);
    const instructions: Instruction[] = [];
    for (const instruction of expanded.instructions) {
      if (instruction.kind === "cls" && instruction.color) {
        instructions.push({ kind: "paper", color: instruction.color, location: instruction.location });
        instructions.push({ ...instruction, color: undefined });
      } else {
        instructions.push(instruction);
      }
    }
    return rebuildLabels(expanded, instructions);
  },
  renderLine(lineNumber: number, instruction: Instruction, labelLines: ReadonlyMap<string, number>, _readability: ReadabilityLevel): string {
    const variableMap = buildUppercaseVariableMap(currentProgramInstructions);

    switch (instruction.kind) {
      case "label":
        return `${lineNumber} REM ${instruction.name.toUpperCase()}:`;
      case "rem":
        return `${lineNumber} REM ${instruction.text.toUpperCase()}`;
      case "cls":
        return `${lineNumber} CLS`;
      case "border-color":
        return `${lineNumber} BORDER ${spectrumColorCodes[instruction.color.color]}`;
      case "paper":
        return `${lineNumber} PAPER ${spectrumColorCodes[instruction.color.color]}`;
      case "print":
        return instruction.at
          ? `${lineNumber} PRINT AT ${renderExpression(instruction.at.row, { variableMap })},${renderExpression(instruction.at.column, { variableMap })};${renderPrintItems(instruction.items, instruction.trailingSemicolon, { variableMap })}`
          : `${lineNumber} PRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon, { variableMap })}`;
      case "let":
        return `${lineNumber} LET ${instruction.name.toUpperCase()}=${renderExpression(instruction.expression, { variableMap })}`;
      case "goto":
        return `${lineNumber} GO TO ${resolveLabel(labelLines, instruction.label)}`;
      case "if-goto":
        return `${lineNumber} IF ${renderExpression(instruction.condition, { variableMap })} THEN GO TO ${resolveLabel(labelLines, instruction.label)}`;
      case "position":
      case "setcolor":
      case "poke":
      case "print-chr":
      case "sys":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for Spectrum.`);
    }
  }
};

let currentProgramInstructions: readonly Instruction[] = [];

export function setSpectrumRenderProgram(instructions: readonly Instruction[]): void {
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
    case "cls":
    case "border-color":
    case "paper":
    case "setcolor":
    case "print-chr":
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
    case "color":
      break;
  }
}
