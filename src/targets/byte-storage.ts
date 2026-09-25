import type { Expression } from "../ast.js";
import { builtinFunctions } from "../functions.js";
import type { Instruction, LoweredProgram } from "../lowering.js";
import { rebuildLabels } from "./target.js";
import { mapInstructionExpressions } from "./instruction-expressions.js";
import { allocateGeneratedVariableName } from "./string-array-lengths.js";

export type ByteStorageTarget = "spectrum" | "atari800xl" | "c64";

/** Select compact target storage while keeping BYTE expressions numerically typed. */
export function lowerByteStorage(program: LoweredProgram, target: ByteStorageTarget): LoweredProgram {
  const suffix = target === "c64" ? "%" : "$";
  const byteNames = collectByteStorageNames(program.instructions);
  if (byteNames.size === 0) return program;

  const targetNames = new Map([...byteNames].map((name) => [name, `${stripTypeSuffix(name)}_MBBYTE${suffix}`]));
  const rewriteExpression = (expression: Expression): Expression => rewriteByteExpression(expression, target, targetNames);
  const rewritten = program.instructions.map((source): Instruction => {
    const instruction = mapInstructionExpressions(source, rewriteExpression);
    switch (instruction.kind) {
      case "let":
      case "array-let":
      case "dim-array":
      case "dim-string":
      case "read-key":
      case "check-device":
        return { ...instruction, name: targetNames.get(instruction.name.toLowerCase()) ?? instruction.name };
      case "multi-let":
        return {
          ...instruction,
          assignments: instruction.assignments.map((assignment) => ({
            ...assignment,
            name: targetNames.get(assignment.name.toLowerCase()) ?? assignment.name
          }))
        };
      case "read":
        return { ...instruction, targets: instruction.targets.map((name) => targetNames.get(name.toLowerCase()) ?? name) };
      default:
        return instruction;
    }
  });

  if (target === "c64") return rebuildLabels(program, rewritten);

  const initializationLoopName = allocateGeneratedVariableName(rewritten, "MBBYTEINIT");
  const initialized: Instruction[] = [];
  for (const instruction of rewritten) {
    initialized.push(instruction);
    if (instruction.kind !== "dim-array" || instruction.storageType !== "byte") continue;
    const count = instruction.dimensions[0];
    initialized.push(
      {
        kind: "for",
        variable: initializationLoopName,
        start: numberExpression(0, instruction.location),
        limit: numberExpression(count - 1, instruction.location),
        location: instruction.location
      },
      {
        kind: "array-let",
        name: instruction.name,
        indices: [{ kind: "identifier", name: initializationLoopName, location: instruction.location }],
        expression: numberExpression(0, instruction.location),
        storageType: "byte",
        location: instruction.location
      },
      { kind: "next", variable: initializationLoopName, location: instruction.location }
    );
  }
  return rebuildLabels(program, initialized);
}

function collectByteStorageNames(instructions: readonly Instruction[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const instruction of instructions) {
    if ((instruction.kind === "dim-array" || instruction.kind === "array-let" || instruction.kind === "let") && instruction.storageType === "byte") {
      names.add(instruction.name.toLowerCase());
    }
  }
  return names;
}

function rewriteByteExpression(
  expression: Expression,
  target: ByteStorageTarget,
  targetNames: ReadonlyMap<string, string>
): Expression {
  const rewrite = (child: Expression): Expression => rewriteByteExpression(child, target, targetNames);
  switch (expression.kind) {
    case "identifier": {
      const name = targetNames.get(expression.name.toLowerCase()) ?? expression.name;
      const raw = { ...expression, name, valueType: undefined };
      return expression.valueType === "byte" && target !== "c64" ? byteRead(raw, target) : raw;
    }
    case "array-access": {
      const raw = {
        ...expression,
        name: targetNames.get(expression.name.toLowerCase()) ?? expression.name,
        indices: expression.indices.map(rewrite),
        ...(expression.fixedWidthStorageLength ? { fixedWidthStorageLength: rewrite(expression.fixedWidthStorageLength) } : {}),
        ...(expression.fixedWidthStorageStart ? { fixedWidthStorageStart: rewrite(expression.fixedWidthStorageStart) } : {})
      };
      return expression.valueType === "byte" && target !== "c64" ? byteRead(raw, target) : raw;
    }
    case "function-call":
      return { ...expression, args: expression.args.map(rewrite) };
    case "parenthesized":
      return { ...expression, expression: rewrite(expression.expression) };
    case "unary":
      return { ...expression, operand: rewrite(expression.operand) };
    case "binary":
      return { ...expression, left: rewrite(expression.left), right: rewrite(expression.right) };
    case "struct-field-access":
      return { ...expression, indices: expression.indices.map(rewrite) };
    case "number":
    case "string":
    case "boolean":
    case "color":
      return expression;
  }
}

function byteRead(expression: Expression, target: Exclude<ByteStorageTarget, "c64">): Expression {
  return {
    kind: "function-call",
    name: target === "spectrum" ? builtinFunctions.code : builtinFunctions.asc,
    args: [expression],
    valueType: "number",
    location: expression.location
  };
}

function stripTypeSuffix(name: string): string {
  return name.replace(/[$%]$/u, "");
}

function numberExpression(value: number, location: Expression["location"]): Extract<Expression, { kind: "number" }> {
  return { kind: "number", value, raw: value.toString(), location };
}
