import type { Expression } from "../ast.js";
import { DiagnosticError } from "../diagnostics.js";
import { builtinFunctions } from "../functions.js";
import { resolveLabel } from "../line-numbering.js";
import type { Instruction } from "../lowering.js";
import { isStringVariableName } from "../variables.js";
import { renderDataValues, renderExpression, renderPrintItems, validateConstantCoordinate, type ExpressionRenderOptions } from "./target.js";
import type { PortableColor } from "./environment.js";

// HC-BASIC's background code 7 is grey, the closest available to white.
const colors: Readonly<Record<PortableColor, number>> = {
  BLACK: 0, BLUE: 1, RED: 2, MAGENTA: 3, GREEN: 4, CYAN: 5, YELLOW: 6, WHITE: 7
};

const nativeFunctions = new Set<string>([
  builtinFunctions.abs, builtinFunctions.asc, builtinFunctions.atn, builtinFunctions.chr,
  builtinFunctions.cos, builtinFunctions.exp, builtinFunctions.int, builtinFunctions.left,
  builtinFunctions.len, builtinFunctions.mid, builtinFunctions.right, builtinFunctions.sgn,
  builtinFunctions.sin, builtinFunctions.sqr, builtinFunctions.str, builtinFunctions.val
]);

/** Render the HC-BASIC core; unsupported operations fail at their source location. */
export function renderKc85Line(line: number, instruction: Instruction, labels: ReadonlyMap<string, number>, variables: ReadonlyMap<string, string>): string {
  const name = (value: string): string => {
    const mapped = variables.get(value.toLowerCase());
    if (!mapped) throw new DiagnosticError(instruction.location, `KC 85 variable ${value} was not allocated.`);
    return mapped;
  };
  const options: ExpressionRenderOptions = {
    variableMap: variables,
    nativeComparisonTruth: true,
    arrayRenderer: (value, opts) => `${name(value.name)}(${value.indices.map((index) => renderExpression(index, opts)).join(",")})`,
    functionRenderer: (value, opts) => {
      const functionName = value.name.toUpperCase();
      if (functionName === "__KC85_SEED_RND") return `RND(-ABS(${renderExpression(value.args[0], opts)})-1)`;
      if (functionName === "__KC85_ROW") return "(CSRLIN(1)+1)";
      // CAOS CURSO at B7A0 is at offset 14240 in the video-memory window.
      if (functionName === "__KC85_COLUMN") return "(VPEEK(14240)+1)";
      if (functionName === "__KC85_SCREEN") return "ASC(VGET$)";
      if (functionName === "__KC85_TONE_ACTIVE") return "((PEEK(504) AND 2)<>0)";
      if (functionName === "__KC85_CLOCK_HIGH") return "PEEK(481)";
      if (functionName === "__KC85_CLOCK_LOW") return "PEEK(480)";
      if (functionName === "__KC85_IRQ_LOW") return "PEEK(492)";
      if (functionName === "__KC85_IRQ_HIGH") return "PEEK(493)";
      if (functionName === "__KC85_MAX_VOLUME") return "(INP(137) AND 224)";
      if (functionName === "__KC85_JOY_RAW") return "INP(144)";
      if (functionName === "__KC85_JOY_BIT") return `(${renderExpression(value.args[0], opts)} AND ${renderExpression(value.args[1], opts)})`;
      if (functionName === builtinFunctions.code) return `ASC(${renderExpression(value.args[0], opts)})`;
      // HC-BASIC returns a signed 16-bit result for memory above 32767 bytes.
      if (functionName === builtinFunctions.freeMemory) return "(FRE(0)-65536*(FRE(0)<0))";
      if (functionName === builtinFunctions.rnd) return "RND(1)";
      if (nativeFunctions.has(functionName)) return `${functionName}(${value.args.map((arg) => renderExpression(arg, opts)).join(",")})`;
      throw new DiagnosticError(value.location, `KC 85 support for ${value.name} is not implemented.`);
    }
  };
  const expr = (value: Expression): string => renderExpression(value, options);
  const coordinate = (value: Expression, axis: "row" | "column"): string => {
    // HC-BASIC starts with a 30-row window even though the physical screen
    // can expose 32 rows after an explicit WINDOW command.
    validateConstantCoordinate(value, axis, axis === "row" ? 29 : 39, "KC 85");
    return value.kind === "number" ? String(value.value - 1) : `(${expr(value)})-1`;
  };
  const prefix = `${line} `;
  switch (instruction.kind) {
    case "label": return `${prefix}REM ${instruction.name.toUpperCase()}:`;
    case "rem": return `${prefix}REM ${instruction.text}`;
    case "cls":
      return `${prefix}${instruction.color ? `PAPER ${colors[instruction.color.color]}:` : ""}CLS`;
    case "text-color": case "cell-text-color": return `${prefix}INK ${colors[instruction.color.color]}`;
    case "screen-background-color": case "cell-background-color": case "paper":
      return `${prefix}PAPER ${colors[instruction.color.color]}`;
    case "border-color": return `${prefix}PRINT "";`;
    case "suppress-scroll-prompt": case "program-mode": return `${prefix}PRINT CHR$(18);`;
    case "print":
      if (instruction.inverted) throw new DiagnosticError(instruction.location, "KC 85 inverted output is not implemented.");
      return `${prefix}${instruction.at ? `LOCATE ${coordinate(instruction.at.row, "row")},${coordinate(instruction.at.column, "column")}:` : ""}PRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon, options)}`;
    case "set-position": return `${prefix}LOCATE ${coordinate(instruction.row, "row")},${coordinate(instruction.column, "column")}`;
    case "set-column": return `${prefix}LOCATE CSRLIN(1),${coordinate(instruction.column, "column")}`;
    case "beep": {
      const counter = instruction.pitch.kind === "number" ? String(Math.abs(instruction.pitch.value)) : `ABS(${expr(instruction.pitch)})`;
      const prescaler = instruction.pitch.kind === "number" ? (instruction.pitch.value < 0 ? "1" : "0") : `ABS(${expr(instruction.pitch)}<0)`;
      return `${prefix}SOUND ${counter},${prescaler},0,0,31,${expr(instruction.duration)}`;
    }
    case "let": return `${prefix}${name(instruction.name)}=${expr(instruction.expression)}`;
    case "multi-let": return `${prefix}${instruction.assignments.map((item) => `${name(item.name)}=${expr(item.expression)}`).join(":")}`;
    case "dim-array": return `${prefix}DIM ${name(instruction.name)}(${(isStringVariableName(instruction.name) ? instruction.dimensions.slice(0, -1) : instruction.dimensions).map((size) => size - 1).join(",")})`;
    // REM consumes the rest of a packed BASIC line. An empty non-advancing
    // PRINT is safe when other instructions share the line.
    case "dim-string": return `${prefix}PRINT "";`;
    case "array-let": return `${prefix}${name(instruction.name)}(${instruction.indices.map(expr).join(",")})=${expr(instruction.expression)}`;
    case "data": return `${prefix}DATA ${renderDataValues(instruction.values, options)}`;
    case "read": return `${prefix}READ ${instruction.targets.map(name).join(",")}`;
    case "input": return `${prefix}INPUT ${instruction.targets.map(name).join(",")}`;
    case "restore": return `${prefix}RESTORE`;
    case "goto": return `${prefix}GOTO ${resolveLabel(labels, instruction.label)}`;
    case "gosub": return `${prefix}GOSUB ${resolveLabel(labels, instruction.label)}`;
    case "return": return `${prefix}RETURN`;
    case "end": return `${prefix}END`;
    case "for": return `${prefix}FOR ${name(instruction.variable)}=${expr(instruction.start)} TO ${expr(instruction.limit)}${instruction.step ? ` STEP ${expr(instruction.step)}` : ""}`;
    case "next": return `${prefix}NEXT ${name(instruction.variable)}`;
    case "if-goto": return `${prefix}IF ${expr(instruction.condition)} THEN ${resolveLabel(labels, instruction.label)}`;
    case "if-gosub": return `${prefix}IF ${expr(instruction.condition)} THEN GOSUB ${resolveLabel(labels, instruction.label)}`;
    case "if-then": return `${prefix}IF ${expr(instruction.condition)} THEN ${instruction.body.map((item) => renderKc85Line(line, item, labels, variables).slice(prefix.length)).join(":")}`;
    case "on-goto": case "on-gosub": return `${prefix}ON ${expr(instruction.expression)} ${instruction.kind === "on-goto" ? "GOTO" : "GOSUB"} ${instruction.labels.map((label) => resolveLabel(labels, label)).join(",")}`;
    case "randomize":
      if (instruction.seed) throw new DiagnosticError(instruction.location, "KC 85 seeded RANDOMIZE is not implemented.");
      return `${prefix}RANDOMIZE`;
    case "read-key": return `${prefix}${name(instruction.name)}=INKEY$`;
    case "poke": return `${prefix}POKE ${typeof instruction.address === "number" ? instruction.address : expr(instruction.address)},${expr(instruction.value)}`;
    case "port-out": return `${prefix}OUT ${instruction.port},${expr(instruction.value)}`;
    case "print-chr": return `${prefix}PRINT CHR$(${instruction.code})${instruction.trailingSemicolon ? ";" : ""}`;
    default: throw new DiagnosticError(instruction.location, `KC 85 support for ${instruction.kind} is not implemented.`);
  }
}
