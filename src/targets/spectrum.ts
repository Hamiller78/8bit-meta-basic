import type { NumberedLine, NumberedProgram } from "../line-numbering.js";
import { resolveLabel } from "../line-numbering.js";

export function renderSpectrum(program: NumberedProgram): string {
  return `${program.lines.map((line) => renderLine(line, program)).join("\n")}\n`;
}

function renderLine(line: NumberedLine, program: NumberedProgram): string {
  const instruction = line.instruction;

  switch (instruction.kind) {
    case "label":
      return `${line.number} REM ${instruction.name}:`;
    case "print":
      return `${line.number} PRINT ${instruction.literal}`;
    case "goto":
      return `${line.number} GO TO ${resolveLabel(program.labelLines, instruction.label)}`;
    case "if-goto":
      return `${line.number} IF ${instruction.condition} THEN GO TO ${resolveLabel(program.labelLines, instruction.label)}`;
  }
}
