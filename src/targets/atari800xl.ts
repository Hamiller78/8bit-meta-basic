import type { Expression } from "../ast.js";
import type { DeviceKind } from "../devices.js";
import { builtinFunctions, isStringFunctionName } from "../functions.js";
import { DiagnosticError } from "../diagnostics.js";
import { resolveLabel } from "../line-numbering.js";
import type { ReadabilityLevel } from "../line-numbering.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { normalizeLabel } from "../lowering.js";
import { baseVariableName, isIntegerVariableName, isStringVariableName } from "../variables.js";
import { createFunctionRenderer, type FunctionCallExpression } from "./function-rendering.js";
import { instructionExpressions } from "./instruction-expressions.js";
import { atariColorCodes, expandPositionedPrints, rebuildLabels, renderExpression, renderPrintItems, type TargetBackend } from "./target.js";

export const atari800xlTarget: TargetBackend = {
  id: "atari800xl",
  gotoSpelling: "GOTO",
  maxLineLength: 120,
  maxLineNumber: 32767,
  lower(program: LoweredProgram, _readability: ReadabilityLevel): LoweredProgram {
    const expanded = expandPositionedPrints(program, "Atari 800XL", 23, 39, (instruction) => [
      { kind: "position", row: instruction.at!.row, column: instruction.at!.column, location: instruction.location },
      { ...instruction, at: undefined }
    ]);
    const allocateTempStringName = createTempStringNameAllocator(expanded.instructions);
    const allocateInternalLabel = createInternalLabelAllocator(expanded);
    const dimmedStrings = new Set<string>();
    const instructions: Instruction[] = [];

    const ensureStringDim = (name: string, location: Expression["location"]): void => {
      const key = name.toLowerCase();
      if (dimmedStrings.has(key)) {
        return;
      }
      dimmedStrings.add(key);
      instructions.push({ kind: "dim-string", name, length: 255, location });
    };

    const pushStringAssignment = (instruction: Extract<Instruction, { kind: "let" }>): void => {
      ensureStringDim(instruction.name, instruction.location);
      instructions.push(...expandAtariStringAssignment(instruction, allocateTempStringName, ensureStringDim));
    };

    for (const instruction of expanded.instructions) {
      if (instruction.kind === "cls") {
        if (instruction.color) {
          const color = atariColorCodes[instruction.color.color];
          instructions.push({
            kind: "setcolor",
            register: 2,
            hue: color.hue,
            luminance: color.luminance,
            location: instruction.location
          });
        }
        instructions.push({ kind: "print-chr", code: 125, trailingSemicolon: true, location: instruction.location });
      } else if (instruction.kind === "border-color") {
        const color = atariColorCodes[instruction.color.color];
        instructions.push({
          kind: "setcolor",
          register: 4,
          hue: color.hue,
          luminance: color.luminance,
          location: instruction.location
        });
      } else if (instruction.kind === "screen-background-color") {
        const color = atariColorCodes[instruction.color.color];
        instructions.push({
          kind: "setcolor",
          register: 2,
          hue: color.hue,
          luminance: color.luminance,
          location: instruction.location
        });
      } else if (instruction.kind === "text-color") {
        const color = atariColorCodes[instruction.color.color];
        instructions.push({
          kind: "setcolor",
          register: 1,
          hue: color.hue,
          luminance: color.luminance,
          location: instruction.location
        });
      } else if (instruction.kind === "cell-text-color" || instruction.kind === "cell-background-color") {
        continue;
      } else if (instruction.kind === "suppress-scroll-prompt") {
        continue;
      } else if (instruction.kind === "randomize") {
        continue;
      } else if (instruction.kind === "check-device") {
        instructions.push(...expandAtariDeviceAvailabilityCheck(instruction, allocateInternalLabel));
      } else if (isKeyCodeAssignment(instruction)) {
        const assignment = instruction as Extract<Instruction, { kind: "let" }>;
        instructions.push(...expandAtariKeyCodeAssignment(assignment, allocateInternalLabel));
      } else if (instruction.kind === "let" && isStringVariableName(instruction.name)) {
        pushStringAssignment(instruction);
      } else if (instruction.kind === "array-let" && isStringVariableName(instruction.name) && instruction.expression.kind !== "string") {
        const tempName = allocateTempStringName();
        pushStringAssignment({ kind: "let", name: tempName, expression: instruction.expression, location: instruction.location });
        instructions.push({ ...instruction, expression: { kind: "identifier", name: tempName, location: instruction.location } });
      } else if (instruction.kind === "read") {
        for (const target of instruction.targets) {
          if (isStringVariableName(target)) {
            ensureStringDim(target, instruction.location);
          }
        }
        instructions.push(instruction);
      } else if (instruction.kind === "print" || instruction.kind === "print-device") {
        const beforePrint: Instruction[] = [];
        const items = instruction.items.map((item) => {
          if (!isStringConcatenation(item)) {
            return item;
          }

          const tempName = allocateTempStringName();
          ensureStringDim(tempName, item.location);
          beforePrint.push(
            ...expandAtariStringAssignment(
              { kind: "let", name: tempName, expression: item, location: item.location },
              allocateTempStringName,
              ensureStringDim
            )
          );
          return { kind: "identifier", name: tempName, location: item.location } satisfies Expression;
        });
        instructions.push(...beforePrint, { ...instruction, items });
      } else {
        instructions.push(instruction);
      }
    }
    return rebuildLabels(expanded, instructions);
  },
  renderLine(lineNumber: number, instruction: Instruction, labelLines: ReadonlyMap<string, number>, _readability: ReadabilityLevel): string {
    const variableMap = buildUppercaseVariableMap(currentProgramInstructions);
    const renderOptions = { variableMap, functionRenderer: renderAtariFunction, arrayRenderer: renderAtariArrayAccess };

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
      case "paper":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for Atari 800XL.`);
      case "print":
        return `${lineNumber} PRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`;
      case "open-device":
        return `${lineNumber} OPEN #${atariIocbNumber(instruction.handle, instruction.location)},8,0,"${atariDeviceSpec(instruction.device)}"`;
      case "print-device":
        return `${lineNumber} PRINT #${atariIocbNumber(instruction.handle, instruction.location)};${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`;
      case "close-device":
        return `${lineNumber} CLOSE #${atariIocbNumber(instruction.handle, instruction.location)}`;
      case "check-device":
        throw new Error("Internal error: unexpected check-device instruction for Atari 800XL.");
      case "data":
        return `${lineNumber} DATA ${renderAtariDataValues(instruction.values, renderOptions)}`;
      case "read":
        return `${lineNumber} READ ${instruction.targets.map((target) => variableMap.get(target.toLowerCase()) ?? renderAtariVariableName(target)).join(",")}`;
      case "restore":
        return `${lineNumber} RESTORE`;
      case "let":
        return renderAtariAssignment(lineNumber, instruction, variableMap, renderOptions);
      case "multi-let":
        return `${lineNumber} ${instruction.assignments.map((assignment) => renderAtariAssignmentBody(assignment, variableMap, renderOptions)).join(":")}`;
      case "dim-array":
        return `${lineNumber} DIM ${renderAtariArrayName(instruction.name, variableMap)}(${renderAtariArrayDimensions(instruction.name, instruction.dimensions).join(",")})`;
      case "array-let":
        return `${lineNumber} ${renderAtariArrayAssignmentTarget(instruction.name, instruction.indices, instruction.location, variableMap, renderOptions)}=${renderAtariArrayAssignmentExpression(instruction.name, instruction.expression) ?? renderExpression(instruction.expression, renderOptions)}`;
      case "read-key":
        throw new Error("Internal error: unexpected read-key instruction for Atari 800XL.");
      case "dim-string":
        return `${lineNumber} DIM ${instruction.name.toUpperCase()}(${instruction.length})`;
      case "goto":
        return `${lineNumber} GOTO ${resolveLabel(labelLines, instruction.label)}`;
      case "gosub":
        return `${lineNumber} GOSUB ${resolveLabel(labelLines, instruction.label)}`;
      case "return":
        return `${lineNumber} RETURN`;
      case "end":
        return `${lineNumber} END`;
      case "for":
        return `${lineNumber} FOR ${variableMap.get(instruction.variable.toLowerCase()) ?? instruction.variable.toUpperCase()}=${renderExpression(instruction.start, renderOptions)} TO ${renderExpression(instruction.limit, renderOptions)}${instruction.step ? ` STEP ${renderExpression(instruction.step, renderOptions)}` : ""}`;
      case "next":
        return `${lineNumber} NEXT ${variableMap.get(instruction.variable.toLowerCase()) ?? instruction.variable.toUpperCase()}`;
      case "if-goto":
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN GOTO ${resolveLabel(labelLines, instruction.label)}`;
      case "randomize":
        throw new Error("Internal error: unexpected randomize instruction for Atari 800XL.");
      case "position":
        return `${lineNumber} POSITION ${renderExpression(instruction.column, renderOptions)},${renderExpression(instruction.row, renderOptions)}`;
      case "setcolor":
        return `${lineNumber} SETCOLOR ${instruction.register},${instruction.hue},${instruction.luminance}`;
      case "print-chr":
        return `${lineNumber} PRINT CHR$(${instruction.code})${instruction.trailingSemicolon ? ";" : ""}`;
      case "poke":
        return `${lineNumber} POKE ${instruction.address},${renderExpression(instruction.value, renderOptions)}`;
      case "sys":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for Atari 800XL.`);
      case "trap":
        return instruction.label ? `${lineNumber} TRAP ${resolveLabel(labelLines, instruction.label)}` : `${lineNumber} TRAP 40000`;
      case "wait-rs232-transmit":
        throw new Error("Internal error: unexpected wait-rs232-transmit instruction for Atari 800XL.");
    }
  }
};

