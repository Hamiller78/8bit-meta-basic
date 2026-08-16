import type { Expression } from "../ast.js";
import { builtinFunctions, isStringFunctionName } from "../functions.js";
import { resolveLabel } from "../line-numbering.js";
import type { ReadabilityLevel } from "../line-numbering.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { createFunctionRenderer, type FunctionCallExpression } from "./function-rendering.js";
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
      } else if (instruction.kind === "text-color") {
        const color = atariColorCodes[instruction.color.color];
        instructions.push({
          kind: "setcolor",
          register: 1,
          hue: color.hue,
          luminance: color.luminance,
          location: instruction.location
        });
      } else if (instruction.kind === "let" && instruction.name.endsWith("$")) {
        pushStringAssignment(instruction);
      } else if (instruction.kind === "print") {
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
    const renderOptions = { variableMap, functionRenderer: renderAtariFunction };

    switch (instruction.kind) {
      case "label":
        return `${lineNumber} REM ${instruction.name.toUpperCase()}:`;
      case "rem":
        return `${lineNumber} REM ${instruction.text.toUpperCase()}`;
      case "cls":
      case "border-color":
      case "text-color":
      case "paper":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for Atari 800XL.`);
      case "print":
        return `${lineNumber} PRINT ${renderPrintItems(instruction.items, instruction.trailingSemicolon, renderOptions)}`;
      case "let":
        return renderAtariAssignment(lineNumber, instruction, variableMap, renderOptions);
      case "dim-string":
        return `${lineNumber} DIM ${instruction.name.toUpperCase()}(${instruction.length})`;
      case "goto":
        return `${lineNumber} GOTO ${resolveLabel(labelLines, instruction.label)}`;
      case "if-goto":
        return `${lineNumber} IF ${renderExpression(instruction.condition, renderOptions)} THEN GOTO ${resolveLabel(labelLines, instruction.label)}`;
      case "position":
        return `${lineNumber} POSITION ${renderExpression(instruction.column, renderOptions)},${renderExpression(instruction.row, renderOptions)}`;
      case "setcolor":
        return `${lineNumber} SETCOLOR ${instruction.register},${instruction.hue},${instruction.luminance}`;
      case "print-chr":
        return `${lineNumber} PRINT CHR$(${instruction.code})${instruction.trailingSemicolon ? ";" : ""}`;
      case "poke":
      case "sys":
        throw new Error(`Internal error: unexpected ${instruction.kind} instruction for Atari 800XL.`);
    }
  }
};

let currentProgramInstructions: readonly Instruction[] = [];

export function setAtariRenderProgram(instructions: readonly Instruction[]): void {
  currentProgramInstructions = instructions;
}

function renderAtariAssignment(
  lineNumber: number,
  instruction: Extract<Instruction, { kind: "let" }>,
  variableMap: ReadonlyMap<string, string>,
  renderOptions: { readonly variableMap?: ReadonlyMap<string, string>; readonly functionRenderer: typeof renderAtariFunction }
): string {
  const targetName = variableMap.get(instruction.name.toLowerCase()) ?? instruction.name.toUpperCase();
  const appendExpression = stringSelfAppendRight(instruction.name, instruction.expression);
  if (appendExpression) {
    return `${lineNumber} ${targetName}(LEN(${targetName})+1)=${renderExpression(appendExpression, renderOptions)}`;
  }

  return `${lineNumber} ${targetName}=${renderExpression(instruction.expression, renderOptions)}`;
}

function stringSelfAppendRight(name: string, expression: Expression): Expression | undefined {
  if (!name.endsWith("$") || expression.kind !== "binary" || expression.operator !== "+") {
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
      return expression.name.endsWith("$");
    case "parenthesized":
      return isAtariStringExpression(expression.expression);
    case "binary":
      return expression.operator === "+" && isAtariStringExpression(expression.left) && isAtariStringExpression(expression.right);
    case "function-call":
      return isStringFunctionName(expression.name);
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
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
}

const renderAtariFunction = createFunctionRenderer(
  new Map([
    [builtinFunctions.jiffies, () => "PEEK(20) + PEEK(19) * 256 + PEEK(18) * 65536"],
    [builtinFunctions.len, renderAtariLen],
    [builtinFunctions.mid, renderAtariMid]
  ])
);

function renderAtariLen(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  return `LEN(${renderExpression(expression.args[0], options)})`;
}

function renderAtariMid(expression: FunctionCallExpression, options: { readonly variableMap?: ReadonlyMap<string, string> }): string {
  const [source, start, length] = expression.args;
  return `${renderExpression(source, options)}(${renderExpression(start, options)},${renderExpression(start, options)} + ${renderExpression(length, options)} - 1)`;
}

function buildUppercaseVariableMap(instructions: readonly Instruction[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();

  for (const instruction of instructions) {
    if (instruction.kind === "let") {
      map.set(instruction.name.toLowerCase(), instruction.name.toUpperCase());
    }
    for (const expression of instructionExpressions(instruction)) {
      collectIdentifiers(expression, map);
    }
  }

  return map;
}

function instructionExpressions(instruction: Instruction): readonly Expression[] {
  switch (instruction.kind) {
    case "print":
      return [...instruction.items, ...(instruction.at ? [instruction.at.row, instruction.at.column] : [])];
    case "let":
      return [instruction.expression];
    case "if-goto":
      return [instruction.condition];
    case "position":
      return [instruction.row, instruction.column];
    case "poke":
      return [instruction.value];
    case "cls":
    case "border-color":
    case "text-color":
    case "paper":
    case "setcolor":
    case "print-chr":
    case "dim-string":
    case "label":
    case "rem":
    case "goto":
    case "sys":
      return [];
  }
}

function collectIdentifiers(expression: Expression, map: Map<string, string>): void {
  switch (expression.kind) {
    case "identifier":
      map.set(expression.name.toLowerCase(), expression.name.toUpperCase());
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
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
}
