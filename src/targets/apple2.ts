import { DiagnosticError } from "../diagnostics.js";
import { builtinFunctions } from "../functions.js";
import { resolveLabel } from "../line-numbering.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { isStringVariableName } from "../variables.js";
import { kc85VariableMap } from "./kc85-variables.js";
import { lowerByteStorage } from "./byte-storage.js";
import { lowerInkeyReads } from "./inkey-lowering.js";
import { lowerSafeDispatch } from "./safe-dispatch.js";
import { lowerSequentialFileIo } from "./file-io.js";
import { createGeneratedVariableNameAllocator } from "./string-array-lengths.js";
import { createRenderVariableMapCache, groupInvertedPrints, rebuildLabels, renderDataValues, renderExpression, renderPrintItems, validateConstantCoordinate, type ExpressionRenderOptions, type TargetBackend } from "./target.js";

// Applesoft also distinguishes only the first two characters of variable names.
const maps = createRenderVariableMapCache(kc85VariableMap);
export function setApple2RenderProgram(instructions: readonly Instruction[]): void { maps.reset(instructions); }

const functions = new Set<string>([builtinFunctions.abs, builtinFunctions.asc, builtinFunctions.atn,
  builtinFunctions.chr, builtinFunctions.cos, builtinFunctions.exp, builtinFunctions.int,
  builtinFunctions.left, builtinFunctions.len, builtinFunctions.mid, builtinFunctions.right,
  builtinFunctions.sgn, builtinFunctions.sin, builtinFunctions.sqr, builtinFunctions.str, builtinFunctions.val]);