let currentProgramInstructions: readonly Instruction[] = [];

export function setAtariRenderProgram(instructions: readonly Instruction[]): void {
  currentProgramInstructions = instructions;
}

function atariIocbNumber(handle: string, location: Expression["location"]): number {
  if (handle === "__mb_probe") {
    return 1;
  }
  const iocb = 1 + deviceHandleIndex(handle);
  if (iocb > 7) {
    throw new Error(`${location.filename}:${location.line}: Atari 800XL supports only 7 Meta-BASIC device handles at once.`);
  }
  return iocb;
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

function expandAtariDeviceAvailabilityCheck(
  instruction: Extract<Instruction, { kind: "check-device" }>,
  allocateInternalLabel: () => string
): readonly Instruction[] {
  const failedLabel = allocateInternalLabel();
  const endLabel = allocateInternalLabel();
  return [
    { kind: "trap", label: failedLabel, location: instruction.location },
    { kind: "open-device", handle: "__mb_probe", device: instruction.device, location: instruction.location },
    { kind: "close-device", handle: "__mb_probe", location: instruction.location },
    { kind: "let", name: instruction.name, expression: { kind: "number", value: 1, raw: "1", location: instruction.location }, location: instruction.location },
    { kind: "trap", location: instruction.location },
    { kind: "goto", label: endLabel, location: instruction.location },
    { kind: "label", name: failedLabel, internal: true, location: instruction.location },
    { kind: "let", name: instruction.name, expression: { kind: "number", value: 0, raw: "0", location: instruction.location }, location: instruction.location },
    { kind: "trap", location: instruction.location },
    { kind: "label", name: endLabel, internal: true, location: instruction.location }
  ];
}

function atariDeviceSpec(device: DeviceKind): "P:" | "R:" | "H6:MCP.TXT" {
  switch (device) {
    case "rs232":
      return "R:";
    case "shared-drive":
      return "H6:MCP.TXT";
    case "printer":
    case "text-printer":
      return "P:";
  }
}

function renderAtariAssignment(
  lineNumber: number,
  instruction: Extract<Instruction, { kind: "let" }>,
  variableMap: ReadonlyMap<string, string>,
  renderOptions: { readonly variableMap?: ReadonlyMap<string, string>; readonly functionRenderer: typeof renderAtariFunction }
): string {
  return `${lineNumber} ${renderAtariAssignmentBody(instruction, variableMap, renderOptions)}`;
}

function renderAtariAssignmentBody(
  instruction: Pick<Extract<Instruction, { kind: "let" }>, "name" | "expression">,
  variableMap: ReadonlyMap<string, string>,
  renderOptions: { readonly variableMap?: ReadonlyMap<string, string>; readonly functionRenderer: typeof renderAtariFunction }
): string {
  const targetName = variableMap.get(instruction.name.toLowerCase()) ?? instruction.name.toUpperCase();
  const appendExpression = stringSelfAppendRight(instruction.name, instruction.expression);
  if (appendExpression) {
    return `${targetName}(LEN(${targetName})+1)=${renderExpression(appendExpression, renderOptions)}`;
  }

  return `${targetName}=${renderExpression(instruction.expression, renderOptions)}`;
}

function renderAtariDataValues(values: readonly Expression[], options: { readonly variableMap?: ReadonlyMap<string, string>; readonly functionRenderer: typeof renderAtariFunction }): string {
  return values
    .map((value) => {
      if (value.kind !== "string") {
        return renderExpression(value, options);
      }
      if (value.value.includes(",")) {
        throw new DiagnosticError(value.location, "Atari BASIC DATA string values cannot contain commas yet.");
      }
      return value.value;
    })
    .join(",");
}

function renderAtariArrayAccess(
  expression: Extract<Expression, { kind: "array-access" }>,
  options: { readonly variableMap?: ReadonlyMap<string, string>; readonly functionRenderer?: typeof renderAtariFunction; readonly arrayRenderer?: typeof renderAtariArrayAccess }
): string {
  if (isStringVariableName(expression.name)) {
    const width = atariStringArrayWidth(expression.name);
    return `${renderAtariArrayName(expression.name, options.variableMap ?? new Map())}(${renderAtariStringArrayStart(expression.indices[0], width, options)},${renderAtariStringArrayEnd(expression.indices[0], width, options)})`;
  }

  return `${renderAtariArrayName(expression.name, options.variableMap ?? new Map())}(${expression.indices.map((index) => renderExpression(index, options)).join(",")})`;
}

function renderAtariArrayName(name: string, variableMap: ReadonlyMap<string, string>): string {
  return variableMap.get(name.toLowerCase()) ?? renderAtariVariableName(name);
}

function renderAtariArrayDimension(dimension: number): string {
  return (dimension - 1).toString();
}

function renderAtariArrayDimensions(name: string, dimensions: readonly number[]): readonly string[] {
  if (isStringVariableName(name)) {
    return [(dimensions[0] * dimensions[1]).toString()];
  }

  return dimensions.map(renderAtariArrayDimension);
}

function renderAtariArrayAssignmentTarget(
  name: string,
  indices: readonly Expression[],
  location: Expression["location"],
  variableMap: ReadonlyMap<string, string>,
  options: { readonly variableMap?: ReadonlyMap<string, string>; readonly functionRenderer?: typeof renderAtariFunction; readonly arrayRenderer?: typeof renderAtariArrayAccess }
): string {
  if (!isStringVariableName(name)) {
    return renderAtariArrayAccess({ kind: "array-access", name, indices, location }, options);
  }

  const width = atariStringArrayWidth(name);
  return `${renderAtariArrayName(name, variableMap)}(${renderAtariStringArrayStart(indices[0], width, options)},${renderAtariStringArrayEnd(indices[0], width, options)})`;
}

function renderAtariArrayAssignmentExpression(name: string, expression: Expression): string | undefined {
  if (!isStringVariableName(name) || expression.kind !== "string") {
    return undefined;
  }

  return `"${expression.value.padEnd(atariStringArrayWidth(name), " ")}"`;
}

function atariStringArrayWidth(name: string): number {
  const definition = currentProgramInstructions.find((instruction) => instruction.kind === "dim-array" && instruction.name.toLowerCase() === name.toLowerCase());
  if (!definition || definition.kind !== "dim-array") {
    throw new Error(`Internal error: missing string array definition for ${name}.`);
  }

  return definition.dimensions[definition.dimensions.length - 1];
}

function renderAtariStringArrayStart(
  index: Expression,
  width: number,
  options: { readonly variableMap?: ReadonlyMap<string, string>; readonly functionRenderer?: typeof renderAtariFunction; readonly arrayRenderer?: typeof renderAtariArrayAccess }
): string {
  if (index.kind === "number") {
    return (index.value * width + 1).toString();
  }

  return `${renderExpression(index, options)} * ${width} + 1`;
}

function renderAtariStringArrayEnd(
  index: Expression,
  width: number,
  options: { readonly variableMap?: ReadonlyMap<string, string>; readonly functionRenderer?: typeof renderAtariFunction; readonly arrayRenderer?: typeof renderAtariArrayAccess }
): string {
  if (index.kind === "number") {
    return ((index.value + 1) * width).toString();
  }

  return `(${renderExpression(index, options)} + 1) * ${width}`;
}

function renderAtariStringArrayOffset(
  elementStart: string,
  expressions: readonly Expression[],
  constantOffset: number,
  options: { readonly variableMap?: ReadonlyMap<string, string>; readonly functionRenderer?: typeof renderAtariFunction; readonly arrayRenderer?: typeof renderAtariArrayAccess }
): string {
  const terms = [elementStart, ...expressions.map((part) => renderExpression(part, options))];
  if (constantOffset !== 0) {
    terms.push(constantOffset.toString());
  }
  return terms.join(" + ").replaceAll("+ -", "- ");
}

function stringSelfAppendRight(name: string, expression: Expression): Expression | undefined {
  if (!isStringVariableName(name) || expression.kind !== "binary" || expression.operator !== "+") {
    return undefined;
  }

  if (expression.left.kind === "identifier" && expression.left.name.toLowerCase() === name.toLowerCase()) {
    return expression.right;
  }

  return undefined;
}

function expandAtariStringAssignment(
  instruction: Extract<Instruction, { kind: "let" }>,
  allocateTempStringName: () => string,
  ensureStringDim: (name: string, location: Expression["location"]) => void
): readonly Instruction[] {
  const parts = flattenStringConcatenation(instruction.expression);
  if (!parts) {
    return [instruction];
  }

  const leadingSelfAppend = isIdentifierNamed(parts[0], instruction.name);
  const needsTemp = !leadingSelfAppend && expressionReferencesName(instruction.expression, instruction.name);
  const targetName = needsTemp ? allocateTempStringName() : instruction.name;
  const instructions: Instruction[] = [];
  const appendStart = leadingSelfAppend ? 1 : 0;

  if (needsTemp) {
    ensureStringDim(targetName, instruction.location);
  }

  if (!leadingSelfAppend) {
    instructions.push({ ...instruction, name: targetName, expression: parts[0] });
  }

  for (const part of parts.slice(appendStart + (leadingSelfAppend ? 0 : 1))) {
    instructions.push({
      kind: "let",
      name: targetName,
      expression: {
        kind: "binary",
        operator: "+",
        left: { kind: "identifier", name: targetName, location: part.location },
        right: part,
        location: part.location
      },
      location: part.location
    });
  }

  if (needsTemp) {
    instructions.push({
      ...instruction,
      expression: { kind: "identifier", name: targetName, location: instruction.location }
    });
  }

  return instructions;
}

function flattenStringConcatenation(expression: Expression): readonly Expression[] | undefined {
  if (!isStringConcatenation(expression)) {
    return undefined;
  }

  return flattenStringParts(expression);
}

function flattenStringParts(expression: Expression): readonly Expression[] {
  if (expression.kind === "parenthesized") {
    return flattenStringParts(expression.expression);
  }
  if (isStringConcatenation(expression)) {
    return [...flattenStringParts(expression.left), ...flattenStringParts(expression.right)];
  }
  return [expression];
}

function isStringConcatenation(expression: Expression): expression is Extract<Expression, { kind: "binary" }> {
  return expression.kind === "binary" && expression.operator === "+" && isAtariStringExpression(expression.left) && isAtariStringExpression(expression.right);
}

function isAtariStringExpression(expression: Expression): boolean {
  switch (expression.kind) {
    case "string":
      return true;
    case "identifier":
      return isStringVariableName(expression.name);
    case "parenthesized":
      return isAtariStringExpression(expression.expression);
    case "binary":
      return expression.operator === "+" && isAtariStringExpression(expression.left) && isAtariStringExpression(expression.right);
    case "function-call":
      return isStringFunctionName(expression.name);
    case "array-access":
      return expression.valueType === "string";
    case "number":
    case "boolean":
    case "color":
    case "unary":
      return false;
  }
}

function isIdentifierNamed(expression: Expression, name: string): boolean {
  return expression.kind === "identifier" && expression.name.toLowerCase() === name.toLowerCase();
}

function expressionReferencesName(expression: Expression, name: string): boolean {
  switch (expression.kind) {
    case "identifier":
      return expression.name.toLowerCase() === name.toLowerCase();
    case "parenthesized":
      return expressionReferencesName(expression.expression, name);
    case "unary":
      return expressionReferencesName(expression.operand, name);
    case "binary":
      return expressionReferencesName(expression.left, name) || expressionReferencesName(expression.right, name);
    case "function-call":
      return expression.args.some((arg) => expressionReferencesName(arg, name));
    case "array-access":
      return expression.indices.some((index) => expressionReferencesName(index, name));
    case "number":
    case "string":
    case "boolean":
    case "color":
      return false;
  }
}

function createTempStringNameAllocator(instructions: readonly Instruction[]): () => string {
  const used = new Set<string>();
  for (const instruction of instructions) {
    if (instruction.kind === "let" || instruction.kind === "dim-string") {
      used.add(instruction.name.toLowerCase());
    } else if (instruction.kind === "read") {
      for (const target of instruction.targets) {
        used.add(target.toLowerCase());
      }
    }
    for (const expression of instructionExpressions(instruction)) {
      collectExpressionNames(expression, used);
    }
  }

  let next = 0;
  return () => {
    while (true) {
      const name = next === 0 ? "MBTEMP$" : `MBTEMP${next}$`;
      next += 1;
      const key = name.toLowerCase();
      if (!used.has(key)) {
        used.add(key);
        return name;
      }
    }
  };
}

function collectExpressionNames(expression: Expression, used: Set<string>): void {
  switch (expression.kind) {
    case "identifier":
      used.add(expression.name.toLowerCase());
      break;
    case "parenthesized":
      collectExpressionNames(expression.expression, used);
      break;
    case "unary":
      collectExpressionNames(expression.operand, used);
      break;
    case "binary":
      collectExpressionNames(expression.left, used);
      collectExpressionNames(expression.right, used);
      break;
    case "function-call":
      for (const arg of expression.args) {
        collectExpressionNames(arg, used);
      }
      break;
    case "array-access":
      used.add(expression.name.toLowerCase());
      for (const index of expression.indices) {
        collectExpressionNames(index, used);
      }
      break;
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
}

const renderKnownAtariFunction = createFunctionRenderer(
  new Map([
    [builtinFunctions.abs, renderAtariUnaryNumericFunction],
    [builtinFunctions.asc, renderAtariCode],
    [builtinFunctions.atn, renderAtariUnaryNumericFunction],
    [builtinFunctions.chr, renderAtariChr],
    [builtinFunctions.code, renderAtariCode],
    [builtinFunctions.cos, renderAtariUnaryNumericFunction],
    [builtinFunctions.exp, renderAtariUnaryNumericFunction],
    [builtinFunctions.freeMemory, () => "FRE(0)"],
    [builtinFunctions.int, renderAtariUnaryNumericFunction],
    [builtinFunctions.jiffies, () => "PEEK(20) + PEEK(19) * 256 + PEEK(18) * 65536"],
    [builtinFunctions.left, renderAtariLeft],
    [builtinFunctions.len, renderAtariLen],
    [builtinFunctions.mid, renderAtariMid],
    [builtinFunctions.rnd, () => "RND(0)"],
    [builtinFunctions.right, renderAtariRight],
    [builtinFunctions.sgn, renderAtariUnaryNumericFunction],
    [builtinFunctions.sin, renderAtariUnaryNumericFunction],
    [builtinFunctions.sqr, renderAtariUnaryNumericFunction],
    [builtinFunctions.str, renderAtariStr],
    [builtinFunctions.val, renderAtariVal]
  ])
);

function renderAtariFunction(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string | undefined {
  if (expression.name.toUpperCase() === "PEEK") {
    return `PEEK(${renderExpression(expression.args[0], options)})`;
  }

  return renderKnownAtariFunction(expression, options);
}

function renderAtariChr(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `CHR$(${renderExpression(expression.args[0], options)})`;
}

function renderAtariCode(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `ASC(${renderExpression(expression.args[0], options)})`;
}

function renderAtariStr(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `STR$(${renderExpression(expression.args[0], options)})`;
}

function renderAtariVal(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `VAL(${renderExpression(expression.args[0], options)})`;
}

function renderAtariUnaryNumericFunction(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `${expression.name.toUpperCase()}(${renderExpression(expression.args[0], options)})`;
}

function renderAtariLen(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `LEN(${renderExpression(expression.args[0], options)})`;
}

function renderAtariMid(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  const [source, start, length] = expression.args;
  if (source.kind === "array-access" && isStringVariableName(source.name)) {
    const width = atariStringArrayWidth(source.name);
    const renderedName = renderAtariArrayName(source.name, options.variableMap ?? new Map());
    const elementStart = renderAtariStringArrayStart(source.indices[0], width, options);
    const elementEnd = renderAtariStringArrayEnd(source.indices[0], width, options);
    const sliceStart = renderAtariStringArrayOffset(elementStart, [start], -1, options);
    const sliceEnd = length ? renderAtariStringArrayOffset(elementStart, [start, length], -2, options) : elementEnd;
    return `${renderedName}(${sliceStart},${sliceEnd})`;
  }
  const renderedSource = renderExpression(source, options);
  if (!length) {
    return `${renderedSource}(${renderExpression(start, options)},LEN(${renderedSource}))`;
  }
  return `${renderedSource}(${renderExpression(start, options)},${renderExpression(start, options)} + ${renderExpression(length, options)} - 1)`;
}

function renderAtariLeft(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  const [source, length] = expression.args;
  return `${renderExpression(source, options)}(1,${renderExpression(length, options)})`;
}

function renderAtariRight(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  const [source, length] = expression.args;
  const renderedSource = renderExpression(source, options);
  return `${renderedSource}(LEN(${renderedSource}) - ${renderExpression(length, options)} + 1,LEN(${renderedSource}))`;
}

function buildUppercaseVariableMap(instructions: readonly Instruction[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();

  for (const instruction of instructions) {
    if (
      instruction.kind === "let" ||
      instruction.kind === "array-let" ||
      instruction.kind === "dim-array" ||
      instruction.kind === "read-key" ||
      instruction.kind === "read" ||
      instruction.kind === "for" ||
      instruction.kind === "next"
    ) {
      if (instruction.kind === "read") {
        for (const target of instruction.targets) {
          map.set(target.toLowerCase(), renderAtariVariableName(target));
        }
      } else {
        const name = instruction.kind === "for" || instruction.kind === "next" ? instruction.variable : instruction.name;
        map.set(name.toLowerCase(), renderAtariVariableName(name));
      }
    }
    for (const expression of instructionExpressions(instruction)) {
      collectIdentifiers(expression, map);
    }
  }

  return map;
}

function renderAtariVariableName(name: string): string {
  if (isStringVariableName(name)) {
    return name.toUpperCase();
  }

  const clean = baseVariableName(name).toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  const base = clean || "N";
  return isIntegerVariableName(name) ? `${base}I` : base;
}

function expandAtariKeyCodeAssignment(
  instruction: Extract<Instruction, { kind: "let" }>,
  allocateInternalLabel: () => string
): readonly Instruction[] {
  const gotKeyLabel = allocateInternalLabel();
  const endLabel = allocateInternalLabel();
  const keyCodeIdentifier: Expression = { kind: "identifier", name: instruction.name, location: instruction.location };

  return [
    {
      ...instruction,
      expression: { kind: "function-call", name: "PEEK", args: [{ kind: "number", value: 764, raw: "764", location: instruction.location }], location: instruction.location },
      location: instruction.location
    },
    {
      kind: "if-goto",
      condition: {
        kind: "binary",
        operator: "<>",
        left: keyCodeIdentifier,
        right: { kind: "number", value: 255, raw: "255", location: instruction.location },
        location: instruction.location
      },
      label: gotKeyLabel,
      location: instruction.location
    },
    { kind: "goto", label: endLabel, location: instruction.location },
    { kind: "label", name: gotKeyLabel, internal: true, location: instruction.location },
    { kind: "poke", address: 764, value: { kind: "number", value: 255, raw: "255", location: instruction.location }, location: instruction.location },
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


function collectIdentifiers(expression: Expression, map: Map<string, string>): void {
  switch (expression.kind) {
    case "identifier":
      map.set(expression.name.toLowerCase(), renderAtariVariableName(expression.name));
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
    case "function-call":
      for (const arg of expression.args) {
        collectIdentifiers(arg, map);
      }
      break;
    case "array-access":
      map.set(expression.name.toLowerCase(), renderAtariVariableName(expression.name));
      for (const index of expression.indices) {
        collectIdentifiers(index, map);
      }
      break;
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
}
