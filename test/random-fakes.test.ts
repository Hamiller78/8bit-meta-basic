import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("test random sequences", () => {
  for (const target of ["spectrum", "atari800xl", "c64", "vic20", "agon"] as const) {
    it(`compiles queued RND reads in functions and expressions for ${target}`, () => {
      const output = compileSource([
        "function Roll()", "return int(rnd() * 6) + 1", "end function",
        "test Dice()", "set_rnd(0, 0.5, 0.99)",
        "assert_eq 1, Roll()", "assert_eq 10, Roll() + Roll()", "end test"
      ].join("\n"), { filename: "random.mbas", target, testMode: true });
      expect(output).toContain("RUNNING");
      expect(output).toContain("0.99");
    });

    it(`keeps native RND without a setter for ${target}`, () => {
      const output = compileSource("value = rnd()\nprint value\n", { filename: "random.mbas", target });
      expect(output).toContain("RND");
      expect(output).not.toContain("MBTRN");
    });
  }

  const compile = (source: string, testMode = true) => compileSource(source, { filename: "random.mbas", target: "spectrum", testMode });
  it("rejects setters outside tests and in normal builds", () => {
    for (const [source, testMode] of [
      ["set_rnd(0.5)", true],
      ["function Bad()\nset_rnd(0.5)\nend function", true],
      ["test Bad()\nset_rnd(0.5)\nend test", false]
    ] as const) expect(() => compile(source, testMode)).toThrow(/test/i);
  });

  it("requires one or more numeric values in the RND range", () => {
    expect(() => compile("test Bad()\nset_rnd()\nend test")).toThrow("SET_RND expects at least one argument");
    expect(() => compile('test Bad()\nset_rnd(0.5, "bad")\nend test')).toThrow("SET_RND expects numeric arguments");
    for (const value of ["-0.1", "1", "2", "true"]) {
      expect(() => compile(`test Bad()\nset_rnd(${value})\nend test`)).toThrow("0 <= value < 1");
    }
  });

  it("rejects using the setter as a value", () => {
    expect(() => compile("test Bad()\nx = set_rnd(0.5)\nend test")).toThrow("SET_RND can only be used as a statement inside a TEST");
  });

  it("resets the queue before each test and emits only one native fallback", () => {
    const output = compileSource([
      "test First()", "set_rnd(0.25, 0.75)", "assert_eq 0.25, rnd()", "end test",
      "test Second()", "value = rnd()", "assert_true value >= 0", "end test"
    ].join("\n"), { filename: "random.mbas", target: "spectrum", testMode: true, readability: 2 });
    expect(output.match(/LET MBTRNC=0/g)).toHaveLength(3);
    expect(output.match(/LET MBTRNV=RND/g)).toHaveLength(1);
  });
});
