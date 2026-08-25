import type { Expression } from "../ast.js";
import type { DeviceKind } from "../devices.js";
import { DiagnosticError } from "../diagnostics.js";
import { builtinFunctions } from "../functions.js";
import { resolveLabel } from "../line-numbering.js";
import type { ReadabilityLevel } from "../line-numbering.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { normalizeLabel } from "../lowering.js";
import { baseVariableName, isIntegerVariableName, isStringVariableName } from "../variables.js";
import { createFunctionRenderer, type FunctionCallExpression } from "./function-rendering.js";
import { instructionExpressions } from "./instruction-expressions.js";
import { expandPositionedPrints, rebuildLabels, renderDataValues, renderExpression, renderPrintItems, spectrumColorCodes, type TargetBackend } from "./target.js";

export const spectrumTarget: TargetBackend = {
  id: "spectrum",
  gotoSpelling: "GO TO",
  maxLineLength: 640,
  maxLineNumber: 9999,
  lower(program: LoweredProgram, _readability: ReadabilityLevel): LoweredProgram {
    const expanded = expandPositionedPrints(program, "Spectrum", 21, 31, (instruction) => [instruction]);
    const allocateInternalLabel = createInternalLabelAllocator(expanded);
    const keyStringTempName = allocateKeyStringTempName(expanded.instructions);
    const instructions: Instruction[] = [];
    for (const instruction of expanded.instructions) {
      if (instruction.kind === "cls" && instruction.color) {
        instructions.push({ kind: "paper", color: instruction.color, location: instruction.location });
        instructions.push({ ...instruction, color: undefined });
      } else if (isKeyCodeAssignment(instruction)) {
        const assignment = instruction as Extract<Instruction, { kind: "let" }>;
        instructions.push(...expandSpectrumKeyCodeAssignment(assignment, keyStringTempName, allocateInternalLabel));
      } else {
        instructions.push(instruction);
      }
    }
    return rebuildLabels(expanded, instructions);
  },
  renderLine(lineNumber: number, instruction: Instruction, labelLines: ReadonlyMap<string, number>, _readability: ReadabilityLevel): string {
    const variableMap = buildUppercaseVariableMap(currentProgramInstructions);
    const stringArrayWidths = buildSpectrumStringArrayWidths(currentProgramInstructions);
    const renderOptions = { variableMap, functionRenderer: renderSpectrumFunction, arrayRenderer: renderSpectrumArrayAccess, stringArrayWidths };

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
      case "screen-background-color":
      case "cell-background-color":
        return `${lineNumber} PAPER ${spectrumColorCodes[instruction.color.color]}`;
      case "text-color":
      case "cell-text-color":
        return `${lineNumber} INK ${spectrumColorCodes[instruction.color.color]}`;
      case "suppress-scroll-prompt":
        return `${lineNumber} POKE 23692,255`;
      case "print":
        return instruction.at
          ? `${lineNumber} PRINT AT ${renderExpression(instruction.at.row, renderOptions)},${renderExpression(instruction.at.column, renderOptions)};${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`
          : `${lineNumber} PRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`;
      case "open-device":
        rejectSpectrumSharedDrive(instruction.device, instruction.location);
        if (instruction.device === "text-printer") {
          return `${lineNumber} REM OPEN TEXT_PRINTER`;
        }
        return `${lineNumber} OPEN #${spectrumStreamNumber(instruction.handle, instruction.location)},"${spectrumChannelName(instruction.device)}"`;
      case "print-device":
        if (deviceForHandle(instruction.handle) === "text-printer") {
          return `${lineNumber} LPRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`;
        }
        return `${lineNumber} PRINT #${spectrumStreamNumber(instruction.handle, instruction.location)};${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`;
      case "close-device":
        if (deviceForHandle(instruction.handle) === "text-printer") {
          return `${lineNumber} REM CLOSE TEXT_PRINTER`;
        }
        return `${lineNumber} CLOSE #${spectrumStreamNumber(instruction.handle, instruction.location)}`;
      case "check-device":
        rejectSpectrumSharedDrive(instruction.device, instruction.location);
        return `${lineNumber} LET ${variableMap.get(instruction.name.toLowerCase()) ?? instruction.name.toUpperCase()}=1`;
      case "data":
        return `${lineNumber} DATA ${renderDataValues(instruction.values, renderOptions)}`;
      case "read":
        return `${lineNumber} READ ${instruction.targets.map((target) => variableMap.get(target.toLowerCase()) ?? target.toUpperCase()).join(",")}`;
      case "restore":
        return `${lineNumber} RESTORE`;
      case "let":
        return `${lineNumber} LET ${variableMap.get(instruction.name.toLowerCase()) ?? instruction.name.toUpperCase()}=${renderExpression(instruction.expression, renderOptions)}`;
      case "multi-let":
        return `${lineNumber} ${instruction.assignments.map((assignment) => `LET ${variableMap.get(assignment.name.toLowerCase()) ?? assignment.name.toUpperCase()}=${renderExpression(assignment.expression, renderOptions)}`).join(":")}`;
      case "dim-array":
        return `${lineNumber} DIM ${renderSpectrumArrayName(instruction.name, variableMap)}(${instruction.dimensions.join(",")})`;
      case "array-let":
        return `${lineNumber} LET ${renderSpectrumArrayAssignmentTarget(instruction.name, instruction.indices, renderOptions)}=${renderExpression(instruction.expression, renderOptions)}`;
      case "goto":
        return `${lineNumber} GO TO ${resolveLabel(labelLines, instruction.label)}`;
      case "gosub":
        return `${lineNumber} GO SUB ${resolveLabel(labelLines, instruction.label)}`;
      case "return":
        return `${lineNumber} RETURN`;
      case "end":
        return `${lineNumber} STOP`;
      case "for":
        return `${lineNumber} FOR ${variableMap.get(instruction.variable.toLowerCase()) ?? instruction.variable.toUpperCase()}=${renderExpression(instruction.start, renderOptions)} TO ${renderExpression(instruction.limit, renderOptions)}${instruction.step ? ` STEP ${renderExpression(instruction.step, renderOptions)}` : ""}`;
      case "next":
        return `${lineNumber} NEXT ${variableMap.get(instruction.variable.toLowerCase()) ?? instruction.variable.toUpperCase()}`;
      case "if-goto":
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN GO TO ${resolveLabel(labelLines, instruction.label)}`;
      case "randomize":
        return instruction.seed ? `${lineNumber} RANDOMIZE ${renderExpression(instruction.seed, renderOptions)}` : `${lineNumber} RANDOMIZE`;
      case "position":
      case "setcolor":
      case "poke":
      case "print-chr":
      case "dim-string":
      case "read-key":
      case "trap":
      case "wait-rs232-transmit":
      case "sys":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for Spectrum.`);
    }
  }
};