export const apple2Target: TargetBackend = {
  id: "apple2", gotoSpelling: "GOTO", maxLineLength: 239, maxLineNumber: 63999,
  variableMap: kc85VariableMap,
  lower(program: LoweredProgram): LoweredProgram {
    const fileProgram = lowerSequentialFileIo(program);
    const allocate = createGeneratedVariableNameAllocator(fileProgram.instructions, "MBAPPLERND");
    let seedName: string | undefined;
    const seed = (instruction: Instruction): Instruction => {
      if (instruction.kind === "if-then") return { ...instruction, body: instruction.body.map(seed) };
      if (instruction.kind !== "randomize") return instruction;
      if (!instruction.seed) throw new DiagnosticError(instruction.location, "Apple II RANDOMIZE requires an explicit seed.");
      seedName ??= allocate();
      return { kind: "let", name: seedName, location: instruction.location,
        expression: { kind: "function-call", name: "__APPLE2_SEED", args: [instruction.seed], valueType: "number", location: instruction.location } };
    };
    const seeded = rebuildLabels(fileProgram, fileProgram.instructions.map(seed));
    return lowerSafeDispatch(lowerInkeyReads(groupInvertedPrints(lowerByteStorage(seeded, "apple2")), "MBAPPLEKEY"), "MBAPPLEDISPATCH");
  },
  renderLine(line, instruction, labels, readability): string {
    const variables = maps.get(readability);
    const name = (value: string): string => {
      const result = variables.get(value.toLowerCase());
      if (!result) throw new DiagnosticError(instruction.location, `Apple II variable ${value} was not allocated.`);
      return result;
    };
    const options: ExpressionRenderOptions = {
      variableMap: variables, nativeComparisonTruth: true,
      arrayRenderer: (value, opts) => `${name(value.name)}(${value.indices.map((index) => renderExpression(index, opts)).join(",")})`,
      functionRenderer: (value, opts) => {
        const fn = value.name.toUpperCase();
        if (fn === "__APPLE2_SEED") return `RND(-ABS(${renderExpression(value.args[0], opts)})-1)`;
        if (fn === builtinFunctions.code) return `ASC(${renderExpression(value.args[0], opts)})`;
        if (fn === builtinFunctions.freeMemory) return "(FRE(0)+65536*(FRE(0)<0))";
        if (fn === builtinFunctions.rnd) return "RND(1)";
        if (fn === builtinFunctions.screenCode) {
          const row = renderExpression(value.args[0], opts), column = renderExpression(value.args[1], opts);
          const offset = `(${row}-1)`;
          const address = `1024+(${offset}-INT(${offset}/8)*8)*128+INT(${offset}/8)*40+${column}-1`;
          const cell = `PEEK(${address})`;
          return `(${cell}-128*(${cell}>=128)+64*(${cell}<32))`;
        }
        if (functions.has(fn)) return `${fn}(${value.args.map((arg) => renderExpression(arg, opts)).join(",")})`;
        throw new DiagnosticError(value.location, `Apple II support for ${value.name} is not implemented.`);
      }
    };
    const expr = (value: Parameters<typeof renderExpression>[0]): string => renderExpression(value, options);
    const coordinate = (value: Parameters<typeof renderExpression>[0], axis: "row" | "column"): string => {
      validateConstantCoordinate(value, axis, axis === "row" ? 23 : 39, "Apple II");
      return expr(value);
    };
    const prefix = `${line} `;
    switch (instruction.kind) {
      case "label": return `${prefix}REM ${instruction.name.toUpperCase()}:`;
      case "rem": return `${prefix}REM ${instruction.text}`;
      case "cls": return `${prefix}HOME`;
      // The 40-column text screen is monochrome; colour requests cannot alter it.
      case "border-color": case "screen-background-color": case "text-color":
      case "cell-text-color": case "cell-background-color": case "paper":
      case "suppress-scroll-prompt": case "program-mode": return `${prefix}PRINT "";`;
      case "inverse-text": return `${prefix}${instruction.enabled ? "INVERSE" : "NORMAL"}`;
      case "print":
        if (instruction.inverted) throw new DiagnosticError(instruction.location, "Apple II inverted output is not implemented.");
        return `${prefix}${instruction.at ? `VTAB ${coordinate(instruction.at.row, "row")}:HTAB ${coordinate(instruction.at.column, "column")}:` : ""}PRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon, options)}`;
      case "set-position": return `${prefix}VTAB ${coordinate(instruction.row, "row")}:HTAB ${coordinate(instruction.column, "column")}`;
      case "set-column": return `${prefix}HTAB ${coordinate(instruction.column, "column")}`;
      case "let": return `${prefix}${name(instruction.name)}=${expr(instruction.expression)}`;
      case "multi-let": return `${prefix}${instruction.assignments.map((item) => `${name(item.name)}=${expr(item.expression)}`).join(":")}`;
      case "dim-array": return `${prefix}DIM ${name(instruction.name)}(${(isStringVariableName(instruction.name) ? instruction.dimensions.slice(0, -1) : instruction.dimensions).map((size) => size - 1).join(",")})`;
      case "dim-string": return `${prefix}PRINT "";`;
      case "array-let": return `${prefix}${name(instruction.name)}(${instruction.indices.map(expr).join(",")})=${expr(instruction.expression)}`;
      case "data": return `${prefix}DATA ${renderDataValues(instruction.values, options)}`;
      case "read": return `${prefix}READ ${instruction.targets.map(name).join(",")}`;
      case "input": return `${prefix}INPUT ${instruction.targets.map(name).join(",")}`;
      case "open-data-file":
        if (instruction.storage !== "disk") throw new DiagnosticError(instruction.location, "Apple II sequential files require DOS disk storage.");
        return `${prefix}PRINT CHR$(4);"OPEN ${instruction.filename}":PRINT CHR$(4);"${instruction.mode === "write" ? "WRITE" : "READ"} ${instruction.filename}"`;
      case "write-data-file": return `${prefix}PRINT ${expr(instruction.expression)}`;
      case "read-data-file": return `${prefix}INPUT ${expr(instruction.target)}`;
      case "close-data-file": return `${prefix}PRINT CHR$(4);"CLOSE"`;
      // The target's printer configuration uses a parallel card in slot 1.
      case "check-device": return `${prefix}${name(instruction.name)}=${instruction.device === "printer" || instruction.device === "text-printer" ? 1 : 0}`;
      case "open-device":
        if (instruction.device !== "printer" && instruction.device !== "text-printer") throw new DiagnosticError(instruction.location, `Apple II does not support the ${instruction.device} device.`);
        return `${prefix}PRINT "";`;
      case "close-device": return `${prefix}PRINT "";`;
      case "print-device": return `${prefix}PR#1:PRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon, options)}:PR#0`;
      case "read-key": return `${prefix}IF PEEK(49152)>127 THEN ${name(instruction.name)}=CHR$(PEEK(49152)-128):POKE 49168,0`;
      case "restore": return `${prefix}RESTORE`;
      case "goto": return `${prefix}GOTO ${resolveLabel(labels, instruction.label)}`;
      case "gosub": return `${prefix}GOSUB ${resolveLabel(labels, instruction.label)}`;
      case "return": return `${prefix}RETURN`;
      case "end": return `${prefix}END`;
      case "for": return `${prefix}FOR ${name(instruction.variable)}=${expr(instruction.start)} TO ${expr(instruction.limit)}${instruction.step ? ` STEP ${expr(instruction.step)}` : ""}`;
      case "next": return `${prefix}NEXT ${name(instruction.variable)}`;
      case "if-goto": return `${prefix}IF ${expr(instruction.condition)} THEN ${resolveLabel(labels, instruction.label)}`;
      case "if-gosub": return `${prefix}IF ${expr(instruction.condition)} THEN GOSUB ${resolveLabel(labels, instruction.label)}`;
      case "if-then": return `${prefix}IF ${expr(instruction.condition)} THEN ${instruction.body.map((item) => apple2Target.renderLine(line, item, labels, readability).slice(prefix.length)).join(":")}`;
      case "on-goto": case "on-gosub": return `${prefix}ON ${expr(instruction.expression)} ${instruction.kind === "on-goto" ? "GOTO" : "GOSUB"} ${instruction.labels.map((label) => resolveLabel(labels, label)).join(",")}`;
      case "poke": return `${prefix}POKE ${typeof instruction.address === "number" ? instruction.address : expr(instruction.address)},${expr(instruction.value)}`;
      case "print-chr": return `${prefix}PRINT CHR$(${instruction.code})${instruction.trailingSemicolon ? ";" : ""}`;
      default: throw new DiagnosticError(instruction.location, `Apple II support for ${instruction.kind} is not implemented.`);
    }
  }
};
