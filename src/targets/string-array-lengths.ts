import type { Expression } from "../ast.js";
import type { DimArrayInstruction, Instruction } from "../lowering.js";
import { isStringVariableName } from "../variables.js";
import { instructionExpressions } from "./instruction-expressions.js";

export interface StringArrayStorage {
  readonly name: string;
  readonly count: number;
  readonly width: number;
  readonly lengthArrayName: string;
}

export function buildStringArrayStorage(instructions: readonly Instruction[]): ReadonlyMap<string, StringArrayStorage> {
  const used = collectInstructionNames(instructions);
  const storage = new Map<string, StringArrayStorage>();
  let next = 1;

  for (const instruction of instructions) {
    if (instruction.kind !== "dim-array" || instruction.storageType === "byte" || !isStringVariableName(instruction.name)) {
      continue;
    }

    let lengthArrayName: string;
    do {
      lengthArrayName = `MBL${next}`;
      next += 1;
    } while (used.has(lengthArrayName.toLowerCase()));
    used.add(lengthArrayName.toLowerCase());

    storage.set(instruction.name.toLowerCase(), {
      name: instruction.name,
      count: instruction.dimensions[0],
      width: instruction.dimensions[1],
      lengthArrayName
    });
  }

  return storage;
}

export function attachStringArrayLengthDimension(
  instruction: Extract<Instruction, { kind: "dim-array" }>,
  definition: StringArrayStorage
): readonly DimArrayInstruction[] {
  return [
    { ...instruction, logicalLengthArrayName: definition.lengthArrayName },
    {
      kind: "dim-array",
      name: definition.lengthArrayName,
      dimensions: [definition.count],
      location: instruction.location
    }
  ];
}

export function stringArrayStorageFor(
  name: string,
  storage: ReadonlyMap<string, StringArrayStorage>
): StringArrayStorage | undefined {
  return storage.get(name.toLowerCase());
}

export function logicalLengthAccess(definition: StringArrayStorage, index: Expression): Expression {
  return {
    kind: "array-access",
    name: definition.lengthArrayName,
    indices: [index],
    valueType: "number",
    location: index.location
  };
}

export function allocateGeneratedVariableName(instructions: readonly Instruction[], stem: string, suffix = ""): string {
  return createGeneratedVariableNameAllocator(instructions, stem, suffix)();
}

export function createGeneratedVariableNameAllocator(
  instructions: readonly Instruction[],
  stem: string,
  suffix = ""
): () => string {
  const used = collectInstructionNames(instructions);
  let next = 0;
  return () => {
    while (true) {
      const candidate = `${stem}${next === 0 ? "" : next}${suffix}`;
      next += 1;
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase());
        return candidate;
      }
    }
  };
}

function collectInstructionNames(instructions: readonly Instruction[]): Set<string> {
  const used = new Set<string>();
  for (const instruction of instructions) {
    switch (instruction.kind) {
      case "let":
      case "array-let":
      case "dim-array":
      case "dim-string":
      case "read-key":
      case "check-device":
        used.add(instruction.name.toLowerCase());
        break;
      case "multi-let":
        for (const assignment of instruction.assignments) used.add(assignment.name.toLowerCase());
        break;
      case "read":
        for (const target of instruction.targets) used.add(target.toLowerCase());
        break;
      case "for":
      case "next":
        used.add(instruction.variable.toLowerCase());
        break;
      default:
        break;
    }
    for (const expression of instructionExpressions(instruction)) collectExpressionNames(expression, used);
  }
  return used;
}

function collectExpressionNames(expression: Expression, used: Set<string>): void {
  switch (expression.kind) {
    case "identifier":
      used.add(expression.name.toLowerCase());
      break;
    case "array-access":
      used.add(expression.name.toLowerCase());
      for (const index of expression.indices) collectExpressionNames(index, used);
      if (expression.fixedWidthStorageLength) collectExpressionNames(expression.fixedWidthStorageLength, used);
      if (expression.fixedWidthStorageStart) collectExpressionNames(expression.fixedWidthStorageStart, used);
      break;
    case "struct-field-access":
      used.add(expression.base.toLowerCase());
      for (const index of expression.indices) collectExpressionNames(index, used);
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
      for (const arg of expression.args) collectExpressionNames(arg, used);
      break;
    case "number":
    case "string":
    case "boolean":
    case "color":
      break;
  }
}