let currentProgramInstructions: readonly Instruction[] = [];

export function setSpectrumRenderProgram(instructions: readonly Instruction[]): void {
  currentProgramInstructions = instructions;
}

function spectrumStreamNumber(handle: string, location: Expression["location"]): number {
  const index = deviceHandleIndex(handle);
  const stream = 4 + index;
  if (stream > 15) {
    throw new Error(`${location.filename}:${location.line}: Spectrum supports only 12 Meta-BASIC device handles at once.`);
  }
  return stream;
}

function spectrumChannelName(device: DeviceKind): "P" | "t" {
  rejectSpectrumSharedDrive(device, currentProgramInstructions[0]?.location ?? { filename: "<generated>", line: 1 });
  return device === "rs232" ? "t" : "P";
}

function deviceForHandle(handle: string): DeviceKind | undefined {
  for (const instruction of currentProgramInstructions) {
    if (instruction.kind === "open-device" && instruction.handle.toLowerCase() === handle.toLowerCase()) {
      return instruction.device;
    }
  }
  return undefined;
}

function rejectSpectrumSharedDrive(device: DeviceKind, location: Expression["location"]): void {
  if (device === "shared-drive") {
    throw new DiagnosticError(location, "SHARED_DRIVE is currently supported only by the Atari 800XL target.");
  }
}

