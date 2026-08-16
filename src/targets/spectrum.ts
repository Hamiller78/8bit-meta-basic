import type { Expression } from "../ast.js";
import { builtinFunctions } from "../functions.js";
import { resolveLabel } from "../line-numbering.js";
import type { ReadabilityLevel } from "../line-numbering.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { createFunctionRenderer, type FunctionCallExpression } from "./function-rendering.js";
import { expandPositionedPrints, rebuildLabels, renderExpression, renderPrintItems, spectrumColorCodes, type TargetBackend } from "./target.js";

export const spectrumTarget: TargetBackend = {
  id: "spectrum",
  gotoSpelling: "GO TO",
  maxLineLength: 640,
  maxLineNumber: 9999,
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
    const renderOptions = { variableMap, functionRenderer: renderSpectrumFunction };

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
      case "text-color":
        return `${lineNumber} INK ${spectrumColorCodes[instruction.color.color]}`;
      case "print":
        return instruction.at
          ? `${lineNumber} PRINT AT ${renderExpression(instruction.at.row, renderOptions)},${renderExpression(instruction.at.column, renderOptions)};${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`
          : `${lineNumber} PRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`;
      case "let":
        return `${lineNumber} LET ${variableMap.get(instruction.name.toLowerCase()) ?? instruction.name.toUpperCase()}=${renderExpression(instruction.expression, renderOptions)}`;
      case "goto":
        return `${lineNumber} GO TO ${resolveLabel(labelLines, instruction.label)}`;
      case "if-goto":
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN GO TO ${resolveLabel(labelLines, instruction.label)}`;
      case "position":
      case "setcolor":
      case "poke":
      case "print-chr":
      case "dim-string":
      case "sys":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for Spectrum.`);
    }
  }
};

let currentProgramInstructions: readonly Instruction[] = [];

export function setSpectrumRenderProgram(instructions: readonly Instruction[]): void {
  currentProgramInstructions = instructions;
}

const renderSpectrumFunction = createFunctionRenderer(
  new Map([
    [builtinFunctions.jiffies, () => "PEEK 23672 + 256 * PEEK 23673 + 65536 * PEEK 23674"],
    [builtinFunctions.len, renderSpectrumLen],
    [builtinFunctions.mid, renderSpectrumMid]
  ])
);

function renderSpectrumLen(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  const [source] = expression.args;
  return `LEN ${renderSpectrumLenArgument(source, options)}`;
}

function renderSpectrumMid(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  const [source, start, length] = expression.args;
  return `${renderExpression(source, options)}(${renderExpression(start, options)} TO ${renderExpression(start, options)} + ${renderExpression(length, options)} - 1)`;
}

function renderSpectrumLenArgument(expression: Expression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  if (expression.kind === "identifier" || expression.kind === "string" || expression.kind === "function-call") {
    return renderExpression(expression, options);
  }

  return `(${renderExpression(expression, options)})`;
}

function buildUppercaseVariableMap(instructions: readonly Instruction[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const stringNames: string[] = [];
  const seenStrings = new Set<string>();

  for (const instruction of instructions) {
    if (instruction.kind === "let") {
      if (isStringVariableName(instruction.name)) {
        collectStringName(instruction.name, stringNames, seenStrings);
      } else {
        map.set(instruction.name.toLowerCase(), instruction.name.toUpperCase());
      }
    }
    for (const expression of instructionExpressions(instruction)) {
      collectIdentifiers(expression, map, stringNames, seenStrings);
    }
  }

  allocateSpectrumStringNames(stringNames, map);
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
    case "text-color":
    case "paper":
    case "setcolor":
    case "print-chr":
    case "dim-string":
    case "label":
    case "rem":
    case "goto":
    case "sys":
      return [];
  }
}

function collectIdentifiers(expression: Expression, map: Map<string, string>, stringNames: string[], seenStrings: Set<string>): void {
  switch (expression.kind) {
    case "identifier":
      if (isStringVariableName(expression.name)) {
        collectStringName(expression.name, stringNames, seenStrings);
      } else {
        map.set(expression.name.toLowerCase(), expression.name.toUpperCase());
      }
      break;
    case "parenthesized":
      collectIdentifiers(expression.expression, map, stringNames, seenStrings);
      break;
    case "unary":
      collectIdentifiers(expression.operand, map, stringNames, seenStrings);
      break;
    case "binary":
      collectIdentifiers(expression.left, map, stringNames, seenStrings);
      collectIdentifiers(expression.right, map, stringNames, seenStrings);
      break;
    case "function-call":
      for (const arg of expression.args) {
        collectIdentifiers(arg, map, stringNames, seenStrings);
      }
      break;
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
}

function collectStringName(name: string, stringNames: string[], seenStrings: Set<string>): void {
  const key = name.toLowerCase();
  if (!seenStrings.has(key)) {
    seenStrings.add(key);
    stringNames.push(name);
  }
}

function allocateSpectrumStringNames(names: readonly string[], map: Map<string, string>): void {
  const used = new Set<string>();

  for (const name of names) {
    const upper = name.toUpperCase();
    if (/^[A-Z]\$$/.test(upper) && !used.has(upper)) {
      map.set(name.toLowerCase(), upper);
      used.add(upper);
    }
  }

  for (const name of names) {
    const key = name.toLowerCase();
    if (map.has(key)) {
      continue;
    }
    const next = nextSpectrumStringName(used);
    map.set(key, next);
    used.add(next);
  }
}

function nextSpectrumStringName(used: ReadonlySet<string>): string {
  for (let index = 0; index < 26; index += 1) {
    const candidate = `${String.fromCharCode("A".charCodeAt(0) + index)}$`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("Spectrum target only supports 26 string variables.");
}

function isStringVariableName(name: string): boolean {
  return name.endsWith("$");
}
