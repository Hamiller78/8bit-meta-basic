import type { Expression } from "../ast.js";
import { DiagnosticError } from "../diagnostics.js";
import { builtinFunctions } from "../functions.js";
import { joystickControl } from "../joystick.js";
import { resolveLabel } from "../line-numbering.js";
import { normalizeLabel, type Instruction, type LoweredProgram } from "../lowering.js";
import { isStringVariableName } from "../variables.js";
import { cpcVariableMap } from "./cpc-variables.js";
import { lowerByteStorage } from "./byte-storage.js";
import { lowerSequentialFileIo } from "./file-io.js";
import { createGeneratedVariableNameAllocator } from "./string-array-lengths.js";
import { createFunctionRenderer, type FunctionCallExpression } from "./function-rendering.js";
import { mapInstructionExpressions } from "./instruction-expressions.js";
import { groupInvertedPrints, rebuildLabels, renderDataValues, renderExpression, renderInlineInstructionBodies, renderPrintItems, validateConstantCoordinate, type ExpressionRenderOptions, type TargetBackend } from "./target.js";

let currentInstructions: readonly Instruction[] = [];
export function setCpcRenderProgram(instructions: readonly Instruction[]): void { currentInstructions = instructions; }
const colors = { BLACK: 0, BLUE: 1, RED: 6, MAGENTA: 7, GREEN: 18, CYAN: 19, YELLOW: 24, WHITE: 26 } as const;
const defaultPenColors = ["WHITE", "YELLOW", "RED", "GREEN", "CYAN", "BLUE", "MAGENTA", "BLACK"] as const;

function renderArgs(expression: FunctionCallExpression, options: ExpressionRenderOptions): string {
  return `${expression.name.toUpperCase()}(${expression.args.map((arg) => renderExpression(arg, options)).join(",")})`;
}

const renderFunction = createFunctionRenderer(new Map([
  ...[builtinFunctions.abs, builtinFunctions.asc, builtinFunctions.atn, builtinFunctions.chr,
    builtinFunctions.cos, builtinFunctions.exp, builtinFunctions.int, builtinFunctions.left,
    builtinFunctions.len, builtinFunctions.mid, builtinFunctions.right, builtinFunctions.sgn,
    builtinFunctions.sin, builtinFunctions.sqr, builtinFunctions.str, builtinFunctions.val].map((name) => [name, renderArgs] as const),
  [builtinFunctions.code, (expression: FunctionCallExpression, options: ExpressionRenderOptions) => `ASC(${renderExpression(expression.args[0], options)})`],
  [builtinFunctions.jiffies, () => "TIME"],
  [builtinFunctions.freeMemory, () => "FRE(0)"],
  [builtinFunctions.getJoystick, (expression: FunctionCallExpression) => [
    "((JOY(0) AND 4)<>0)-((JOY(0) AND 8)<>0)",
    "((JOY(0) AND 1)<>0)-((JOY(0) AND 2)<>0)",
    "-((JOY(0) AND 16)<>0)"
  ][joystickControl(expression.args[0])]],
  [builtinFunctions.rnd, () => "RND(1)"]
]));

