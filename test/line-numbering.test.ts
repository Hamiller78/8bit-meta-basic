import { describe, expect, it } from "vitest";
import { assignLineNumbers } from "../src/line-numbering.js";
import type { Instruction, LoweredProgram } from "../src/lowering.js";

describe("line numbering", () => {
  it("uses line numbers in steps of 10 while the target limit allows it", () => {
    const numbered = assignLineNumbers(programWithPrints(3), 2, { maxLineNumber: 9999, targetName: "Spectrum" });

    expect(numbered.lines.map((line) => line.number)).toEqual([10, 20, 30]);
  });

  it("uses dense line numbers when steps of 10 would exceed the target limit", () => {
    const numbered = assignLineNumbers(programWithPrints(1000), 2, { maxLineNumber: 9999, targetName: "Spectrum" });

    expect(numbered.lines[0]?.number).toBe(10);
    expect(numbered.lines[1]?.number).toBe(11);
    expect(numbered.lines.at(-1)?.number).toBe(1009);
  });

  it("reports programs that cannot fit even with dense line numbers", () => {
    expect(() => assignLineNumbers(programWithPrints(9991), 2, { maxLineNumber: 9999, targetName: "Spectrum" })).toThrow(
      "Generated Spectrum BASIC program needs 9991 numbered lines, but line numbers starting at 10 cannot exceed 9999."
    );
  });

  it("emits a no-op line when an omitted terminal label is a jump target", () => {
    const numbered = assignLineNumbers(programWithTerminalInternalLabel(), 0, { maxLineNumber: 9999, targetName: "Spectrum" });

    expect(numbered.labelLines.get("done")).toBe(30);
    expect(numbered.lines.map((line) => [line.number, line.instruction.kind])).toEqual([
      [10, "print"],
      [20, "goto"],
      [30, "rem"]
    ]);
  });
});

function programWithPrints(count: number): LoweredProgram {
  return {
    instructions: Array.from({ length: count }, (_, index): Instruction => ({
      kind: "print",
      items: [{ kind: "string", value: index.toString(), location: { filename: "many.mbas", line: index + 1 } }],
      trailingSemicolon: false,
      location: { filename: "many.mbas", line: index + 1 }
    })),
    labels: new Map()
  };
}

function programWithTerminalInternalLabel(): LoweredProgram {
  const location = { filename: "terminal-label.mbas", line: 1 };
  return {
    instructions: [
      { kind: "print", items: [{ kind: "string", value: "A", location }], trailingSemicolon: false, location },
      { kind: "goto", label: "done", location },
      { kind: "label", name: "done", internal: true, location }
    ],
    labels: new Map([["done", { name: "done", index: 2, location, internal: true }]])
  };
}
