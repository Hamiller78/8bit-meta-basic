import type { Expression } from "../ast.js";
import type { Instruction } from "../lowering.js";
import { instructionExpressions } from "./instruction-expressions.js";

/** Collect all storage identifiers needed by a target's name allocator. */
export function collectVariableNames(instructions: readonly Instruction[]): ReadonlySet<string> {
  const names = new Set<string>();
  const collect = (expression: Expression): void => {
    switch (expression.kind) {
      case "identifier": names.add(expression.name); break;
      case "array-access": names.add(expression.name); expression.indices.forEach(collect); break;
      case "struct-field-access": names.add(expression.base); expression.indices.forEach(collect); break;
      case "function-call": expression.args.forEach(collect); break;
      case "parenthesized": collect(expression.expression); break;
      case "unary": collect(expression.operand); break;
      case "binary": collect(expression.left); collect(expression.right); break;
      default: break;
    }
  };
  const visit = (instruction: Instruction): void => {
    switch (instruction.kind) {
      case "let": case "check-device": case "check-data-file": case "read-key":
      case "dim-array": case "array-let": case "dim-string": names.add(instruction.name); break;
      case "multi-let": instruction.assignments.forEach((item) => names.add(item.name)); break;
      case "read": case "input": instruction.targets.forEach((name) => names.add(name)); break;
      case "for": case "next": names.add(instruction.variable); break;
      case "if-then": instruction.body.forEach(visit); break;
      case "print-device":
        if (instruction.textBufferName) names.add(instruction.textBufferName);
        if (instruction.textIndexName) names.add(instruction.textIndexName);
        break;
      case "read-data-file-status":
        [instruction.errorCodeName, instruction.errorMessageName, instruction.trackName, instruction.sectorName].forEach((name) => names.add(name));
        break;
      default: break;
    }
    instructionExpressions(instruction).forEach(collect);
  };
  instructions.forEach(visit);
  return names;
}

