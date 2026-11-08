import { describe, expect, it } from "vitest";
import type { Expression, SourceLocation } from "../src/ast.js";
import type { Instruction, LoweredProgram } from "../src/lowering.js";
import { removeRedundantCopies } from "../src/redundant-copy-optimization.js";

const location: SourceLocation = { filename: "copies.mbas", line: 1, column: 1 };
const reference = (name: string): Expression => ({ kind: "identifier", name, location });
const copy = (name: string, source: string): Instruction => ({ kind: "let", name, expression: reference(source), location });
const label = (name: string): Instruction => ({ kind: "label", name, internal: true, location });
const call = (name: string): Instruction => ({ kind: "gosub", label: name, location });
const ret = (): Instruction => ({ kind: "return", location });
const end = (): Instruction => ({ kind: "end", location });
const optimize = (instructions: Instruction[]): readonly Instruction[] => removeRedundantCopies({ instructions, labels: new Map() } satisfies LoweredProgram).instructions;
const countCopies = (instructions: readonly Instruction[], destination: string): number => instructions.filter((instruction) => instruction.kind === "let" && instruction.name === destination).length;

describe("redundant numeric copies", () => {
  it("removes repeated parameter setup across calls and fall-through conditions", () => {
    const result = optimize([
      copy("P%", "X%"), copy("Q%", "Y%"), call("first"),
      { kind: "if-goto", condition: reference("R"), label: "done", location },
      copy("P%", "X%"), copy("Q%", "Y%"), call("second"), copy("P%", "X%"), copy("Q%", "Y%"),
      label("done"), end(), label("first"), copy("R", "Z"), ret(), label("second"), ret()
    ]);
    expect(countCopies(result, "P%")).toBe(1);
    expect(countCopies(result, "Q%")).toBe(1);
  });

  it.each(["P%", "X%"])("keeps the copy when a nested callee changes %s", (changed) => {
    const result = optimize([copy("P%", "X%"), call("outer"), copy("P%", "X%"), end(), label("outer"), call("inner"), ret(), label("inner"), copy(changed, "Z%"), ret()]);
    expect(countCopies(result, "P%")).toBe(changed === "P%" ? 3 : 2);
  });

  it("keeps copies across unknown side effects and labels", () => {
    const result = optimize([copy("P%", "X%"), call("opaque"), copy("P%", "X%"), label("join"), copy("P%", "X%"), end(), label("opaque"), { kind: "poke", address: 1, value: reference("X%"), location }, ret()]);
    expect(countCopies(result, "P%")).toBe(3);
  });

  it("does not discard string assignments", () => {
    const result = optimize([copy("P$", "X$"), copy("P$", "X$"), end()]);
    expect(countCopies(result, "P$")).toBe(2);
  });

  it("accounts for a conditional callee write on either branch", () => {
    const result = optimize([copy("P%", "X%"), call("conditional"), copy("P%", "X%"), end(), label("conditional"), { kind: "if-goto", condition: reference("R"), label: "done", location }, copy("X%", "Z%"), label("done"), ret()]);
    expect(countCopies(result, "P%")).toBe(2);
  });

  it("accounts for writes in a callee loop", () => {
    const number = (value: number): Expression => ({ kind: "number", value, raw: String(value), location });
    const result = optimize([
      copy("P%", "X%"), call("loop"), copy("P%", "X%"), end(), label("loop"),
      { kind: "for", variable: "I", start: number(0), limit: number(1), location },
      copy("X%", "Z%"), { kind: "next", variable: "I", location }, ret()
    ]);
    expect(countCopies(result, "P%")).toBe(2);
  });

  it("retains numeric copies when a source or destination is overwritten", () => {
    const result = optimize([copy("P%", "X%"), copy("X%", "Z%"), copy("P%", "X%"), copy("P%", "Z%"), copy("P%", "X%"), end()]);
    expect(countCopies(result, "P%")).toBe(4);
  });
});