/** Locomotive BASIC for a CPC in 40-column MODE 1. */
export const cpcTarget: TargetBackend = {
  id: "cpc",
  gotoSpelling: "GOTO",
  maxLineLength: 255,
  maxLineNumber: 65535,
  variableMap: cpcVariableMap,
  lower(program: LoweredProgram): LoweredProgram {
    const priority = [...(program.penColors ?? []), ...defaultPenColors.filter((color) => !program.penColors?.includes(color))].slice(0, 2);
    const colorPen = (color: keyof typeof colors, fallback: number): number => {
      const index = priority.indexOf(color);
      return index < 0 ? fallback : index + 2;
    };
    const validateText = (expression: Expression): Expression => {
      switch (expression.kind) {
        case "string":
          if (/[^\x20-\x7e]/u.test(expression.value)) throw new DiagnosticError(expression.location, "Amstrad CPC currently supports ASCII text only.");
          break;
        case "function-call": expression.args.forEach(validateText); break;
        case "array-access": case "struct-field-access": expression.indices.forEach(validateText); break;
        case "parenthesized": validateText(expression.expression); break;
        case "unary": validateText(expression.operand); break;
        case "binary": validateText(expression.left); validateText(expression.right); break;
        default: break;
      }
      return expression;
    };
    const validate = (instruction: Instruction): void => {
      if (instruction.kind === "print" && instruction.at) {
        validateConstantCoordinate(instruction.at.row, "row", 24, "Amstrad CPC");
        validateConstantCoordinate(instruction.at.column, "column", 39, "Amstrad CPC");
      } else if (instruction.kind === "set-position") {
        validateConstantCoordinate(instruction.row, "row", 24, "Amstrad CPC", "SET_POS");
        validateConstantCoordinate(instruction.column, "column", 39, "Amstrad CPC", "SET_POS");
      } else if (instruction.kind === "set-column") {
        validateConstantCoordinate(instruction.column, "column", 39, "Amstrad CPC", "SET_COLUMN");
      } else if (instruction.kind === "if-then") instruction.body.forEach(validate);
    };
    program.instructions.forEach((instruction) => { validate(instruction); mapInstructionExpressions(instruction, validateText); });
    const grouped = groupInvertedPrints(lowerCpcScreenReads(lowerCpcKeyboardReads(lowerCpcBeeps(lowerByteStorage(lowerSequentialFileIo(program), "cpc")))));
    const allocate = createGeneratedVariableNameAllocator(grouped.instructions, "MBCPCDISPATCH");
    const instructions: Instruction[] = [];
    for (const instruction of grouped.instructions) {
      if (instruction.kind !== "on-goto" && instruction.kind !== "on-gosub") {
        instructions.push(instruction);
        continue;
      }
      const temporary = allocate();
      instructions.push({ kind: "let", name: temporary, expression: instruction.expression, location: instruction.location });
      for (const [index, label] of instruction.labels.entries()) {
        instructions.push({
          kind: instruction.kind === "on-goto" ? "if-goto" : "if-gosub",
          condition: {
            kind: "binary", operator: "=", location: instruction.location,
            left: { kind: "identifier", name: temporary, location: instruction.location },
            right: { kind: "number", value: index + 1, raw: String(index + 1), location: instruction.location }
          },
          label, location: instruction.location
        });
      }
    }
    const mapPens = (instruction: Instruction): Instruction => {
      if (instruction.kind === "cell-text-color") return { ...instruction, cpcPen: colorPen(instruction.color.color, 1) };
      if (instruction.kind === "cell-background-color") return { ...instruction, cpcPen: colorPen(instruction.color.color, 0) };
      if (instruction.kind === "if-then") return { ...instruction, body: instruction.body.map(mapPens) };
      return instruction;
    };
    const lowered = rebuildLabels(grouped, instructions.map(mapPens));
    const location = lowered.instructions[0]?.location ?? { filename: "<generated>", line: 1 };
    return rebuildLabels(lowered, [{ kind: "graphics-mode", mode: 1, cpcInks: priority.map((color) => colors[color]), location }, ...lowered.instructions]);
  },
  renderLine(lineNumber, instruction, labelLines, readability): string {
    const map = cpcVariableMap(currentInstructions);
    const name = (value: string): string => map.get(value.toLowerCase()) ?? value.toUpperCase();
    const options: ExpressionRenderOptions = {
      variableMap: map, functionRenderer: (value, opts) => {
        if (value.name === "__CPC_POS") return "POS(#0)";
        if (value.name === "__CPC_VPOS") return "VPOS(#0)";
        if (value.name === "__CPC_SCREEN") return "ASC(COPYCHR$(#0))";
        if (value.name === builtinFunctions.fileExists) throw new DiagnosticError(value.location, "FILE_EXISTS is not yet supported for Amstrad CPC.");
        return renderFunction(value, opts);
      }, nativeComparisonTruth: true,
      arrayRenderer: (value, opts) => `${name(value.name)}(${value.indices.map((index) => renderExpression(index, opts)).join(",")})`
    };
    const expr = (value: Expression): string => renderExpression(value, options);
    const prefix = `${lineNumber} `;
    switch (instruction.kind) {
      case "label": return `${prefix}REM ${instruction.name.toUpperCase()}:`;
      case "rem": return `${prefix}REM ${instruction.text}`;
      case "graphics-mode": return `${prefix}MODE ${instruction.mode}${instruction.cpcInks?.map((ink, index) => `:INK ${index + 2},${ink}`).join("") ?? ""}`;
      case "cls": return `${prefix}${instruction.color ? `INK 0,${colors[instruction.color.color]}:PAPER 0:` : ""}CLS`;
      case "border-color": return `${prefix}BORDER ${colors[instruction.color.color]}`;
      case "text-color": return `${prefix}INK 1,${colors[instruction.color.color]}:PEN 1`;
      case "cell-text-color": return `${prefix}PEN ${instruction.cpcPen ?? 1}`;
      case "screen-background-color": case "paper": return `${prefix}INK 0,${colors[instruction.color.color]}:PAPER 0`;
      case "cell-background-color": return `${prefix}PAPER ${instruction.cpcPen ?? 0}`;
      case "program-mode": case "suppress-scroll-prompt": return `${prefix}PRINT "";`;
      case "inverse-text": return `${prefix}PRINT CHR$(24);`;
      case "print": return `${prefix}${instruction.at ? `LOCATE ${expr(instruction.at.column)},${expr(instruction.at.row)}:` : ""}PRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon, options)}`;
      case "set-position": return `${prefix}LOCATE ${expr(instruction.column)},${expr(instruction.row)}`;
      case "set-column": return `${prefix}LOCATE ${expr(instruction.column)},VPOS(#0)`;
      case "position": return `${prefix}LOCATE ${expr(instruction.column)},${expr(instruction.row)}`;
      case "print-device": return `${prefix}PRINT #8,${renderPrintItems(instruction.items, instruction.trailingSemicolon, options)}`;
      case "open-device":
        if (instruction.device !== "printer" && instruction.device !== "text-printer") throw new DiagnosticError(instruction.location, `Amstrad CPC does not support the ${instruction.device} device.`);
        return `${prefix}PRINT #8,"";`;
      case "close-device": return `${prefix}PRINT #8,"";`;
      case "check-device": return `${prefix}${name(instruction.name)}=${instruction.device === "printer" || instruction.device === "text-printer" ? 1 : 0}`;
      case "data": return `${prefix}DATA ${renderDataValues(instruction.values, options)}`;
      case "read": return `${prefix}READ ${instruction.targets.map(name).join(",")}`;
      case "input": return `${prefix}INPUT ${instruction.targets.map(name).join(",")}`;
      case "open-data-file":
        if (instruction.storage !== "disk") throw new DiagnosticError(instruction.location, "Amstrad CPC data-file operations support disk storage only.");
        return `${prefix}${instruction.mode === "read" ? "OPENIN" : "OPENOUT"} "${instruction.filename}.DAT"`;
      case "write-data-file": return `${prefix}PRINT #9,${expr(instruction.expression)}`;
      case "read-data-file": return `${prefix}INPUT #9,${expr(instruction.target)}`;
      case "close-data-file": return `${prefix}${instruction.mode === "read" ? "CLOSEIN" : "CLOSEOUT"}`;
      case "delete-data-file": return `${prefix}|ERA,"${instruction.filename}.DAT"`;
      case "check-data-file": throw new DiagnosticError(instruction.location, "FILE_EXISTS is not yet supported for Amstrad CPC.");
      case "restore": return `${prefix}RESTORE`;
      case "let": return `${prefix}${name(instruction.name)}=${expr(instruction.expression)}`;
      case "multi-let": return `${prefix}${instruction.assignments.map((item) => `${name(item.name)}=${expr(item.expression)}`).join(":")}`;
      case "dim-array": return `${prefix}DIM ${name(instruction.name)}(${(isStringVariableName(instruction.name) ? instruction.dimensions.slice(0, -1) : instruction.dimensions).map((size) => size - 1).join(",")})`;
      case "dim-string": return `${prefix}PRINT "";`;
      case "array-let": return `${prefix}${name(instruction.name)}(${instruction.indices.map(expr).join(",")})=${expr(instruction.expression)}`;
      case "goto": return `${prefix}GOTO ${resolveLabel(labelLines, instruction.label)}`;
      case "gosub": return `${prefix}GOSUB ${resolveLabel(labelLines, instruction.label)}`;
      case "return": return `${prefix}RETURN`;
      case "end": return `${prefix}END`;
      case "for": return `${prefix}FOR ${name(instruction.variable)}=${expr(instruction.start)} TO ${expr(instruction.limit)}${instruction.step ? ` STEP ${expr(instruction.step)}` : ""}`;
      case "next": return `${prefix}NEXT ${name(instruction.variable)}`;
      case "if-goto": return `${prefix}IF ${expr(instruction.condition)} THEN ${resolveLabel(labelLines, instruction.label)}`;
      case "if-gosub": return `${prefix}IF ${expr(instruction.condition)} THEN GOSUB ${resolveLabel(labelLines, instruction.label)}`;
      case "if-then": return `${prefix}IF ${expr(instruction.condition)} THEN ${renderInlineInstructionBodies(cpcTarget, lineNumber, instruction.body, labelLines, readability)}`;
      case "on-goto": case "on-gosub": return `${prefix}ON ${expr(instruction.expression)} ${instruction.kind === "on-goto" ? "GOTO" : "GOSUB"} ${instruction.labels.map((label) => resolveLabel(labelLines, label)).join(",")}`;
      case "randomize": return `${prefix}RANDOMIZE ${instruction.seed ? expr(instruction.seed) : "TIME"}`;
      case "read-key": return `${prefix}${name(instruction.name)}=INKEY$`;
      case "poke": return `${prefix}POKE ${typeof instruction.address === "number" ? instruction.address : expr(instruction.address)},${expr(instruction.value)}`;
      case "print-chr": return `${prefix}PRINT CHR$(${instruction.code})${instruction.trailingSemicolon ? ";" : ""}`;
      case "beep": return instruction.duration.kind === "number" && instruction.duration.value === 0
        ? `${prefix}SOUND 129,0,1,0`
        : `${prefix}SOUND 129,INT(62500/(261.625565*2^(${expr(instruction.pitch)}/12))+.5),INT(${expr(instruction.duration)}*100)+1,15`;
      default: throw new DiagnosticError(instruction.location, `Amstrad CPC support for ${instruction.kind} is not implemented.`);
    }
  }
};

