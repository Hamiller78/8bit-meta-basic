import type { Expression } from "../ast.js";
import type { DeviceKind } from "../devices.js";
import { builtinFunctions, isStringFunctionName } from "../functions.js";
import { joystickControl } from "../joystick.js";
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
      } else if (instruction.kind === "program-mode") {
        instructions.push({
          kind: "poke",
          address: 752,
          value: {
            kind: "number",
            value: 1,
            raw: "1",
            location: instruction.location
          },
          location: instruction.location
        });
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
      } else if (instruction.kind === "dim-array" && isStringVariableName(instruction.name)) {
        instructions.push(instruction, ...createAtariStringArrayInitialization(instruction));
      } else if (instruction.kind === "print" || instruction.kind === "print-device") {
        const beforePrint: Instruction[] = [];
        const items = instruction.items.map((item) => {
          const preservedItem = preserveComputedAtariSliceSources(item, beforePrint, allocateTempStringName, ensureStringDim);
          if (!isStringConcatenation(preservedItem)) {
            return preservedItem;
          }

          const tempName = allocateTempStringName();
          ensureStringDim(tempName, preservedItem.location);
          beforePrint.push(
            ...expandAtariStringAssignment(
              { kind: "let", name: tempName, expression: preservedItem, location: preservedItem.location },
              allocateTempStringName,
              ensureStringDim
            )
          );
          return { kind: "identifier", name: tempName, location: preservedItem.location } satisfies Expression;
        });
        instructions.push(...beforePrint, { ...instruction, items });
      } else {
        instructions.push(instruction);
      }
    }
    return rebuildLabels(expanded, hoistAtariStringDimensions(instructions));
  },
  renderLine(lineNumber: number, instruction: Instruction, labelLines: ReadonlyMap<string, number>, readability: ReadabilityLevel): string {
    const variableMap = buildAtariVariableMap(currentProgramInstructions, readability);
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
      case "program-mode":
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
        return `${lineNumber} DIM ${variableMap.get(instruction.name.toLowerCase()) ?? renderAtariVariableName(instruction.name)}(${instruction.length})`;
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

function hoistAtariStringDimensions(instructions: readonly Instruction[]): readonly Instruction[] {
  const dimStrings: Extract<Instruction, { kind: "dim-string" }>[] = [];
  const seen = new Set<string>();
  const body: Instruction[] = [];

  for (const instruction of instructions) {
    if (instruction.kind !== "dim-string") {
      body.push(instruction);
      continue;
    }

    const key = instruction.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      dimStrings.push(instruction);
    }
  }

  return [...dimStrings, ...body];
}

let currentProgramInstructions: readonly Instruction[] = [];
let currentSharedDriveSpec = "H6:MCP.TXT";

export function setAtariRenderProgram(instructions: readonly Instruction[]): void {
  currentProgramInstructions = instructions;
}

