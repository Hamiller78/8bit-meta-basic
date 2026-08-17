import type { Expression } from "../ast.js";
import { builtinFunctions } from "../functions.js";
import { resolveLabel } from "../line-numbering.js";
import type { ReadabilityLevel } from "../line-numbering.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { normalizeLabel } from "../lowering.js";
import { createFunctionRenderer, type FunctionCallExpression } from "./function-rendering.js";
import { c64ColorCodes, expandPositionedPrints, rebuildLabels, renderExpression, renderPrintItems, type TargetBackend } from "./target.js";

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
    const withKeyboardInput = expandKeyboardInput(withScreenControls);
    return readability === 1 ? addCompactVariableComments(withKeyboardInput) : withKeyboardInput;
  },
  renderLine(lineNumber: number, instruction: Instruction, labelLines: ReadonlyMap<string, number>, readability: ReadabilityLevel): string {
    const variableMap = buildVariableMap(currentProgramInstructions, readability);
    const renderOptions = { variableMap, functionRenderer: renderC64Function };

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
      case "paper":
      case "setcolor":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for C64.`);
      case "print":
        return `${lineNumber} PRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`;
      case "let":
        return `${lineNumber} ${renderVariableName(instruction.name, variableMap)}=${renderExpression(instruction.expression, renderOptions)}`;
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
      case "for":
        return `${lineNumber} FOR ${renderVariableName(instruction.variable, variableMap)}=${renderExpression(instruction.start, renderOptions)} TO ${renderExpression(instruction.limit, renderOptions)}${instruction.step ? ` STEP ${renderExpression(instruction.step, renderOptions)}` : ""}`;
      case "next":
        return `${lineNumber} NEXT ${renderVariableName(instruction.variable, variableMap)}`;
      case "if-goto":
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN GOTO ${resolveLabel(labelLines, instruction.label)}`;
      case "position":
        throw new Error("Internal error: unexpected position instruction for C64.");
      case "poke":
        return `${lineNumber} POKE ${instruction.address},${renderExpression(instruction.value, renderOptions)}`;
      case "print-chr":
        return `${lineNumber} PRINT CHR$(${instruction.code})${instruction.trailingSemicolon ? ";" : ""}`;
      case "sys":
        return `${lineNumber} SYS ${instruction.address}`;
    }
  }
};

let currentProgramInstructions: readonly Instruction[] = [];

export function setC64RenderProgram(instructions: readonly Instruction[]): void {
  currentProgramInstructions = instructions;
}

const renderKnownC64Function = createFunctionRenderer(
  new Map([
    [builtinFunctions.jiffies, () => "TI"],
    [builtinFunctions.len, renderC64Len],
    [builtinFunctions.mid, renderC64Mid]
  ])
);

function renderC64Function(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string | undefined {
  if (expression.name.toUpperCase() === "ASC") {
    return `ASC(${renderExpression(expression.args[0], options)})`;
  }

  return renderKnownC64Function(expression, options);
}

function renderC64Len(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `LEN(${renderExpression(expression.args[0], options)})`;
}

function renderC64Mid(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `MID$(${expression.args.map((arg) => renderExpression(arg, options)).join(",")})`;
}

function buildVariableMap(instructions: readonly Instruction[], readability: ReadabilityLevel): ReadonlyMap<string, string> {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const instruction of instructions) {
    if (instruction.kind === "let" || instruction.kind === "read-key" || instruction.kind === "for" || instruction.kind === "next") {
      const name = instruction.kind === "for" || instruction.kind === "next" ? instruction.variable : instruction.name;
      if (!seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        names.push(name);
      }
    }
    for (const expression of instructionExpressions(instruction)) {
      collectIdentifiers(expression, names, seen);
    }
  }

  const groups = new Map<string, string[]>();
  for (const name of names) {
    const key = significantName(name);
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }

  const map = new Map<string, string>();
  const allocated = new Set<string>();

  if (readability === 2) {
    for (const name of names) {
      const key = significantName(name);
      const group = groups.get(key) ?? [];
      if (group.length === 1 && !reservedNames.has(key.slice(0, 2))) {
        map.set(name.toLowerCase(), name.toUpperCase());
        allocated.add(key);
      }
    }
  }

  let next = 0;
  for (const name of names) {
    const lower = name.toLowerCase();
    if (map.has(lower)) {
      continue;
    }

    const preferred = preferredVariableName(name);
    const candidate = preferred && canAllocate(preferred, allocated) ? preferred : nextGeneratedVariableName(name, allocated, () => next++);
    map.set(lower, candidate);
    allocated.add(significantName(candidate));
  }

  return map;
}

