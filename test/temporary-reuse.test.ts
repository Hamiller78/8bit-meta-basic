import { describe, expect, it } from "vitest";
import { compileSourceDetailed, type Target } from "../src/compiler.js";

const targets: readonly Target[] = ["spectrum", "atari800xl", "c64"];

describe("compiler temporary storage", () => {
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