export function setAtariSharedDriveSpec(spec: string | undefined): void {
  currentSharedDriveSpec = spec ?? "H6:MCP.TXT";
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

function atariDeviceSpec(device: DeviceKind): string {
  switch (device) {
    case "rs232":
      return "R:";
    case "shared-drive":
      return currentSharedDriveSpec;
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

  return `${renderExpressionWithParens(index, options)} * ${width} + 1`;
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

function renderExpressionWithParens(
  expression: Expression,
  options: { readonly variableMap?: ReadonlyMap<string, string>; readonly functionRenderer?: typeof renderAtariFunction; readonly arrayRenderer?: typeof renderAtariArrayAccess }
): string {
  return expression.kind === "number" || expression.kind === "identifier" ? renderExpression(expression, options) : `(${renderExpression(expression, options)})`;
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
  const prefix: Instruction[] = [];
  const expression = preserveComputedAtariSliceSources(instruction.expression, prefix, allocateTempStringName, ensureStringDim);
  const parts = flattenStringConcatenation(expression);
  if (!parts) {
    return [...prefix, { ...instruction, expression }];
  }

  const leadingSelfAppend = isIdentifierNamed(parts[0], instruction.name);
  const needsTemp = !leadingSelfAppend && expressionReferencesName(expression, instruction.name);
  const targetName = needsTemp ? allocateTempStringName() : instruction.name;
  const instructions: Instruction[] = [...prefix];
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

function createAtariStringArrayInitialization(instruction: Extract<Instruction, { kind: "dim-array" }>): readonly Instruction[] {
  const totalLength = instruction.dimensions.reduce((product, dimension) => product * dimension, 1);
  const chunkSize = 64;
  const chunks = Math.ceil(totalLength / chunkSize);
  const instructions: Instruction[] = [];

  for (let index = 0; index < chunks; index += 1) {
    const length = Math.min(chunkSize, totalLength - index * chunkSize);
    const chunk: Expression = { kind: "string", value: " ".repeat(length), location: instruction.location };
    instructions.push({
      kind: "let",
      name: instruction.name,
      expression:
        index === 0
          ? chunk
          : {
              kind: "binary",
              operator: "+",
              left: { kind: "identifier", name: instruction.name, location: instruction.location },
              right: chunk,
              location: instruction.location
            },
      location: instruction.location
    });
  }

  return instructions;
}

function preserveComputedAtariSliceSources(
  expression: Expression,
  instructions: Instruction[],
  allocateTempStringName: () => string,
  ensureStringDim: (name: string, location: Expression["location"]) => void
): Expression {
  switch (expression.kind) {
    case "function-call": {
      const args = expression.args.map((arg) => preserveComputedAtariSliceSources(arg, instructions, allocateTempStringName, ensureStringDim));
      if (isAtariStringSliceFunction(expression.name) && args[0] && !isDirectAtariSliceSource(args[0])) {
        const tempName = allocateTempStringName();
        ensureStringDim(tempName, args[0].location);
        instructions.push({ kind: "let", name: tempName, expression: args[0], location: args[0].location });
        return { ...expression, args: [{ kind: "identifier", name: tempName, location: args[0].location }, ...args.slice(1)] };
      }
      return { ...expression, args };
    }
    case "parenthesized":
      return { ...expression, expression: preserveComputedAtariSliceSources(expression.expression, instructions, allocateTempStringName, ensureStringDim) };
    case "unary":
      return { ...expression, operand: preserveComputedAtariSliceSources(expression.operand, instructions, allocateTempStringName, ensureStringDim) };
    case "binary":
      return {
        ...expression,
        left: preserveComputedAtariSliceSources(expression.left, instructions, allocateTempStringName, ensureStringDim),
        right: preserveComputedAtariSliceSources(expression.right, instructions, allocateTempStringName, ensureStringDim)
      };
    case "array-access":
      return {
        ...expression,
        indices: expression.indices.map((index) => preserveComputedAtariSliceSources(index, instructions, allocateTempStringName, ensureStringDim))
      };
    case "struct-field-access":
      return {
        ...expression,
        indices: expression.indices.map((index) => preserveComputedAtariSliceSources(index, instructions, allocateTempStringName, ensureStringDim))
      };
    case "number":
    case "string":
    case "boolean":
    case "color":
    case "identifier":
      return expression;
  }
}

function isAtariStringSliceFunction(name: string): boolean {
  return name === builtinFunctions.left || name === builtinFunctions.mid || name === builtinFunctions.right;
}

function isDirectAtariSliceSource(expression: Expression): boolean {
  if (expression.kind === "parenthesized") {
    return isDirectAtariSliceSource(expression.expression);
  }
  return expression.kind === "identifier" || expression.kind === "string" || expression.kind === "array-access";
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
    case "struct-field-access":
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
    case "struct-field-access":
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
    [builtinFunctions.jiffies, () => "(PEEK(20) + PEEK(19) * 256 + PEEK(18) * 65536)"],
    [builtinFunctions.keyPressed, () => "(PEEK(764) <> 255)"],
    // Active-low STICK bits: up, down, left, right. Subtract opposing bits.
    [builtinFunctions.getJoystick, expression => [
      "(INT(STICK(0) / 4) - 3 * INT(STICK(0) / 8))",
      "(STICK(0) - 3 * INT(STICK(0) / 2) + 2 * INT(STICK(0) / 4))",
      "(1 - STRIG(0))"
    ][joystickControl(expression.args[0])]],
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
  if (source.kind === "array-access" && isStringVariableName(source.name)) {
    const width = atariStringArrayWidth(source.name);
    const renderedName = renderAtariArrayName(source.name, options.variableMap ?? new Map());
    const elementStart = renderAtariStringArrayStart(source.indices[0], width, options);
    const sliceEnd = renderAtariStringArrayOffset(elementStart, [length], -1, options);
    return `${renderedName}(${elementStart},${sliceEnd})`;
  }
  return `${renderExpression(source, options)}(1,${renderExpression(length, options)})`;
}

function renderAtariRight(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  const [source, length] = expression.args;
  const renderedSource = renderExpression(source, options);
  return `${renderedSource}(LEN(${renderedSource}) - ${renderExpression(length, options)} + 1,LEN(${renderedSource}))`;
}

function buildAtariVariableMap(instructions: readonly Instruction[], readability: ReadabilityLevel): ReadonlyMap<string, string> {
  return readability === 2 ? buildUppercaseVariableMap(instructions) : buildCompactAtariVariableMap(instructions);
}

function buildUppercaseVariableMap(instructions: readonly Instruction[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();

  for (const instruction of instructions) {
    if (
      instruction.kind === "let" ||
      instruction.kind === "array-let" ||
      instruction.kind === "dim-array" ||
      instruction.kind === "dim-string" ||
      instruction.kind === "read-key" ||
      instruction.kind === "check-device" ||
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
  const clean = baseVariableName(name).toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  const base = clean || "N";
  if (isStringVariableName(name)) {
    return `${base}$`;
  }

  return isIntegerVariableName(name) ? `${base}I` : base;
}

function buildCompactAtariVariableMap(instructions: readonly Instruction[]): ReadonlyMap<string, string> {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const instruction of instructions) {
    for (const name of instructionVariableNames(instruction)) {
      addAtariVariableName(name, names, seen);
    }
    for (const expression of instructionExpressions(instruction)) {
      collectCompactIdentifiers(expression, names, seen);
    }
  }

  const map = new Map<string, string>();
  const allocated = new Set<string>();
  let next = 0;

  for (const name of names) {
    const key = name.toLowerCase();
    if (map.has(key)) {
      continue;
    }

    const suffix = isStringVariableName(name) ? "$" : "";
    let candidate: string;
    do {
      candidate = `${atariCompactStem(next)}${suffix}`;
      next += 1;
    } while (allocated.has(candidate) || isReservedAtariCompactName(candidate));

    allocated.add(candidate);
    map.set(key, candidate);
  }

  return map;
}

function instructionVariableNames(instruction: Instruction): readonly string[] {
  switch (instruction.kind) {
    case "let":
    case "array-let":
    case "dim-array":
    case "dim-string":
    case "read-key":
    case "check-device":
      return [instruction.name];
    case "read":
      return instruction.targets;
    case "multi-let":
      return instruction.assignments.map((assignment) => assignment.name);
    case "for":
    case "next":
      return [instruction.variable];
    case "label":
    case "rem":
    case "cls":
    case "border-color":
    case "text-color":
    case "screen-background-color":
    case "cell-text-color":
    case "cell-background-color":
    case "suppress-scroll-prompt":
    case "program-mode":
    case "paper":
    case "print":
    case "open-device":
    case "print-device":
    case "close-device":
    case "trap":
    case "wait-rs232-transmit":
    case "data":
    case "restore":
    case "randomize":
    case "goto":
    case "gosub":
    case "return":
    case "end":
    case "if-goto":
    case "position":
    case "setcolor":
    case "poke":
    case "print-chr":
    case "sys":
      return [];
  }
}

function addAtariVariableName(name: string, names: string[], seen: Set<string>): void {
  const key = name.toLowerCase();
  if (!seen.has(key)) {
    seen.add(key);
    names.push(name);
  }
}

function atariCompactStem(index: number): string {
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

const atariReservedNamePrefixes = new Set([
  "BY",
  "CL",
  "CO",
  "CS",
  "DA",
  "DE",
  "DI",
  "DR",
  "EN",
  "FO",
  "GE",
  "GO",
  "GR",
  "IF",
  "IN",
  "LE",
  "LI",
  "LO",
  "NE",
  "NO",
  "ON",
  "OP",
  "PO",
  "PR",
  "PU",
  "RE",
  "RU",
  "SE",
  "ST",
  "TH",
  "TO",
  "TR"
]);

function isReservedAtariCompactName(name: string): boolean {
  const clean = baseVariableName(name).toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  return atariReservedNamePrefixes.has(clean.slice(0, 2));
}

function collectCompactIdentifiers(expression: Expression, names: string[], seen: Set<string>): void {
  switch (expression.kind) {
    case "identifier":
      addAtariVariableName(expression.name, names, seen);
      break;
    case "parenthesized":
      collectCompactIdentifiers(expression.expression, names, seen);
      break;
    case "unary":
      collectCompactIdentifiers(expression.operand, names, seen);
      break;
    case "binary":
      collectCompactIdentifiers(expression.left, names, seen);
      collectCompactIdentifiers(expression.right, names, seen);
      break;
    case "function-call":
      for (const arg of expression.args) {
        collectCompactIdentifiers(arg, names, seen);
      }
      break;
    case "array-access":
      addAtariVariableName(expression.name, names, seen);
      for (const index of expression.indices) {
        collectCompactIdentifiers(index, names, seen);
      }
      break;
    case "struct-field-access":
      addAtariVariableName(expression.base, names, seen);
      for (const index of expression.indices) {
        collectCompactIdentifiers(index, names, seen);
      }
      break;
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
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