function lowerCpcBeeps(program: LoweredProgram): LoweredProgram {
  if (!program.instructions.some((instruction) => instruction.kind === "beep")) return program;
  const allocate = createGeneratedVariableNameAllocator(program.instructions, "MBCPCBEEP");
  const labels = new Set(program.labels.keys());
  let nextLabel = 0;
  const label = (): string => {
    let value: string;
    do { value = `__mb_cpc_beep_${nextLabel++}`; } while (labels.has(normalizeLabel(value)));
    labels.add(normalizeLabel(value));
    return value;
  };
  const lowered: Instruction[] = [];
  for (const instruction of program.instructions) {
    if (instruction.kind !== "beep") { lowered.push(instruction); continue; }
    const location = instruction.location, duration = allocate(), pitch = allocate(), start = allocate(), chunk = allocate(), nextChunk = label(), loop = label(), end = label();
    const id = (name: string): Expression => ({ kind: "identifier", name, location });
    const num = (value: number): Expression => ({ kind: "number", value, raw: String(value), location });
    const binary = (operator: "<" | "<=" | ">" | "-" | "*", left: Expression, right: Expression): Expression => ({ kind: "binary", operator, left, right, location });
    const time = (): Expression => ({ kind: "function-call", name: builtinFunctions.jiffies, args: [], valueType: "number", location });
    lowered.push(
      { kind: "let", name: duration, expression: instruction.duration, location },
      { kind: "let", name: pitch, expression: instruction.pitch, location },
      { kind: "if-goto", condition: binary("<=", id(duration), num(0)), label: end, location },
      { kind: "label", name: nextChunk, internal: true, location },
      { kind: "let", name: chunk, expression: id(duration), location },
      { kind: "if-then", condition: binary(">", id(chunk), num(300)), body: [{ kind: "let", name: chunk, expression: num(300), location }], originalSkipLabel: "", location },
      { kind: "beep", duration: id(chunk), pitch: id(pitch), location },
      { kind: "let", name: start, expression: time(), location },
      { kind: "label", name: loop, internal: true, location },
      { kind: "if-goto", condition: binary("<", binary("-", time(), id(start)), binary("*", id(chunk), num(300))), label: loop, location },
      { kind: "beep", duration: num(0), pitch: num(0), location },
      { kind: "let", name: duration, expression: binary("-", id(duration), id(chunk)), location },
      { kind: "if-goto", condition: binary(">", id(duration), num(0)), label: nextChunk, location },
      { kind: "label", name: end, internal: true, location }
    );
  }
  return rebuildLabels(program, lowered);
}

