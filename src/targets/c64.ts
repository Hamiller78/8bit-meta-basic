import type { Expression } from "../ast.js";
import type { DeviceKind } from "../devices.js";
import { DiagnosticError } from "../diagnostics.js";
import { builtinFunctions } from "../functions.js";
import { resolveLabel } from "../line-numbering.js";
import type { ReadabilityLevel } from "../line-numbering.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { normalizeLabel } from "../lowering.js";
import { isIntegerVariableName, isStringVariableName } from "../variables.js";
import { createFunctionRenderer, type FunctionCallExpression } from "./function-rendering.js";
import { instructionExpressions } from "./instruction-expressions.js";
import { c64ColorCodes, expandPositionedPrints, rebuildLabels, renderDataValues, renderExpression, renderPrintItems, type TargetBackend } from "./target.js";

export const c64Target: TargetBackend = {
  id: "c64",
  gotoSpelling: "GOTO",
  maxLineLength: 80,
  maxLineNumber: 63999,
  lower(program: LoweredProgram, readability: ReadabilityLevel): LoweredProgram {
    const expanded = expandPositionedPrints(program, "C64", 24, 39, (instruction) => [
      { kind: "poke", address: 214, value: instruction.at!.row, location: instruction.location },
      { kind: "poke", address: 211, value: instruction.at!.column, location: instruction.location },
      { kind: "sys", address: 58732, location: instruction.location },
      { ...instruction, at: undefined }
    ]);
    const withScreenControls = expandScreenControls(expanded);
    const withDeviceChecks = expandDeviceAvailabilityChecks(withScreenControls);
    const withRs232Flush = expandRs232CloseFlush(withDeviceChecks);
    const withKeyboardInput = expandKeyboardInput(withRs232Flush);
    return withKeyboardInput;
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
        return `${lineNumber} PRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`;
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
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN GOTO ${resolveLabel(labelLines, instruction.label)}`;
      case "randomize":
        return instruction.seed ? `${lineNumber} ${renderVariableName("MBRND", variableMap)}=RND(-(${renderExpression(instruction.seed, renderOptions)}))` : `${lineNumber} ${renderVariableName("MBRND", variableMap)}=RND(0)`;
      case "position":
        throw new Error("Internal error: unexpected position instruction for C64.");
      case "poke":
        return `${lineNumber} POKE ${instruction.address},${renderExpression(instruction.value, renderOptions)}`;
      case "print-chr":
        return `${lineNumber} PRINT CHR$(${instruction.code})${instruction.trailingSemicolon ? ";" : ""}`;
      case "trap":
        throw new Error("Internal error: unexpected trap instruction for C64.");
      case "wait-rs232-transmit":
        return `${lineNumber} IF (PEEK(673) AND 1) THEN GOTO ${lineNumber}`;
      case "sys":
        return `${lineNumber} SYS ${instruction.address}`;
    }
  }
};

let currentProgramInstructions: readonly Instruction[] = [];

export function setC64RenderProgram(instructions: readonly Instruction[]): void {
  currentProgramInstructions = instructions;
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
    [builtinFunctions.left, renderC64Left],
    [builtinFunctions.len, renderC64Len],
    [builtinFunctions.mid, renderC64Mid],
    [builtinFunctions.rnd, () => "RND(1)"],
    [builtinFunctions.right, renderC64Right],
    [builtinFunctions.sgn, renderC64UnaryNumericFunction],
    [builtinFunctions.sin, renderC64UnaryNumericFunction],
    [builtinFunctions.sqr, renderC64UnaryNumericFunction],
    [builtinFunctions.str, renderC64Str],
    [builtinFunctions.val, renderC64Val]
  ])
);

function renderC64Function(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string | undefined {
  if (expression.name.toUpperCase() === "ASC") {
    return `ASC(${renderExpression(expression.args[0], options)})`;
  }

  return renderKnownC64Function(expression, options);
}

function renderC64Chr(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `CHR$(${renderExpression(expression.args[0], options)})`;
}

function renderC64Code(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `ASC(${renderExpression(expression.args[0], options)})`;
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
    if (
      instruction.kind === "let" ||
      instruction.kind === "array-let" ||
      instruction.kind === "dim-array" ||
      instruction.kind === "read-key" ||
      instruction.kind === "check-device" ||
      instruction.kind === "read" ||
      instruction.kind === "randomize" ||
      instruction.kind === "for" ||
      instruction.kind === "next"
    ) {
      const instructionNames = instruction.kind === "read" ? instruction.targets : [instruction.kind === "for" || instruction.kind === "next" ? instruction.variable : instruction.kind === "randomize" ? "MBRND" : instruction.name];
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
      instructions.push({
        kind: "poke",
        address: 808,
        value: {
          kind: "number",
          value: 234,
          raw: "234",
          location: instruction.location
        },
        location: instruction.location
      });
    } else {
      instructions.push(instruction);
    }
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
    } else if (instruction.kind === "read") {
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
