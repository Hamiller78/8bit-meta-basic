import { describe, expect, it } from "vitest";
import { compileSourceDetailed, type Target } from "../src/compiler.js";
import { reuseTemporaryStorage } from "../src/temporary-reuse.js";
import type { Instruction, LoweredProgram } from "../src/lowering.js";

const targets: readonly Target[] = ["spectrum", "atari800xl", "c64", "vic20", "agon"];

describe("compiler temporary storage", () => {
  it("repeats immediate-copy cleanup until a chain is fully forwarded", () => {
    const location = { filename: "copy-chain.mbas", line: 1, column: 1 };
    const reference = (name: string) => ({ kind: "identifier" as const, name, location });
    const instructions: Instruction[] = [
      { kind: "let", name: "MBT1", expression: reference("MBF1L1%"), location },
      { kind: "let", name: "MBT2", expression: reference("MBT1"), location },
      { kind: "let", name: "RESULT%", expression: reference("MBT2"), location }
    ];
    const program: LoweredProgram = { instructions, labels: new Map() };
    const result = reuseTemporaryStorage(program, new Set(), { integerToNumericCopyIsExact: true });
    expect(result.instructions).toHaveLength(1);
    expect(result.instructions[0]).toMatchObject({ kind: "let", name: "RESULT%", expression: { kind: "identifier", name: "MBF1L1%" } });
  });

  it.each(targets)("forwards safe inline integer results on %s", (target) => {
    const source = ["result% = InlineValue(7)", "inline function InlineValue(value)", "local answer%", "answer% = value", "return answer%", "end function"].join("\n");
    const result = compileSourceDetailed(source, { filename: "inline-integer.mbas", target, readability: 2 });
    const temporaries = result.debugInfo.variables.filter((variable) => /^mbt\d+$/i.test(variable.storageName));
    expect(temporaries).toHaveLength(target === "agon" ? 1 : 0);
  });

  it.each(targets)("forwards an immediately tested function result on %s", (target) => {
    const source = ["if Calculate(3) = 4 then", "print 1", "end if", "function Calculate(value)", "return value + 1", "end function"].join("\n");
    const result = compileSourceDetailed(source, { filename: "immediate-condition.mbas", target, readability: 2 });
    expect(result.debugInfo.variables.filter((variable) => /^mbt\d+$/i.test(variable.storageName))).toHaveLength(0);
    const returnVariable = result.debugInfo.variables.find((variable) => /^mbf\d+r$/i.test(variable.storageName));
    expect(returnVariable).toBeDefined();
    expect(result.output).toMatch(new RegExp(`IF [^\\n]*\\b${returnVariable!.targetName}\\b`, "iu"));
  });

  it.each(targets)("keeps an earlier result when another call precedes its test on %s", (target) => {
    const source = ["if Calculate(1) < Calculate(2) then", "print 1", "end if", "function Calculate(value)", "return value", "end function"].join("\n");
    const result = compileSourceDetailed(source, { filename: "two-call-condition.mbas", target, readability: 2 });
    expect(result.debugInfo.variables.filter((variable) => /^mbt\d+$/i.test(variable.storageName)).length).toBeGreaterThanOrEqual(1);
  });

  it.each(targets)("forwards an immediately consumed numeric function result on %s", (target) => {
    const source = ["result% = Calculate(3)", "function Calculate(value)", "    return value + 0.5", "end function"].join("\n");
    const result = compileSourceDetailed(source, { filename: "immediate-result.mbas", target, readability: 2 });
    expect(result.debugInfo.variables.filter((variable) => /^mbt\d+$/i.test(variable.storageName))).toHaveLength(0);
    const returnVariable = result.debugInfo.variables.find((variable) => /^mbf\d+r$/i.test(variable.storageName));
    expect(returnVariable).toBeDefined();
    expect(result.output).toMatch(new RegExp(`INT\\s*\\(?${returnVariable!.targetName}\\b`, "iu"));
  });

  it.each(targets)("shares a result slot across separate calls on %s", (target) => {
    const source = [
      "print Double(1)",
      "print Double(2)",
      "print Double(3)",
      "function Double(Value)",
      "    return Value * 2",
      "end function"
    ].join("\n");

    const result = compileSourceDetailed(source, { filename: "serial-calls.mbas", target, readability: 0 });
    const temporaries = result.debugInfo.variables.filter((variable) => /^mbt\d+$/i.test(variable.storageName));

    expect(temporaries).toHaveLength(1);
  });

  it.each(targets)("shares a string result slot across separate calls on %s", (target) => {
    const source = [
      'print Decorate$("A")',
      'print Decorate$("B")',
      "function Decorate$(Value$)",
      '    return Value$ + "!"',
      "end function"
    ].join("\n");

    const result = compileSourceDetailed(source, { filename: "serial-string-calls.mbas", target, readability: 0 });
    const temporaries = result.debugInfo.variables.filter((variable) => /^mbt\d+\$$/i.test(variable.storageName));

    expect(temporaries).toHaveLength(1);
  });

  it.each(targets)("keeps two simultaneous results and a live caller result distinct on %s", (target) => {
    const source = [
      "print Add(Twice(2), Add(Twice(3), Twice(4)))",
      "function Twice(Value)",
      "    return Value * 2",
      "end function",
      "function Add(Left, Right)",
      "    return Left + Right",
      "end function"
    ].join("\n");

    const result = compileSourceDetailed(source, { filename: "overlapping-calls.mbas", target, readability: 0 });
    const temporaries = result.debugInfo.variables.filter((variable) => /^mbt\d+$/i.test(variable.storageName));

    expect(temporaries.length).toBeGreaterThanOrEqual(2);
    expect(result.output).toContain("PRINT");
  });

  it.each(targets)("protects a caller result while its callee uses two results on %s", (target) => {
    const source = [
      "print Add(Twice(1), Nested(2))",
      "function Twice(Value)",
      "    return Value * 2",
      "end function",
      "function Nested(Value)",
      "    return Add(Twice(Value), Twice(Value + 1))",
      "end function",
      "function Add(Left, Right)",
      "    return Left + Right",
      "end function"
    ].join("\n");

    const result = compileSourceDetailed(source, { filename: "caller-callee.mbas", target, readability: 0 });
    const temporaries = result.debugInfo.variables.filter((variable) => /^mbt\d+$/i.test(variable.storageName));

    expect(temporaries).toHaveLength(3);
  });

  it.each(targets)("does not reuse a source variable named like an internal temporary on %s", (target) => {
    const source = [
      "MBT1 = 7",
      "print Double(2); MBT1",
      "function Double(Value)",
      "    return Value * 2",
      "end function"
    ].join("\n");

    const result = compileSourceDetailed(source, { filename: "reserved-name.mbas", target, readability: 0 });
    const sourceVariable = result.debugInfo.variables.find((variable) => variable.storageName === "mbt1");
    const resultVariable = result.debugInfo.variables.find((variable) => variable.storageName === "mbt2");

    expect(sourceVariable?.sourceAliases.some((alias) => alias.name.toUpperCase() === "MBT1")).toBe(true);
    expect(resultVariable).toBeDefined();
    expect(sourceVariable?.targetName).not.toBe(resultVariable?.targetName);
  });
});
