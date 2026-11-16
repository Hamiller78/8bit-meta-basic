import type { Instruction } from "../lowering.js";
import { collectVariableNames } from "./variable-names.js";

/** Allocate CPC storage names from lowered instructions. */
export function cpcVariableMap(instructions: readonly Instruction[]): ReadonlyMap<string, string> {
  return allocateCpcVariableNames(collectVariableNames(instructions));
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
