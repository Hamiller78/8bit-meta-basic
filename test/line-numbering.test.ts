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