function lowerCpcKeyboardReads(program: LoweredProgram): LoweredProgram {
  const allocate = createGeneratedVariableNameAllocator(program.instructions, "MBCPCKEY", "$");
  const key = allocate();
  const lower = (instruction: Instruction): { instruction: Instruction; prefix: Instruction[]; suffix: Instruction[] } => {
    const prefix: Instruction[] = [], suffix: Instruction[] = [];
    const location = instruction.location;
    const keyExpr = (): Expression => ({ kind: "identifier", name: key, valueType: "string", location });
    const empty = (): Expression => ({ kind: "string", value: "", location });
    const condition = (operator: "=" | "<>"): Expression => ({ kind: "binary", operator, left: keyExpr(), right: empty(), location });
    const poll = (): void => { prefix.push({ kind: "if-then", condition: condition("="), body: [{ kind: "read-key", name: key, location }], originalSkipLabel: "", location }); };
    const rewrite = (expression: Expression): Expression => {
      switch (expression.kind) {
        case "function-call":
          if (expression.name === builtinFunctions.keyPressed) { poll(); return condition("<>"); }
          return { ...expression, args: expression.args.map(rewrite) };
        case "array-access": return { ...expression, indices: expression.indices.map(rewrite) };
        case "struct-field-access": return { ...expression, indices: expression.indices.map(rewrite) };
        case "parenthesized": return { ...expression, expression: rewrite(expression.expression) };
        case "unary": return { ...expression, operand: rewrite(expression.operand) };
        case "binary": return { ...expression, left: rewrite(expression.left), right: rewrite(expression.right) };
        default: return expression;
      }
    };
    if (instruction.kind === "let" && instruction.expression.kind === "function-call" && instruction.expression.name === builtinFunctions.keyCode) {
      poll();
      const zero: Expression = { kind: "number", value: 0, raw: "0", location };
      const asc: Expression = { kind: "function-call", name: builtinFunctions.asc, args: [keyExpr()], valueType: "number", location };
      suffix.push({ kind: "if-then", condition: condition("<>"), body: [{ ...instruction, expression: asc }], originalSkipLabel: "", location });
      suffix.push({ kind: "let", name: key, expression: empty(), location });
      return { instruction: { ...instruction, expression: zero }, prefix, suffix };
    }
    if (instruction.kind === "if-then") {
      const conditionValue = rewrite(instruction.condition);
      const body = instruction.body.flatMap((item) => { const result = lower(item); return [...result.prefix, result.instruction, ...result.suffix]; });
      return { instruction: { ...instruction, condition: conditionValue, body }, prefix, suffix };
    }
    return { instruction: mapInstructionExpressions(instruction, rewrite), prefix, suffix };
  };
  return rebuildLabels(program, program.instructions.flatMap((instruction) => {
    const result = lower(instruction);
    return [...result.prefix, result.instruction, ...result.suffix];
  }));
}

