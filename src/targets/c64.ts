import type { Expression } from "../ast.js";
import type { DeviceKind } from "../devices.js";
import { DiagnosticError } from "../diagnostics.js";
import { builtinFunctions } from "../functions.js";
import { joystickControl } from "../joystick.js";
import { resolveLabel } from "../line-numbering.js";
import type { ReadabilityLevel } from "../line-numbering.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { normalizeLabel } from "../lowering.js";
import { isIntegerVariableName, isStringVariableName } from "../variables.js";
import { createFunctionRenderer, type FunctionCallExpression } from "./function-rendering.js";
import { instructionExpressions } from "./instruction-expressions.js";
import { packNumericStructFields } from "./struct-array-packing.js";
import { lowerByteStorage } from "./byte-storage.js";
import { createGeneratedVariableNameAllocator } from "./string-array-lengths.js";
import { c64ColorCodes, expandPositionedPrints, expandSetColumns, expandSetPositions, markInvertedPrintRuns, rebuildLabels, renderDataValues, renderExpression, renderInlineInstructionBodies, renderPrintItems, type TargetBackend } from "./target.js";
import { lowerSequentialFileIo } from "./file-io.js";

export const c64Target: TargetBackend = {
  id: "c64",
  gotoSpelling: "GOTO",
  maxLineLength: 80,
  maxLineNumber: 63999,
  variableMap: buildVariableMap,
  lower(program: LoweredProgram, readability: ReadabilityLevel): LoweredProgram {
    const fileIo = expandC64FileExistenceChecks(lowerSequentialFileIo(program));
    const byteLowered = lowerByteStorage(markInvertedPrintRuns(fileIo), "c64");
    const positions = expandSetPositions(byteLowered, "C64", 24, 39, (instruction) => [
      { kind: "poke", address: 214, value: instruction.row, location: instruction.location },
      { kind: "poke", address: 211, value: instruction.column, location: instruction.location },
      { kind: "sys", address: 58732, location: instruction.location }
    ]);
    const columns = expandSetColumns(positions, "C64", 39, (instruction) => [
      { kind: "poke", address: 211, value: instruction.column, location: instruction.location }
    ]);
    const expanded = expandPositionedPrints(columns, "C64", 24, 39, (instruction) => [
      { kind: "poke", address: 214, value: instruction.at!.row, location: instruction.location },
      { kind: "poke", address: 211, value: instruction.at!.column, location: instruction.location },
      { kind: "sys", address: 58732, location: instruction.location },
      { ...instruction, at: undefined }
    ]);
    const withScreenControls = expandScreenControls(expanded);
    const withDeviceChecks = expandDeviceAvailabilityChecks(withScreenControls);
    const withSafeTestRs232Open = hoistTestRs232Open(withDeviceChecks);
    const withRs232Flush = expandRs232CloseFlush(withSafeTestRs232Open);
    const withKeyboardInput = expandKeyboardInput(withRs232Flush);
    const withCompactNumericOutput = preserveCompoundC64PrintItems(withKeyboardInput);
    const safeDispatchInstructions = withCompactNumericOutput.instructions.flatMap((instruction) =>
      instruction.kind === "on-goto" || instruction.kind === "on-gosub"
        ? lowerSafeC64Dispatch(instruction)
        : [instruction]
    );
    return rebuildLabels(withCompactNumericOutput, packNumericStructFields(safeDispatchInstructions, true));
  },
  renderLine(lineNumber: number, instruction: Instruction, labelLines: ReadonlyMap<string, number>, readability: ReadabilityLevel): string {
    const variableMap = buildVariableMap(currentProgramInstructions, readability);
    const renderOptions = { variableMap, functionRenderer: renderC64Function, arrayRenderer: renderC64ArrayAccess };

    switch (instruction.kind) {
      case "label":
        return `${lineNumber} REM ${instruction.name.toUpperCase()}:`;
      case "rem":
        return `${lineNumber} REM ${instruction.text.toUpperCase()}`;
      case "cls":
      case "border-color":
      case "text-color":
      case "screen-background-color":
      case "cell-text-color":
      case "cell-background-color":
      case "suppress-scroll-prompt":
      case "program-mode":
      case "paper":
      case "setcolor":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for C64.`);
      case "print":
        return `${lineNumber} PRINT ${renderC64PrintItems(instruction, renderOptions)}`;
      case "inverse-text":
        throw new Error("Internal error: unexpected inverse-text instruction for C64.");
      case "set-column":
        throw new Error("Internal error: unexpected set-column instruction for C64.");
      case "set-position":
        throw new Error("Internal error: unexpected set-position instruction for C64.");
      case "open-device":
        rejectC64SharedDrive(instruction.device, instruction.location);
        if (instruction.handle === "__mb_probe") {
          return `${lineNumber} OPEN 15,4,15`;
        }
        if (instruction.device === "rs232") {
          return `${lineNumber} OPEN ${c64LogicalFileNumber(instruction.handle)},2,0,CHR$(10)`;
        }
        return `${lineNumber} OPEN ${c64LogicalFileNumber(instruction.handle)},4`;
      case "print-device":
        return `${lineNumber} PRINT#${c64LogicalFileNumber(instruction.handle)},${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`;
      case "close-device":
        return `${lineNumber} CLOSE ${c64LogicalFileNumber(instruction.handle)}`;
      case "check-device":
        rejectC64SharedDrive(instruction.device, instruction.location);
        return instruction.device === "rs232"
          ? appendInlineVariableComment(`${lineNumber} ${renderVariableName(instruction.name, variableMap)}=1`, instruction, variableMap, readability)
          : appendInlineVariableComment(`${lineNumber} ${renderVariableName(instruction.name, variableMap)}=-(ST=0)`, instruction, variableMap, readability);
      case "data":
        return `${lineNumber} DATA ${renderDataValues(instruction.values, renderOptions)}`;
      case "read":
        return `${lineNumber} READ ${instruction.targets.map((target) => renderVariableName(target, variableMap)).join(",")}`;
      case "input":
        return `${lineNumber} INPUT ${instruction.targets.map((target) => renderVariableName(target, variableMap)).join(",")}`;
      case "open-data-file":
        return `${lineNumber} OPEN 1,${instruction.storage === "tape" ? 1 : 8},${instruction.mode === "read" ? 0 : 1},"${instruction.storage === "disk" && instruction.mode === "write" ? "@0:" : ""}${instruction.filename}${instruction.storage === "disk" ? `,S,${instruction.mode === "read" ? "R" : "W"}` : ""}"`;
      case "write-data-file":
        return `${lineNumber} PRINT#1,${renderExpression(instruction.expression, renderOptions)}`;
      case "read-data-file":
        return `${lineNumber} INPUT#1,${renderExpression(instruction.target, renderOptions)}`;
      case "close-data-file":
        return `${lineNumber} CLOSE 1`;
      case "delete-data-file":
        return `${lineNumber} OPEN 15,8,15,"S0:${instruction.filename}":CLOSE 15`;
      case "read-data-file-status":
        return `${lineNumber} OPEN 15,8,15:INPUT#15,${renderVariableName(instruction.errorCodeName, variableMap)},${renderVariableName(instruction.errorMessageName, variableMap)},${renderVariableName(instruction.trackName, variableMap)},${renderVariableName(instruction.sectorName, variableMap)}:CLOSE 15`;
      case "check-data-file":
        throw new Error("Internal error: unexpected check-data-file instruction for C64.");
      case "save-file": case "load-file": case "delete-file": case "save-native-array": case "load-native-array":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for C64.`);
      case "restore":
        return `${lineNumber} RESTORE`;
      case "let":
        return appendInlineVariableComment(`${lineNumber} ${renderVariableName(instruction.name, variableMap)}=${renderExpression(instruction.expression, renderOptions)}`, instruction, variableMap, readability);
      case "multi-let":
        return `${lineNumber} ${instruction.assignments.map((assignment) => `${renderVariableName(assignment.name, variableMap)}=${renderExpression(assignment.expression, renderOptions)}`).join(":")}`;
      case "dim-array":
        return `${lineNumber} DIM ${renderVariableName(instruction.name, variableMap)}(${renderC64ArrayDimensions(instruction.name, instruction.dimensions).join(",")})`;
      case "array-let":
        return `${lineNumber} ${renderC64ArrayAccess({ kind: "array-access", name: instruction.name, indices: instruction.indices, location: instruction.location }, renderOptions)}=${renderExpression(instruction.expression, renderOptions)}`;
      case "read-key":
        return `${lineNumber} GET ${renderVariableName(instruction.name, variableMap)}`;
      case "dim-string":
        throw new Error("Internal error: unexpected dim-string instruction for C64.");
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
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN ${resolveLabel(labelLines, instruction.label)}`;
      case "if-gosub":
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN GOSUB ${resolveLabel(labelLines, instruction.label)}`;
      case "if-then":
        return instruction.body.length === 1 && instruction.body[0].kind === "goto"
          ? `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN ${resolveLabel(labelLines, instruction.body[0].label)}`
          : `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN ${renderInlineInstructionBodies(c64Target, lineNumber, instruction.body, labelLines, readability)}`;
      case "on-goto":
        return `${lineNumber} ON ${renderExpression(instruction.expression, renderOptions)} GOTO ${instruction.labels.map((label) => resolveLabel(labelLines, label)).join(",")}`;
      case "on-gosub":
        return `${lineNumber} ON ${renderExpression(instruction.expression, renderOptions)} GOSUB ${instruction.labels.map((label) => resolveLabel(labelLines, label)).join(",")}`;
      case "randomize":
        return instruction.seed ? `${lineNumber} ${renderVariableName("MBRND", variableMap)}=RND(-(${renderExpression(instruction.seed, renderOptions)}))` : `${lineNumber} ${renderVariableName("MBRND", variableMap)}=RND(-(TI+1))`;
      case "position":
        throw new Error("Internal error: unexpected position instruction for C64.");
      case "graphics-mode":
        throw new Error("Internal error: unexpected graphics-mode instruction for C64.");
      case "poke":
        return `${lineNumber} POKE ${typeof instruction.address === "number" ? instruction.address : renderExpression(instruction.address, renderOptions)},${renderExpression(instruction.value, renderOptions)}`;
      case "print-chr":
        return `${lineNumber} PRINT CHR$(${instruction.code})${instruction.trailingSemicolon ? ";" : ""}`;
      case "vdu":
        throw new Error("Internal error: unexpected vdu instruction for C64.");
      case "trap":
        throw new Error("Internal error: unexpected trap instruction for C64.");
      case "wait-rs232-transmit":
        return `${lineNumber} IF (PEEK(673) AND 1) THEN GOTO ${lineNumber}`;
      case "sys":
        return `${lineNumber} SYS ${instruction.address}`;
    }
  }
};

function hoistTestRs232Open(program: LoweredProgram): LoweredProgram {
  const index = program.instructions.findIndex(
    instruction => instruction.kind === "open-device" && instruction.handle.toUpperCase() === "MBTPR" && instruction.device === "rs232"
  );
  if (index < 1) {
    return program;
  }

  // Opening C64 RS-232 moves BASIC's memory boundary and clears existing arrays.
  const instructions = [...program.instructions];
  const [open] = instructions.splice(index, 1);
  instructions.unshift(open);
  return rebuildLabels(program, instructions);
}

let currentProgramInstructions: readonly Instruction[] = [];

export function setC64RenderProgram(instructions: readonly Instruction[]): void {
  currentProgramInstructions = instructions;
}

function lowerSafeC64Dispatch(instruction: Extract<Instruction, { kind: "on-goto" | "on-gosub" }>): Instruction[] {
  const location = instruction.location;
  const cases = instruction.labels
    .map((label, index) => ({ label, index: index + 1 }))
    .filter(({ label }) => normalizeLabel(label) !== normalizeLabel(instruction.fallbackLabel));

  return cases.map((entry) => ({
    kind: instruction.kind === "on-goto" ? "if-goto" : "if-gosub",
    condition: {
      kind: "binary",
      operator: "=",
      left: instruction.expression,
      right: { kind: "number", value: entry.index, raw: String(entry.index), location },
      location
    },
    label: entry.label,
    location
  }));
}

function c64LogicalFileNumber(handle: string): number {
  if (handle === "__mb_probe") {
    return 15;
  }
  return 1 + deviceHandleIndex(handle);
}

function deviceHandleIndex(handle: string): number {
  const handles: string[] = [];
  const seen = new Set<string>();
  for (const instruction of currentProgramInstructions) {
    if (instruction.kind !== "open-device" || instruction.handle === "__mb_probe") {
      continue;
    }
    const key = instruction.handle.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      handles.push(key);
    }
  }
  return Math.max(0, handles.indexOf(handle.toLowerCase()));
}

function expandDeviceAvailabilityChecks(program: LoweredProgram): LoweredProgram {
  const instructions: Instruction[] = [];

  for (const instruction of program.instructions) {
    if (instruction.kind === "check-device" && (instruction.device === "printer" || instruction.device === "text-printer")) {
      instructions.push({ kind: "open-device", handle: "__mb_probe", device: instruction.device, location: instruction.location });
      instructions.push({ kind: "close-device", handle: "__mb_probe", location: instruction.location });
      instructions.push(instruction);
    } else {
      instructions.push(instruction);
    }
  }

  return rebuildLabels(program, instructions);
}

function expandRs232CloseFlush(program: LoweredProgram): LoweredProgram {
  const openDevices = new Map<string, DeviceKind>();
  const instructions: Instruction[] = [];

  for (const instruction of program.instructions) {
    if (instruction.kind === "open-device") {
      openDevices.set(instruction.handle.toLowerCase(), instruction.device);
      instructions.push(instruction);
      continue;
    }
    if (instruction.kind === "close-device" && openDevices.get(instruction.handle.toLowerCase()) === "rs232") {
      instructions.push({ kind: "wait-rs232-transmit", location: instruction.location });
      instructions.push(instruction);
      continue;
    }
    instructions.push(instruction);
  }

  return rebuildLabels(program, instructions);
}

function rejectC64SharedDrive(device: DeviceKind, location: Expression["location"]): void {
  if (device === "shared-drive") {
    throw new DiagnosticError(location, "SHARED_DRIVE is currently supported only by the Atari 800XL target.");
  }
}

const renderKnownC64Function = createFunctionRenderer(
  new Map([
    [builtinFunctions.abs, renderC64UnaryNumericFunction],
    [builtinFunctions.asc, renderC64Code],
    [builtinFunctions.atn, renderC64UnaryNumericFunction],
    [builtinFunctions.chr, renderC64Chr],
    [builtinFunctions.code, renderC64Code],
    [builtinFunctions.cos, renderC64UnaryNumericFunction],
    [builtinFunctions.exp, renderC64UnaryNumericFunction],
    [builtinFunctions.freeMemory, () => "FRE(0) - (FRE(0) < 0) * 65536"],
    [builtinFunctions.int, renderC64UnaryNumericFunction],
    [builtinFunctions.jiffies, () => "TI"],
    [builtinFunctions.keyPressed, () => "(PEEK(198) > 0)"],
    [builtinFunctions.getJoystick, expression => [
      "((PEEK(56320) AND 4) / 4 - (PEEK(56320) AND 8) / 8)",
      "((PEEK(56320) AND 1) - (PEEK(56320) AND 2) / 2)",
      "(1 - (PEEK(56320) AND 16) / 16)"
    ][joystickControl(expression.args[0])]],
    [builtinFunctions.left, renderC64Left],
    [builtinFunctions.len, renderC64Len],
    [builtinFunctions.mid, renderC64Mid],
    [builtinFunctions.rnd, () => "RND(1)"],
    [builtinFunctions.right, renderC64Right],
    [builtinFunctions.screenCode, renderC64ScreenCode],
    [builtinFunctions.sgn, renderC64UnaryNumericFunction],
    [builtinFunctions.sin, renderC64UnaryNumericFunction],
    [builtinFunctions.sqr, renderC64UnaryNumericFunction],
    [builtinFunctions.str, renderC64Str],
    [builtinFunctions.val, renderC64Val]
  ])
);

function renderC64Function(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string | undefined {
  if (expression.name === c64CompactNumberFunction) {
    const rendered = renderExpression(expression.args[0], options);
    return `MID$(STR$(${rendered}),1-(${rendered}>=0))`;
  }
  if (expression.name.toUpperCase() === "ASC") {
    return `ASC(${renderExpression(expression.args[0], options)})`;
  }

  return renderKnownC64Function(expression, options);
}

function renderC64PrintItems(
  instruction: Extract<Instruction, { kind: "print" }>,
  options: { readonly variableMap?: ReadonlyMap<string, string>; readonly functionRenderer: typeof renderC64Function; readonly arrayRenderer: typeof renderC64ArrayAccess }
): string {
  const items = [
    ...(instruction.inverseStart ? ['"{rvon}"'] : []),
    ...instruction.items.map((item) => renderExpression(item, options)),
    ...(instruction.inverseEnd ? ['"{rvof}"'] : [])
  ];
  const rendered = items.join(";");
  return instruction.trailingSemicolon ? `${rendered};` : rendered;
}

const c64CompactNumberFunction = "__C64_COMPACT_NUMBER$";

function c64ExpressionValueType(expression: Expression): "number" | "string" {
  switch (expression.kind) {
    case "string":
      return "string";
    case "identifier":
      return isStringVariableName(expression.name) ? "string" : "number";
    case "array-access":
    case "function-call":
      return expression.valueType === "string" || isStringVariableName(expression.name) ? "string" : "number";
    case "struct-field-access":
      return expression.valueType === "string" || isStringVariableName(expression.field) ? "string" : "number";
    case "parenthesized":
      return c64ExpressionValueType(expression.expression);
    case "binary":
      return expression.operator === "+" && (c64ExpressionValueType(expression.left) === "string" || c64ExpressionValueType(expression.right) === "string")
        ? "string"
        : "number";
    case "number":
    case "boolean":
    case "color":
    case "unary":
      return "number";
  }
}

function preserveCompoundC64PrintItems(program: LoweredProgram): LoweredProgram {
  const allocateNumericTempName = createGeneratedVariableNameAllocator(program.instructions, "MBPRINT");
  let numericTempName: string | undefined;
  const getNumericTempName = (): string => numericTempName ??= allocateNumericTempName();
  const instructions: Instruction[] = [];

  for (const instruction of program.instructions) {
    if (instruction.kind !== "print" && instruction.kind !== "print-device") {
      instructions.push(instruction);
      continue;
    }

    const shouldCompact = (item: Expression, index: number): boolean =>
      index > 0 && c64ExpressionValueType(item) === "number" && c64ExpressionValueType(instruction.items[index - 1]) === "string";
    if (!instruction.items.some(shouldCompact)) {
      instructions.push(instruction);
      continue;
    }

    let group: Expression[] = [];
    let firstGroup = true;
    const flush = (trailingSemicolon: boolean): void => {
      if (group.length === 0) return;
      instructions.push({
        ...instruction,
        items: group,
        trailingSemicolon,
        ...(instruction.kind === "print"
          ? {
              inverseStart: firstGroup ? instruction.inverseStart : undefined,
              inverseEnd: trailingSemicolon ? undefined : instruction.inverseEnd
            }
          : {})
      });
      group = [];
      firstGroup = false;
    };

    instruction.items.forEach((item, index) => {
      const compactNumeric = shouldCompact(item, index);
      let outputItem = item;
      if (compactNumeric && !isSimpleC64PrintExpression(item)) {
        flush(true);
        const name = getNumericTempName();
        instructions.push({ kind: "let", name, expression: item, location: item.location });
        outputItem = { kind: "identifier", name, valueType: "number", location: item.location };
      }
      group.push(compactNumeric ? compactC64NumericExpression(outputItem) : outputItem);

      if (compactNumeric) {
        flush(index === instruction.items.length - 1 ? instruction.trailingSemicolon : true);
      }
    });
    flush(instruction.trailingSemicolon);
  }

  return rebuildLabels(program, instructions);
}

function compactC64NumericExpression(expression: Expression): Expression {
  if (expression.kind === "number") {
    return { kind: "string", value: expression.value.toString(), location: expression.location };
  }
  if (expression.kind === "boolean") {
    return { kind: "string", value: expression.value ? "-1" : "0", location: expression.location };
  }
  return {
    kind: "function-call",
    name: c64CompactNumberFunction,
    args: [expression],
    valueType: "string",
    location: expression.location
  };
}

function isSimpleC64PrintExpression(expression: Expression): boolean {
  return expression.kind === "number" || expression.kind === "boolean" || expression.kind === "identifier" || expression.kind === "array-access";
}

function renderC64Chr(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `CHR$(${renderExpression(expression.args[0], options)})`;
}

function renderC64Code(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `ASC(${renderExpression(expression.args[0], options)})`;
}

function renderC64ScreenCode(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  const [row, column] = expression.args;
  const cell = `PEEK(983 + ${renderExpression(row, options)} * 40 + ${renderExpression(column, options)})`;
  return `(${cell} - 64 * (${cell} < 32))`;
}

function renderC64Str(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `STR$(${renderExpression(expression.args[0], options)})`;
}

function renderC64Val(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `VAL(${renderExpression(expression.args[0], options)})`;
}

function renderC64UnaryNumericFunction(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `${expression.name.toUpperCase()}(${renderExpression(expression.args[0], options)})`;
}

function renderC64Len(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `LEN(${renderExpression(expression.args[0], options)})`;
}

function renderC64Mid(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `MID$(${expression.args.map((arg) => renderExpression(arg, options)).join(",")})`;
}

function renderC64Left(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `LEFT$(${expression.args.map((arg) => renderExpression(arg, options)).join(",")})`;
}

function renderC64Right(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `RIGHT$(${expression.args.map((arg) => renderExpression(arg, options)).join(",")})`;
}

function renderC64ArrayAccess(
  expression: Extract<Expression, { kind: "array-access" }>,
  options: { readonly variableMap?: ReadonlyMap<string, string>; readonly functionRenderer?: typeof renderC64Function; readonly arrayRenderer?: typeof renderC64ArrayAccess }
): string {
  return `${renderVariableName(expression.name, options.variableMap ?? new Map())}(${expression.indices.map((index) => renderExpression(index, options)).join(",")})`;
}

function renderC64ArrayDimension(dimension: number): string {
  return (dimension - 1).toString();
}

function renderC64ArrayDimensions(name: string, dimensions: readonly number[]): readonly string[] {
  const targetDimensions = isStringVariableName(name) ? dimensions.slice(0, -1) : dimensions;
  return targetDimensions.map(renderC64ArrayDimension);
}

function buildVariableMap(instructions: readonly Instruction[], readability: ReadabilityLevel): ReadonlyMap<string, string> {
  const names: string[] = [];
  const seen = new Set<string>();
  const preferredSourceNames = new Map<string, string>();

  const addName = (name: string, sourceName?: string): void => {
    const lower = name.toLowerCase();
    if (sourceName && !preferredSourceNames.has(lower)) {
      preferredSourceNames.set(lower, sourceName);
    }
    if (!seen.has(lower)) {
      seen.add(lower);
      names.push(name);
    }
  };

  for (const instruction of instructions) {
    if (instruction.kind === "multi-let") {
      for (const assignment of instruction.assignments) {
        addName(assignment.name);
      }
    } else if (
      instruction.kind === "let" ||
      instruction.kind === "array-let" ||
      instruction.kind === "dim-array" ||
      instruction.kind === "read-key" ||
      instruction.kind === "check-device" ||
      instruction.kind === "read-data-file-status" ||
      instruction.kind === "read" ||
      instruction.kind === "input" ||
      instruction.kind === "randomize" ||
      instruction.kind === "for" ||
      instruction.kind === "next"
    ) {
      const instructionNames = instruction.kind === "read" || instruction.kind === "input"
        ? instruction.targets
        : instruction.kind === "read-data-file-status"
          ? [instruction.errorCodeName, instruction.errorMessageName, instruction.trackName, instruction.sectorName]
          : [instruction.kind === "for" || instruction.kind === "next" ? instruction.variable : instruction.kind === "randomize" ? "MBRND" : instruction.name];
      for (const name of instructionNames) {
        addName(name, instruction.kind === "let" || instruction.kind === "check-device" ? instruction.sourceName : undefined);
      }
    }
    for (const expression of instructionExpressions(instruction)) {
      collectIdentifiers(expression, names, seen);
    }
  }

  const map = new Map<string, string>();
  const allocated = new Set<string>();

  let next = 0;
  for (const name of names) {
    const lower = name.toLowerCase();
    if (map.has(lower)) {
      continue;
    }

    const preferred = preferredVariableName(preferredSourceNames.get(lower) ?? name, name);
    const candidate = preferred && canAllocate(preferred, allocated) ? preferred : nextGeneratedVariableName(name, allocated, () => next++);
    map.set(lower, candidate);
    allocated.add(significantName(candidate));
  }

  return map;
}

function renderVariableName(name: string, variableMap: ReadonlyMap<string, string>): string {
  return variableMap.get(name.toLowerCase()) ?? name.toUpperCase();
}

function collectIdentifiers(expression: Expression, names: string[], seen: Set<string>): void {
  switch (expression.kind) {
    case "identifier":
      if (!seen.has(expression.name.toLowerCase())) {
        seen.add(expression.name.toLowerCase());
        names.push(expression.name);
      }
      break;
    case "parenthesized":
      collectIdentifiers(expression.expression, names, seen);
      break;
    case "unary":
      collectIdentifiers(expression.operand, names, seen);
      break;
    case "binary":
      collectIdentifiers(expression.left, names, seen);
      collectIdentifiers(expression.right, names, seen);
      break;
    case "function-call":
      for (const arg of expression.args) {
        collectIdentifiers(arg, names, seen);
      }
      break;
    case "array-access":
      if (!seen.has(expression.name.toLowerCase())) {
        seen.add(expression.name.toLowerCase());
        names.push(expression.name);
      }
      for (const index of expression.indices) {
        collectIdentifiers(index, names, seen);
      }
      break;
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
}

function significantName(name: string): string {
  const suffix = variableTypeSuffix(name);
  const base = name.toUpperCase().replaceAll(/[^A-Z0-9]/g, "").slice(0, 2).padEnd(2, "_");
  return `${base}${suffix}`;
}

const reservedNames = new Set(["TO", "IF", "GO", "ON", "OR", "AN", "NO", "PR", "PO", "SY", "RE", "ST", "TH", "TI"]);

const c64TokenSubstrings = [
  "END",
  "FOR",
  "NEXT",
  "DATA",
  "INPUT",
  "DIM",
  "READ",
  "LET",
  "GOTO",
  "RUN",
  "IF",
  "RESTORE",
  "GOSUB",
  "RETURN",
  "REM",
  "STOP",
  "ON",
  "WAIT",
  "LOAD",
  "SAVE",
  "VERIFY",
  "DEF",
  "POKE",
  "PRINT",
  "CONT",
  "LIST",
  "CLR",
  "CMD",
  "SYS",
  "OPEN",
  "CLOSE",
  "GET",
  "NEW",
  "TAB",
  "TO",
  "FN",
  "SPC",
  "THEN",
  "NOT",
  "STEP",
  "AND",
  "OR",
  "SGN",
  "INT",
  "ABS",
  "USR",
  "FRE",
  "POS",
  "SQR",
  "RND",
  "LOG",
  "EXP",
  "COS",
  "SIN",
  "TAN",
  "ATN",
  "PEEK",
  "LEN",
  "STR",
  "VAL",
  "ASC",
  "CHR",
  "LEFT",
  "RIGHT",
  "MID",
  "GO",
  "TI",
  "ST"
];

function preferredVariableName(sourceName: string, storageName = sourceName): string | undefined {
  const clean = cleanC64VariableName(sourceName);
  if (clean.length === 0) {
    return undefined;
  }

  return `${clean.slice(0, 2)}${variableTypeSuffix(storageName)}`;
}

function nextGeneratedVariableName(name: string, allocated: ReadonlySet<string>, next: () => number): string {
  while (true) {
    const candidate = `${generatedVariableStem(next())}${variableTypeSuffix(name)}`;
    if (canAllocate(candidate, allocated)) {
      return candidate;
    }
  }
}

function generatedVariableStem(index: number): string {
  const secondChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (index < secondChars.length) {
    return `V${secondChars[index]}`;
  }

  const firstChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const adjusted = index - secondChars.length;
  const first = firstChars[Math.floor(adjusted / secondChars.length) % firstChars.length];
  const second = secondChars[adjusted % secondChars.length];
  return `${first}${second}`;
}

function canAllocate(name: string, allocated: ReadonlySet<string>): boolean {
  const key = significantName(name);
  return !allocated.has(key) && !reservedNames.has(key.slice(0, 2)) && !containsC64TokenSubstring(cleanC64VariableName(name));
}

function cleanC64VariableName(name: string): string {
  return name.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
}

function containsC64TokenSubstring(cleanName: string): boolean {
  return c64TokenSubstrings.some((token) => cleanName.includes(token));
}

function variableTypeSuffix(name: string): "" | "$" | "%" {
  if (isStringVariableName(name)) {
    return "$";
  }
  if (isIntegerVariableName(name)) {
    return "%";
  }
  return "";
}

function appendInlineVariableComment(
  line: string,
  instruction: Extract<Instruction, { kind: "let" | "check-device" }>,
  variableMap: ReadonlyMap<string, string>,
  readability: ReadabilityLevel
): string {
  if (readability === 0 || !instruction.sourceName || !isFirstSourceAssignment(instruction)) {
    return line;
  }

  const renderedName = renderVariableName(instruction.name, variableMap);
  const sourceName = instruction.sourceName.toUpperCase();
  return renderedName === sourceName ? line : `${line}: REM ${sourceName}`;
}

function isFirstSourceAssignment(instruction: Extract<Instruction, { kind: "let" | "check-device" }>): boolean {
  for (const candidate of currentProgramInstructions) {
    if ((candidate.kind === "let" || candidate.kind === "check-device") && candidate.sourceName) {
      if (candidate === instruction) {
        return true;
      }
      if (candidate.sourceName.toLowerCase() === instruction.sourceName?.toLowerCase()) {
        return false;
      }
    }
  }
  return false;
}

function expandScreenControls(program: LoweredProgram): LoweredProgram {
  const instructions: Instruction[] = [];

  for (const instruction of program.instructions) {
    if (instruction.kind === "cls") {
      if (instruction.color) {
        instructions.push({
          kind: "poke",
          address: 53281,
          value: { kind: "number", value: c64ColorCodes[instruction.color.color], raw: c64ColorCodes[instruction.color.color].toString(), location: instruction.location },
          location: instruction.location
        });
      }
      instructions.push({ kind: "print-chr", code: 147, trailingSemicolon: true, location: instruction.location });
    } else if (instruction.kind === "border-color") {
        instructions.push({
          kind: "poke",
          address: 53280,
          value: {
          kind: "number",
          value: c64ColorCodes[instruction.color.color],
          raw: c64ColorCodes[instruction.color.color].toString(),
          location: instruction.location
        },
        location: instruction.location
      });
    } else if (instruction.kind === "screen-background-color") {
      instructions.push({
        kind: "poke",
        address: 53281,
        value: {
          kind: "number",
          value: c64ColorCodes[instruction.color.color],
          raw: c64ColorCodes[instruction.color.color].toString(),
          location: instruction.location
        },
        location: instruction.location
      });
    } else if (instruction.kind === "text-color" || instruction.kind === "cell-text-color") {
      instructions.push({
        kind: "poke",
        address: 646,
        value: {
          kind: "number",
          value: c64ColorCodes[instruction.color.color],
          raw: c64ColorCodes[instruction.color.color].toString(),
          location: instruction.location
        },
        location: instruction.location
      });
    } else if (instruction.kind === "cell-background-color" || instruction.kind === "suppress-scroll-prompt") {
      continue;
    } else if (instruction.kind === "program-mode") {
      // $02ED-$02EF is free page-2 RAM. Install LDA #$01; RTS there before
      // redirecting STOP. The standard vector already has low byte $ED, so
      // one high-byte POKE activates it without a transient unsafe address.
      // The routine returns Z=0 and preserves Y for LIST.
      for (const [address, value] of [[749, 169], [750, 1], [751, 96], [809, 2]]) {
        instructions.push({
          kind: "poke",
          address,
          value: {
            kind: "number",
            value,
            raw: value.toString(),
            location: instruction.location
          },
          location: instruction.location
        });
      }
    } else {
      instructions.push(instruction);
    }
  }

  return rebuildLabels(program, instructions);
}

function expandC64FileExistenceChecks(program: LoweredProgram): LoweredProgram {
  const instructions: Instruction[] = [];
  for (const instruction of program.instructions) {
    if (instruction.kind !== "check-data-file") {
      instructions.push(instruction);
      continue;
    }
    const location = instruction.location;
    instructions.push(
      { kind: "open-data-file", mode: "read", filename: instruction.filename, storage: "disk", location },
      {
        kind: "read-data-file-status",
        errorCodeName: instruction.errorCodeName,
        errorMessageName: instruction.errorMessageName,
        trackName: instruction.trackName,
        sectorName: instruction.sectorName,
        location
      },
      { kind: "close-data-file", location },
      {
        kind: "let",
        name: instruction.name,
        sourceName: instruction.sourceName,
        expression: {
          kind: "function-call",
          name: builtinFunctions.abs,
          args: [{
            kind: "binary",
            operator: "=",
            left: { kind: "identifier", name: instruction.errorCodeName, location },
            right: { kind: "number", value: 0, raw: "0", location },
            location
          }],
          valueType: "number",
          location
        },
        location
      }
    );
  }
  return rebuildLabels(program, instructions);
}

function expandKeyboardInput(program: LoweredProgram): LoweredProgram {
  const allocateInternalLabel = createInternalLabelAllocator(program);
  const keyStringTempName = allocateKeyStringTempName(program.instructions);
  const instructions: Instruction[] = [];

  for (const instruction of program.instructions) {
    if (isKeyCodeAssignment(instruction)) {
      const assignment = instruction as Extract<Instruction, { kind: "let" }>;
      instructions.push(...expandC64KeyCodeAssignment(assignment, keyStringTempName, allocateInternalLabel));
    } else {
      instructions.push(instruction);
    }
  }

  return rebuildLabels(program, instructions);
}

function expandC64KeyCodeAssignment(
  instruction: Extract<Instruction, { kind: "let" }>,
  keyStringTempName: string,
  allocateInternalLabel: () => string
): readonly Instruction[] {
  const gotKeyLabel = allocateInternalLabel();
  const endLabel = allocateInternalLabel();
  const keyStringIdentifier: Expression = { kind: "identifier", name: keyStringTempName, location: instruction.location };

  return [
    { kind: "read-key", name: keyStringTempName, location: instruction.location },
    { ...instruction, expression: { kind: "number", value: 0, raw: "0", location: instruction.location } },
    {
      kind: "if-goto",
      condition: {
        kind: "binary",
        operator: "<>",
        left: keyStringIdentifier,
        right: { kind: "string", value: "", location: instruction.location },
        location: instruction.location
      },
      label: gotKeyLabel,
      location: instruction.location
    },
    { kind: "goto", label: endLabel, location: instruction.location },
    { kind: "label", name: gotKeyLabel, internal: true, location: instruction.location },
    {
      ...instruction,
      expression: { kind: "function-call", name: "ASC", args: [keyStringIdentifier], location: instruction.location }
    },
    { kind: "label", name: endLabel, internal: true, location: instruction.location }
  ];
}

function isKeyCodeAssignment(instruction: Instruction): boolean {
  return (
    instruction.kind === "let" &&
    !isStringVariableName(instruction.name) &&
    instruction.expression.kind === "function-call" &&
    instruction.expression.name === builtinFunctions.keyCode
  );
}

function createInternalLabelAllocator(program: LoweredProgram): () => string {
  const used = new Set(program.labels.keys());
  let next = 1;

  return () => {
    while (true) {
      const candidate = `__mb_key_${next}`;
      next += 1;
      if (!used.has(normalizeLabel(candidate))) {
        used.add(normalizeLabel(candidate));
        return candidate;
      }
    }
  };
}

function allocateKeyStringTempName(instructions: readonly Instruction[]): string {
  const used = new Set<string>();
  for (const instruction of instructions) {
    if (instruction.kind === "let" || instruction.kind === "read-key" || instruction.kind === "dim-string") {
      used.add(instruction.name.toLowerCase());
    } else if (instruction.kind === "read" || instruction.kind === "input") {
      for (const target of instruction.targets) {
        used.add(target.toLowerCase());
      }
    } else if (instruction.kind === "for" || instruction.kind === "next") {
      used.add(instruction.variable.toLowerCase());
    }
    for (const expression of instructionExpressions(instruction)) {
      collectUsedExpressionNames(expression, used);
    }
  }

  let next = 0;
  while (true) {
    const candidate = next === 0 ? "MBKEY$" : `MBKEY${next}$`;
    next += 1;
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

function collectUsedExpressionNames(expression: Expression, used: Set<string>): void {
  switch (expression.kind) {
    case "identifier":
      used.add(expression.name.toLowerCase());
      break;
    case "parenthesized":
      collectUsedExpressionNames(expression.expression, used);
      break;
    case "unary":
      collectUsedExpressionNames(expression.operand, used);
      break;
    case "binary":
      collectUsedExpressionNames(expression.left, used);
      collectUsedExpressionNames(expression.right, used);
      break;
    case "function-call":
      for (const arg of expression.args) {
        collectUsedExpressionNames(arg, used);
      }
      break;
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
}
