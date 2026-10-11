import type { Expression } from "../ast.js";
import { builtinFunctions } from "../functions.js";
import { joystickControl } from "../joystick.js";
import { resolveLabel } from "../line-numbering.js";
import type { ReadabilityLevel } from "../line-numbering.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { isIntegerVariableName, isStringVariableName } from "../variables.js";
import { lowerByteStorage } from "./byte-storage.js";
import { createFunctionRenderer, type FunctionCallExpression } from "./function-rendering.js";
import { instructionExpressions } from "./instruction-expressions.js";
import {
  expandPositionedPrints,
  expandSetColumns,
  expandSetPositions,
  rebuildLabels,
  renderDataValues,
  renderExpression,
  renderInlineInstructionBodies,
  renderPrintItems,
  spectrumColorCodes,
  type ExpressionRenderOptions,
  type TargetBackend
} from "./target.js";

/** BBC BASIC V running in the Agon's 24-bit ADL mode. */
export const agonTarget: TargetBackend = {
  id: "agon",
  gotoSpelling: "GOTO",
  maxLineLength: 251,
  maxLineNumber: 65279,
  variableMap: buildAgonVariableMap,
  lower(program: LoweredProgram, _readability: ReadabilityLevel): LoweredProgram {
    const firstLocation = program.instructions[0]?.location ?? { filename: "<generated>", line: 1 };
    const withMode = rebuildLabels(program, [
      { kind: "graphics-mode", mode: 3, location: firstLocation },
      ...program.instructions
    ]);
    const bytes = lowerByteStorage(withMode, "agon");
    const positions = expandSetPositions(bytes, "Agon Light", 29, 79, (instruction) => [
      { kind: "position", row: instruction.row, column: instruction.column, location: instruction.location }
    ]);
    const columns = expandSetColumns(positions, "Agon Light", 79, (instruction) => [instruction]);
    const prints = expandPositionedPrints(columns, "Agon Light", 29, 79, (instruction) => [instruction]);
    const instructions: Instruction[] = [];
    for (const instruction of prints.instructions) {
      if (instruction.kind === "border-color" || instruction.kind === "suppress-scroll-prompt") {
        continue;
      } else if (instruction.kind === "cls" && instruction.color) {
        instructions.push({ kind: "screen-background-color", color: instruction.color, location: instruction.location });
        instructions.push({ ...instruction, color: undefined });
      } else if (instruction.kind === "on-goto" || instruction.kind === "on-gosub") {
        instructions.push(...lowerSafeDispatch(instruction));
      } else {
        instructions.push(instruction);
      }
    }
    return rebuildLabels(prints, instructions);
  },
  renderLine(lineNumber: number, instruction: Instruction, labelLines: ReadonlyMap<string, number>, readability: ReadabilityLevel): string {
    const variableMap = buildAgonVariableMap(currentProgramInstructions, readability);
    const renderOptions = { variableMap, functionRenderer: renderAgonFunction, arrayRenderer: renderAgonArrayAccess };
    switch (instruction.kind) {
      case "label":
        return `${lineNumber} REM ${instruction.name.toUpperCase()}:`;
      case "rem":
        return `${lineNumber} REM ${instruction.text}`;
      case "cls":
        return `${lineNumber} CLS`;
      case "border-color":
        throw new Error("Internal error: unexpected border-color instruction for Agon Light.");
      case "text-color":
      case "cell-text-color":
        return `${lineNumber} COLOUR ${spectrumColorCodes[instruction.color.color]}`;
      case "screen-background-color":
      case "cell-background-color":
      case "paper":
        return `${lineNumber} COLOUR ${128 + spectrumColorCodes[instruction.color.color]}`;
      case "suppress-scroll-prompt":
        throw new Error("Internal error: unexpected suppress-scroll-prompt instruction for Agon Light.");
      case "program-mode":
        return `${lineNumber} VDU 23,1,0;0;0;0;`;
      case "print": {
        const at = instruction.at
          ? `TAB(${renderExpression(instruction.at.column, renderOptions)},${renderExpression(instruction.at.row, renderOptions)});`
          : "";
        return `${lineNumber} PRINT ${at}${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`;
      }
      case "set-column":
        return `${lineNumber} PRINT TAB(${renderExpression(instruction.column, renderOptions)},VPOS);`;
      case "set-position":
        throw new Error("Internal error: unexpected set-position instruction for Agon Light.");
      case "open-device":
        return `${lineNumber} ${deviceHandleName(instruction.handle)}=OPENOUT("${deviceFileName(instruction.device)}")`;
      case "print-device":
        return `${lineNumber} PRINT#${deviceHandleName(instruction.handle)},${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`;
      case "close-device":
        return `${lineNumber} CLOSE#${deviceHandleName(instruction.handle)}`;
      case "check-device":
        return `${lineNumber} ${renderVariableName(instruction.name, variableMap)}=1`;
      case "data":
        return `${lineNumber} DATA ${renderDataValues(instruction.values, renderOptions)}`;
      case "read":
        return `${lineNumber} READ ${instruction.targets.map((target) => renderVariableName(target, variableMap)).join(",")}`;
      case "restore":
        return `${lineNumber} RESTORE`;
      case "let":
        return `${lineNumber} ${renderVariableName(instruction.name, variableMap)}=${renderExpression(instruction.expression, renderOptions)}`;
      case "multi-let":
        return `${lineNumber} ${instruction.assignments.map((assignment) => `${renderVariableName(assignment.name, variableMap)}=${renderExpression(assignment.expression, renderOptions)}`).join(":")}`;
      case "dim-array":
        return `${lineNumber} DIM ${renderVariableName(instruction.name, variableMap)}(${agonArrayDimensions(instruction.name, instruction.dimensions).join(",")})`;
      case "array-let":
        return `${lineNumber} ${renderAgonArrayAccess({ kind: "array-access", name: instruction.name, indices: instruction.indices, location: instruction.location }, renderOptions)}=${renderExpression(instruction.expression, renderOptions)}`;
      case "goto":
        return `${lineNumber} GOTO ${resolveLabel(labelLines, instruction.label)}`;
      case "gosub":
        return `${lineNumber} GOSUB ${resolveLabel(labelLines, instruction.label)}`;
      case "return":
        return `${lineNumber} RETURN`;
      case "end":
        return `${lineNumber} END`;
      case "for":
        return `${lineNumber} FOR ${renderVariableName(instruction.variable, variableMap)}=${renderExpression(instruction.start, renderOptions)} TO ${renderExpression(instruction.limit, renderOptions)}${instruction.step ? ` STEP ${renderExpression(instruction.step, renderOptions)}` : ""}`;
      case "next":
        return `${lineNumber} NEXT ${renderVariableName(instruction.variable, variableMap)}`;
      case "if-goto":
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN GOTO ${resolveLabel(labelLines, instruction.label)}`;
      case "if-gosub":
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN GOSUB ${resolveLabel(labelLines, instruction.label)}`;
      case "if-then":
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN ${renderInlineInstructionBodies(agonTarget, lineNumber, instruction.body, labelLines, readability)}`;
      case "on-goto":
      case "on-gosub":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for Agon Light.`);
      case "randomize":
        return `${lineNumber} RANDOMIZE ${instruction.seed ? renderExpression(instruction.seed, renderOptions) : "TIME"}`;
      case "position":
        return `${lineNumber} PRINT TAB(${renderExpression(instruction.column, renderOptions)},${renderExpression(instruction.row, renderOptions)});`;
      case "read-key":
        return `${lineNumber} ${renderVariableName(instruction.name, variableMap)}=INKEY$(0)`;
      case "dim-string":
        return `${lineNumber} REM BBC BASIC STRINGS NEED NO DIMENSION`;
      case "graphics-mode":
        return `${lineNumber} MODE ${instruction.mode}`;
      case "setcolor":
      case "poke":
      case "print-chr":
      case "trap":
      case "wait-rs232-transmit":
      case "sys":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for Agon Light.`);
    }
  }
};

let currentProgramInstructions: readonly Instruction[] = [];

export function setAgonRenderProgram(instructions: readonly Instruction[]): void {
  currentProgramInstructions = instructions;
}

const renderKnownAgonFunction = createFunctionRenderer(new Map([
  [builtinFunctions.abs, renderUnary],
  [builtinFunctions.asc, renderUnary],
  [builtinFunctions.atn, renderUnary],
  [builtinFunctions.chr, renderUnary],
  [builtinFunctions.code, renderUnary],
  [builtinFunctions.cos, renderUnary],
  [builtinFunctions.exp, renderUnary],
  [builtinFunctions.freeMemory, () => "(HIMEM-TOP)"],
  [builtinFunctions.getJoystick, renderAgonJoystick],
  [builtinFunctions.int, renderUnary],
  [builtinFunctions.jiffies, () => "TIME"],
  [builtinFunctions.keyCode, () => "INKEY(0)"],
  [builtinFunctions.keyPressed, () => "(INKEY(0)<>-1)"],
  [builtinFunctions.left, renderArgs],
  [builtinFunctions.len, renderUnary],
  [builtinFunctions.mid, renderArgs],
  [builtinFunctions.rnd, () => "RND(1)"],
  [builtinFunctions.right, renderArgs],
  [builtinFunctions.screenCode, renderAgonScreenCode],
  [builtinFunctions.sgn, renderUnary],
  [builtinFunctions.sin, renderUnary],
  [builtinFunctions.sqr, renderUnary],
  [builtinFunctions.str, renderUnary],
  [builtinFunctions.val, renderUnary]
]));

function renderAgonFunction(expression: FunctionCallExpression, options: ExpressionRenderOptions): string | undefined {
  return renderKnownAgonFunction(expression, options);
}

function renderUnary(expression: FunctionCallExpression, options: ExpressionRenderOptions): string {
  return `${expression.name.toUpperCase()}(${renderExpression(expression.args[0], options)})`;
}

function renderArgs(expression: FunctionCallExpression, options: ExpressionRenderOptions): string {
  return `${expression.name.toUpperCase()}(${expression.args.map((argument) => renderExpression(argument, options)).join(",")})`;
}

function renderAgonScreenCode(expression: FunctionCallExpression, options: ExpressionRenderOptions): string {
  const [row, column] = expression.args;
  return `GET((${renderExpression(column, options)})-1,(${renderExpression(row, options)})-1)`;
}

function renderAgonJoystick(expression: FunctionCallExpression): string {
  return [
    "(-INKEY(-56)+INKEY(-55))",
    "(-INKEY(-66)+INKEY(-17))",
    "(-INKEY(-99))"
  ][joystickControl(expression.args[0])];
}

function renderAgonArrayAccess(expression: Extract<Expression, { kind: "array-access" }>, options: ExpressionRenderOptions): string {
  return `${renderVariableName(expression.name, options.variableMap ?? new Map())}(${expression.indices.map((index) => renderExpression(index, options)).join(",")})`;
}

function agonArrayDimensions(name: string, dimensions: readonly number[]): readonly number[] {
  const storageDimensions = isStringVariableName(name) ? dimensions.slice(0, -1) : dimensions;
  return storageDimensions.map((dimension) => dimension - 1);
}

function buildAgonVariableMap(instructions: readonly Instruction[], _readability: ReadabilityLevel): ReadonlyMap<string, string> {
  const names = new Set<string>();
  for (const instruction of instructions) {
    for (const name of instructionNames(instruction)) names.add(name);
    for (const expression of instructionExpressions(instruction)) collectExpressionNames(expression, names);
  }
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const name of names) {
    const suffix = isStringVariableName(name) ? "$" : isIntegerVariableName(name) ? "%" : "";
    const base = name.replace(/[$%]$/u, "").toUpperCase().replaceAll(/[^A-Z0-9_]/g, "_") || "V";
    let candidate = `${base}${suffix}`;
    let serial = 1;
    while (used.has(candidate)) candidate = `${base}_${serial++}${suffix}`;
    result.set(name.toLowerCase(), candidate);
    used.add(candidate);
  }
  return result;
}

function instructionNames(instruction: Instruction): readonly string[] {
  switch (instruction.kind) {
    case "let":
    case "check-device":
    case "read-key":
    case "dim-array":
    case "array-let":
    case "dim-string":
      return [instruction.name];
    case "multi-let":
      return instruction.assignments.map((assignment) => assignment.name);
    case "read":
      return instruction.targets;
    case "for":
    case "next":
      return [instruction.variable];
    default:
      return [];
  }
}

function collectExpressionNames(expression: Expression, names: Set<string>): void {
  switch (expression.kind) {
    case "identifier":
      names.add(expression.name);
      break;
    case "array-access":
      names.add(expression.name);
      expression.indices.forEach((index) => collectExpressionNames(index, names));
      break;
    case "struct-field-access":
      names.add(expression.base);
      expression.indices.forEach((index) => collectExpressionNames(index, names));
      break;
    case "function-call":
      expression.args.forEach((argument) => collectExpressionNames(argument, names));
      break;
    case "parenthesized":
      collectExpressionNames(expression.expression, names);
      break;
    case "unary":
      collectExpressionNames(expression.operand, names);
      break;
    case "binary":
      collectExpressionNames(expression.left, names);
      collectExpressionNames(expression.right, names);
      break;
    default:
      break;
  }
}

function renderVariableName(name: string, variableMap: ReadonlyMap<string, string>): string {
  return variableMap.get(name.toLowerCase()) ?? name.toUpperCase();
}

function lowerSafeDispatch(instruction: Extract<Instruction, { kind: "on-goto" | "on-gosub" }>): Instruction[] {
  return instruction.labels.map((label, index) => ({
    kind: instruction.kind === "on-goto" ? "if-goto" as const : "if-gosub" as const,
    condition: {
      kind: "binary" as const,
      operator: "=" as const,
      left: instruction.expression,
      right: { kind: "number" as const, value: index + 1, raw: String(index + 1), location: instruction.location },
      location: instruction.location
    },
    label,
    location: instruction.location
  }));
}

function deviceHandleName(handle: string): string {
  const handles: string[] = [];
  for (const instruction of currentProgramInstructions) {
    if (instruction.kind !== "open-device") continue;
    const key = instruction.handle.toLowerCase();
    if (!handles.includes(key)) handles.push(key);
  }
  return `MBDEVICE${Math.max(0, handles.indexOf(handle.toLowerCase()))}%`;
}

function deviceFileName(device: "printer" | "text-printer" | "shared-drive" | "rs232"): string {
  switch (device) {
    case "printer": return "PRINTER.DAT";
    case "text-printer": return "TEXTPRNT.DAT";
    case "shared-drive": return "MCP.DAT";
    case "rs232": return "RS232.DAT";
  }
}
