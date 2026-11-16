import type { Instruction } from "../lowering.js";
import { collectVariableNames } from "./variable-names.js";
import { DiagnosticError } from "../diagnostics.js";

// HC-BASIC recognises only two characters and tokenises keywords inside names.
// Use a deliberately restricted namespace of letter-digit pairs: none contains
// a BASIC keyword, and integer variables use ordinary numeric storage.
export function kc85VariableMap(instructions: readonly Instruction[]): ReadonlyMap<string, string> {
  return allocateKc85VariableNames(collectVariableNames(instructions), instructions[0]?.location);
}

export function allocateKc85VariableNames(names: Iterable<string>, location = { filename: "<generated>", line: 1 }): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const next = { numeric: 0, string: 0 };
  for (const original of names) {
    const key = original.toLowerCase();
    if (result.has(key)) continue;
    const type = original.endsWith("$") ? "string" : "numeric";
    const index = next[type]++;
    if (index >= 260) {
      throw new DiagnosticError(location,
        `KC 85 HC-BASIC requires more than 260 ${type} variable names.`);
    }
    result.set(key, `${String.fromCharCode(65 + Math.floor(index / 10))}${index % 10}${type === "string" ? "$" : ""}`);
  }
  return result;
}