function deviceHandleIndex(handle: string): number {
  const handles: string[] = [];
  const seen = new Set<string>();
  for (const instruction of currentProgramInstructions) {
    if (instruction.kind !== "open-device") {
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

const renderKnownSpectrumFunction = createFunctionRenderer(
  new Map([
    [builtinFunctions.abs, renderSpectrumUnaryNumericFunction],
    [builtinFunctions.asc, renderSpectrumCode],
    [builtinFunctions.atn, renderSpectrumUnaryNumericFunction],
    [builtinFunctions.chr, renderSpectrumChr],
    [builtinFunctions.code, renderSpectrumCode],
    [builtinFunctions.cos, renderSpectrumUnaryNumericFunction],
    [builtinFunctions.exp, renderSpectrumUnaryNumericFunction],
    [builtinFunctions.int, renderSpectrumUnaryNumericFunction],
    [builtinFunctions.jiffies, () => "PEEK 23672 + 256 * PEEK 23673 + 65536 * PEEK 23674"],
    [builtinFunctions.left, renderSpectrumLeft],
    [builtinFunctions.len, renderSpectrumLen],
    [builtinFunctions.mid, renderSpectrumMid],
    [builtinFunctions.rnd, () => "RND"],
    [builtinFunctions.right, renderSpectrumRight],
    [builtinFunctions.sgn, renderSpectrumUnaryNumericFunction],
    [builtinFunctions.sin, renderSpectrumUnaryNumericFunction],
    [builtinFunctions.sqr, renderSpectrumUnaryNumericFunction],
    [builtinFunctions.str, renderSpectrumStr],
    [builtinFunctions.val, renderSpectrumVal]
  ])
);

function renderSpectrumFunction(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string | undefined {
  const upper = expression.name.toUpperCase();
  if (upper === "INKEY$") {
    return "INKEY$";
  }
  if (upper === "CODE") {
    return `CODE ${renderSpectrumLenArgument(expression.args[0], options)}`;
  }

  return renderKnownSpectrumFunction(expression, options);
}

function renderSpectrumChr(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `CHR$ ${renderSpectrumLenArgument(expression.args[0], options)}`;
}

function renderSpectrumCode(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `CODE ${renderSpectrumLenArgument(expression.args[0], options)}`;
}

function renderSpectrumStr(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `STR$ ${renderSpectrumLenArgument(expression.args[0], options)}`;
}

function renderSpectrumVal(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `VAL ${renderSpectrumLenArgument(expression.args[0], options)}`;
}

function renderSpectrumUnaryNumericFunction(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `${expression.name.toUpperCase()} ${renderSpectrumLenArgument(expression.args[0], options)}`;
}

function renderSpectrumLen(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  const [source] = expression.args;
  return `LEN ${renderSpectrumLenArgument(source, options)}`;
}

function renderSpectrumMid(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  const [source, start, length] = expression.args;
  return `${renderExpression(source, options)}(${renderExpression(start, options)} TO ${renderExpression(start, options)} + ${renderExpression(length, options)} - 1)`;
}

function renderSpectrumLeft(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  const [source, length] = expression.args;
  return `${renderExpression(source, options)}( TO ${renderExpression(length, options)})`;
}

function renderSpectrumRight(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  const [source, length] = expression.args;
  const renderedSource = renderExpression(source, options);
  return `${renderedSource}(LEN ${renderSpectrumLenArgument(source, options)} - ${renderExpression(length, options)} + 1 TO )`;
}

function renderSpectrumLenArgument(expression: Expression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  if (expression.kind === "identifier" || expression.kind === "string" || expression.kind === "function-call") {
    return renderExpression(expression, options);
  }

  return `(${renderExpression(expression, options)})`;
}

function renderSpectrumArrayAccess(
  expression: Extract<Expression, { kind: "array-access" }>,
  options: {
    readonly variableMap?: ReadonlyMap<string, string>;
    readonly functionRenderer?: typeof renderSpectrumFunction;
    readonly arrayRenderer?: typeof renderSpectrumArrayAccess;
    readonly stringArrayWidths?: ReadonlyMap<string, number>;
  }
): string {
  if (isStringVariableName(expression.name)) {
    const width = spectrumStringArrayWidth(expression.name, options.stringArrayWidths);
    return `${renderSpectrumArrayName(expression.name, options.variableMap ?? new Map())}(${renderSpectrumArrayIndex(expression.indices[0], options)},1 TO ${width})`;
  }

  return `${renderSpectrumArrayName(expression.name, options.variableMap ?? new Map())}(${expression.indices.map((index) => renderSpectrumArrayIndex(index, options)).join(",")})`;
}

function renderSpectrumArrayName(name: string, variableMap: ReadonlyMap<string, string>): string {
  return variableMap.get(name.toLowerCase()) ?? "A";
}

function renderSpectrumArrayAssignmentTarget(
  name: string,
  indices: readonly Expression[],
  options: {
    readonly variableMap?: ReadonlyMap<string, string>;
    readonly functionRenderer?: typeof renderSpectrumFunction;
    readonly arrayRenderer?: typeof renderSpectrumArrayAccess;
    readonly stringArrayWidths?: ReadonlyMap<string, number>;
  }
): string {
  if (isStringVariableName(name)) {
    const width = spectrumStringArrayWidth(name, options.stringArrayWidths);
    return `${renderSpectrumArrayName(name, options.variableMap ?? new Map())}(${renderSpectrumArrayIndex(indices[0], options)},1 TO ${width})`;
  }

  return `${renderSpectrumArrayName(name, options.variableMap ?? new Map())}(${indices.map((index) => renderSpectrumArrayIndex(index, options)).join(",")})`;
}

function renderSpectrumArrayIndex(
  expression: Expression,
  options: {
    readonly variableMap?: ReadonlyMap<string, string>;
    readonly functionRenderer?: typeof renderSpectrumFunction;
    readonly arrayRenderer?: typeof renderSpectrumArrayAccess;
    readonly stringArrayWidths?: ReadonlyMap<string, number>;
  }
): string {
  if (expression.kind === "number") {
    return (expression.value + 1).toString();
  }

  return `${renderExpression(expression, options)} + 1`;
}

function buildSpectrumStringArrayWidths(instructions: readonly Instruction[]): ReadonlyMap<string, number> {
  const widths = new Map<string, number>();
  for (const instruction of instructions) {
    if (instruction.kind === "dim-array" && isStringVariableName(instruction.name)) {
      widths.set(instruction.name.toLowerCase(), instruction.dimensions[1] ?? 1);
    }
  }
  return widths;
}

function spectrumStringArrayWidth(name: string, widths: ReadonlyMap<string, number> | undefined): number {
  const width = widths?.get(name.toLowerCase());
  if (width === undefined) {
    throw new Error(`Internal error: missing Spectrum string array width for ${name}.`);
  }
  return width;
}

function buildUppercaseVariableMap(instructions: readonly Instruction[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const stringNames: string[] = [];
  const seenStrings = new Set<string>();
  allocateSpectrumArrayNames(collectSpectrumArrayNames(instructions), map);
  const loopNames = collectSpectrumLoopNames(instructions);
  allocateSpectrumLoopNames(loopNames, collectReservedSingleLetterNumericNames(instructions), map);

  for (const instruction of instructions) {
    if (instruction.kind === "let" || instruction.kind === "check-device") {
      if (isStringVariableName(instruction.name)) {
        collectStringName(instruction.name, stringNames, seenStrings);
      } else {
        collectNumericName(instruction.name, map);
      }
    } else if (instruction.kind === "read") {
      for (const target of instruction.targets) {
        if (isStringVariableName(target)) {
          collectStringName(target, stringNames, seenStrings);
        } else {
          collectNumericName(target, map);
        }
      }
    } else if (instruction.kind === "dim-array" || instruction.kind === "array-let") {
      collectNumericName(instruction.name, map);
    } else if (instruction.kind === "for" || instruction.kind === "next") {
      collectNumericName(instruction.variable, map);
    }
    for (const expression of instructionExpressions(instruction)) {
      collectIdentifiers(expression, map, stringNames, seenStrings);
    }
  }

  allocateSpectrumStringNames(stringNames, map);
  return map;
}

function collectSpectrumLoopNames(instructions: readonly Instruction[]): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const instruction of instructions) {
    if (instruction.kind !== "for") {
      continue;
    }
    const key = instruction.variable.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(instruction.variable);
    }
  }

  return names;
}

function collectReservedSingleLetterNumericNames(instructions: readonly Instruction[]): ReadonlySet<string> {
  const names = new Set<string>();

  for (const instruction of instructions) {
    if (instruction.kind === "let" && /^[A-Z]$/i.test(instruction.name)) {
      names.add(instruction.name.toUpperCase());
    } else if (instruction.kind === "read") {
      for (const target of instruction.targets) {
        if (!isStringVariableName(target) && /^[A-Z]$/i.test(target)) {
          names.add(target.toUpperCase());
        }
      }
    } else if ((instruction.kind === "for" || instruction.kind === "next") && /^[A-Z]$/i.test(instruction.variable)) {
      names.add(instruction.variable.toUpperCase());
    }
    for (const expression of instructionExpressions(instruction)) {
      collectSingleLetterNumericIdentifiers(expression, names);
    }
  }

  return names;
}

function collectSingleLetterNumericIdentifiers(expression: Expression, names: Set<string>): void {
  switch (expression.kind) {
    case "identifier":
      if (!isStringVariableName(expression.name) && /^[A-Z]$/i.test(expression.name)) {
        names.add(expression.name.toUpperCase());
      }
      break;
    case "parenthesized":
      collectSingleLetterNumericIdentifiers(expression.expression, names);
      break;
    case "unary":
      collectSingleLetterNumericIdentifiers(expression.operand, names);
      break;
    case "binary":
      collectSingleLetterNumericIdentifiers(expression.left, names);
      collectSingleLetterNumericIdentifiers(expression.right, names);
      break;
    case "function-call":
      for (const arg of expression.args) {
        collectSingleLetterNumericIdentifiers(arg, names);
      }
      break;
    case "array-access":
      for (const index of expression.indices) {
        collectSingleLetterNumericIdentifiers(index, names);
      }
      break;
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
}

function collectSpectrumArrayNames(instructions: readonly Instruction[]): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const instruction of instructions) {
    if (instruction.kind !== "dim-array") {
      continue;
    }
    const key = instruction.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(instruction.name);
    }
  }

  return names;
}