function renderVariableName(name: string, variableMap: ReadonlyMap<string, string>): string {
  return variableMap.get(name.toLowerCase()) ?? name.toUpperCase();
}

function instructionExpressions(instruction: Instruction): readonly Expression[] {
  switch (instruction.kind) {
    case "print":
      return [...instruction.items, ...(instruction.at ? [instruction.at.row, instruction.at.column] : [])];
    case "let":
      return [instruction.expression];
    case "read-key":
      return [];
    case "for":
      return [instruction.start, instruction.limit, ...(instruction.step ? [instruction.step] : [])];
    case "if-goto":
      return [instruction.condition];
    case "position":
      return [instruction.row, instruction.column];
    case "poke":
      return [instruction.value];
    case "cls":
    case "border-color":
    case "text-color":
    case "screen-background-color":
    case "cell-text-color":
    case "cell-background-color":
    case "paper":
    case "setcolor":
    case "print-chr":
    case "dim-string":
    case "label":
    case "rem":
    case "goto":
    case "gosub":
    case "return":
    case "next":
    case "sys":
      return [];
  }
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
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
}

function significantName(name: string): string {
  const suffix = isStringVariableName(name) ? "$" : "";
  const base = name.toUpperCase().replaceAll(/[^A-Z0-9]/g, "").slice(0, 2).padEnd(2, "_");
  return `${base}${suffix}`;
}

const reservedNames = new Set(["TO", "IF", "GO", "ON", "OR", "AN", "NO", "PR", "PO", "SY", "RE", "ST", "TH", "TI"]);

function preferredVariableName(name: string): string | undefined {
  const clean = name.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  if (clean.length === 0) {
    return undefined;
  }

  return `${clean.slice(0, 2)}${isStringVariableName(name) ? "$" : ""}`;
}

function nextGeneratedVariableName(name: string, allocated: ReadonlySet<string>, next: () => number): string {
  while (true) {
    const candidate = `V${next().toString(36).toUpperCase()}${isStringVariableName(name) ? "$" : ""}`;
    if (canAllocate(candidate, allocated)) {
      return candidate;
    }
  }
}

function canAllocate(name: string, allocated: ReadonlySet<string>): boolean {
  const key = significantName(name);
  return !allocated.has(key) && !reservedNames.has(key.slice(0, 2));
}

function isStringVariableName(name: string): boolean {
  return name.endsWith("$");
}

function addCompactVariableComments(program: LoweredProgram): LoweredProgram {
  const variableMap = buildVariableMap(program.instructions, 0);
  const instructions: Instruction[] = [];
  const commented = new Set<string>();

  for (const instruction of program.instructions) {
    if (instruction.kind === "let" || instruction.kind === "read-key") {
      const key = instruction.name.toLowerCase();
      if (!commented.has(key)) {
        const compactName = renderVariableName(instruction.name, variableMap);
        instructions.push({
          kind: "rem",
          text: `${compactName}=${instruction.name.toUpperCase()}`,
          location: instruction.location
        });
        commented.add(key);
      }
    }

    instructions.push(instruction);
  }

  return rebuildLabels(program, instructions);
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
    } else if (instruction.kind === "cell-background-color") {
      continue;
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
    !instruction.name.endsWith("$") &&
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