function lowerCpcScreenReads(program: LoweredProgram): LoweredProgram {
  const allocate = createGeneratedVariableNameAllocator(program.instructions, "MBCPCSCREEN");
  const lower = (instruction: Instruction): { instruction: Instruction; prefix: Instruction[] } => {
    const prefix: Instruction[] = [];
    const rewrite = (expression: Expression): Expression => {
      switch (expression.kind) {
        case "function-call": {
          const args = expression.args.map(rewrite);
          if (expression.name !== builtinFunctions.screenCode) return { ...expression, args };
          const location = expression.location;
          const rowName = allocate(), colName = allocate(), savedRow = allocate(), savedCol = allocate(), valueName = allocate();
          const id = (name: string): Expression => ({ kind: "identifier", name, location });
          const call = (name: string): Expression => ({ kind: "function-call", name, args: [], valueType: "number", location });
          prefix.push(
            { kind: "let", name: rowName, expression: args[0], location },
            { kind: "let", name: colName, expression: args[1], location },
            { kind: "let", name: savedRow, expression: call("__CPC_VPOS"), location },
            { kind: "let", name: savedCol, expression: call("__CPC_POS"), location },
            { kind: "set-position", row: id(rowName), column: id(colName), location },
            { kind: "let", name: valueName, expression: call("__CPC_SCREEN"), location },
            { kind: "set-position", row: id(savedRow), column: id(savedCol), location }
          );
          return id(valueName);
        }
        case "array-access": return { ...expression, indices: expression.indices.map(rewrite) };
        case "struct-field-access": return { ...expression, indices: expression.indices.map(rewrite) };
        case "parenthesized": return { ...expression, expression: rewrite(expression.expression) };
        case "unary": return { ...expression, operand: rewrite(expression.operand) };
        case "binary": return { ...expression, left: rewrite(expression.left), right: rewrite(expression.right) };
        default: return expression;
      }
    };
    if (instruction.kind === "if-then") {
      const condition = rewrite(instruction.condition);
      const body = instruction.body.flatMap((item) => {
        const result = lower(item);
        return [...result.prefix, result.instruction];
      });
      return { instruction: { ...instruction, condition, body }, prefix };
    }
    return { instruction: mapInstructionExpressions(instruction, rewrite), prefix };
  };
  return rebuildLabels(program, program.instructions.flatMap((instruction) => {
    const result = lower(instruction);
    return [...result.prefix, result.instruction];
  }));
}