function allocateSpectrumArrayNames(names: readonly string[], map: Map<string, string>): void {
  const used = new Set<string>();

  for (const name of names) {
    const key = name.toLowerCase();
    const preferred = baseVariableName(name)[0]?.toUpperCase();
    if (preferred && /^[A-Z]$/.test(preferred) && !used.has(preferred)) {
      map.set(key, isStringVariableName(name) ? `${preferred}$` : preferred);
      used.add(preferred);
      continue;
    }

    const next = nextSpectrumNumericName(used);
    map.set(key, isStringVariableName(name) ? `${next}$` : next);
    used.add(next);
  }
}

function allocateSpectrumLoopNames(names: readonly string[], reservedSingleLetters: ReadonlySet<string>, map: Map<string, string>): void {
  const used = new Set<string>();

  for (const name of names) {
    const upper = name.toUpperCase();
    if (/^[A-Z]$/.test(upper) && !used.has(upper)) {
      map.set(name.toLowerCase(), upper);
      used.add(upper);
    }
  }

  for (const name of names) {
    const key = name.toLowerCase();
    if (map.has(key)) {
      continue;
    }

    const preferred = name[0]?.toUpperCase();
    if (preferred && /^[A-Z]$/.test(preferred) && !used.has(preferred) && !reservedSingleLetters.has(preferred)) {
      map.set(key, preferred);
      used.add(preferred);
      continue;
    }

    const next = nextSpectrumNumericName(new Set([...used, ...reservedSingleLetters]));
    map.set(key, next);
    used.add(next);
  }
}

