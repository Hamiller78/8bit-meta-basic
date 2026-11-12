import type { Expression } from "../ast.js";
import type { Instruction } from "../lowering.js";
import { instructionExpressions } from "./instruction-expressions.js";

/** Collect storage names from lowered instructions, including nested expressions. */
export function cpcVariableMap(instructions: readonly Instruction[]): ReadonlyMap<string, string> {
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
  return allocateCpcVariableNames(names);
}

/** Allocate distinct Locomotive BASIC names, preserving readable source names. */
export function allocateCpcVariableNames(names: Iterable<string>): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const original of names) {
    const key = original.toLowerCase();
    if (result.has(key)) continue;
    const suffix = /[$%]$/u.test(original) ? original.slice(-1) : "";
    const source = original.replace(/[$%]$/u, "").toUpperCase().replace(/[^A-Z0-9.]/gu, ".");
    // A prefix ensures the first character is a letter and avoids a bare keyword.
    const base = `V.${source || "VALUE"}`;
    let serial = 0;
    let candidate: string;
    do {
      const disambiguator = serial ? `.${serial}` : "";
      candidate = `${base.slice(0, 40 - suffix.length - disambiguator.length)}${disambiguator}${suffix}`;
      serial += 1;
    } while (used.has(candidate));
    result.set(key, candidate);
    used.add(candidate);
  }
  return result;
}