function nextSpectrumNumericName(used: ReadonlySet<string>): string {
  for (let index = 0; index < 26; index += 1) {
    const candidate = String.fromCharCode("A".charCodeAt(0) + index);
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("Spectrum target only supports 26 active FOR loop variables.");
}

function collectIdentifiers(expression: Expression, map: Map<string, string>, stringNames: string[], seenStrings: Set<string>): void {
  switch (expression.kind) {
    case "identifier":
      if (isStringVariableName(expression.name)) {
        collectStringName(expression.name, stringNames, seenStrings);
      } else {
        collectNumericName(expression.name, map);
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
    case "array-access":
      collectNumericName(expression.name, map);
      for (const index of expression.indices) {
        collectIdentifiers(index, map, stringNames, seenStrings);
      }
      break;
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
}

function collectNumericName(name: string, map: Map<string, string>): void {
  if (!map.has(name.toLowerCase())) {
    map.set(name.toLowerCase(), renderSpectrumNumericName(name));
  }
}

function renderSpectrumNumericName(name: string): string {
  const clean = baseVariableName(name).toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  const base = clean || "N";
  return isIntegerVariableName(name) ? `${base}I` : base;
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
  for (const mappedName of map.values()) {
    if (/^[A-Z]\$$/.test(mappedName)) {
      used.add(mappedName);
    }
  }

  for (const name of names) {
    const key = name.toLowerCase();
    if (map.has(key)) {
      continue;
    }
    const upper = name.toUpperCase();
    if (/^[A-Z]\$$/.test(upper) && !used.has(upper)) {
      map.set(key, upper);
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

function expandSpectrumKeyCodeAssignment(
  instruction: Extract<Instruction, { kind: "let" }>,
  keyStringTempName: string,
  allocateInternalLabel: () => string
): readonly Instruction[] {
  const gotKeyLabel = allocateInternalLabel();
  const endLabel = allocateInternalLabel();
  const keyStringIdentifier: Expression = { kind: "identifier", name: keyStringTempName, location: instruction.location };

  return [
    {
      kind: "let",
      name: keyStringTempName,
      expression: { kind: "function-call", name: "INKEY$", args: [], location: instruction.location },
      location: instruction.location
    },
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
      expression: { kind: "function-call", name: "CODE", args: [keyStringIdentifier], location: instruction.location }
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
    case "array-access":
      used.add(expression.name.toLowerCase());
      for (const index of expression.indices) {
        collectUsedExpressionNames(index, used);
      }
      break;
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
}
