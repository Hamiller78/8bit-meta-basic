import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileBuildConfiguration } from "../src/build-configuration.js";
import { compileSource } from "../src/compiler.js";

describe("Meta-BASIC test mode", () => {
  it("discovers one TEST and emits a generated runner instead of normal startup", () => {
    const output = compileSource('print "MAIN"\ntest Smoke()\nassert_true 1\nend test\n', {
      filename: "one-test.mbas",
      target: "spectrum",
      readability: 0,
      testMode: true
    });

    expect(output).toContain("GO SUB");
    expect(output).toContain('PRINT "RUNNING Smoke...";');
    expect(output).toContain('PRINT "PASSED"');
    expect(output).toContain('PRINT "TESTS: ";MBTESTS');
    expect(output).toContain('PRINT "ASSERTIONS: ";MBASSERT');
    expect(output).not.toContain('PRINT "MAIN"');
  });

  it("prints M.C.P. runner banners, marks failure with a red final border, and lists failed tests in the summary", () => {
    const output = compileSource(
      ["test Good()", "assert_true 1", "end test", "test Bad()", "assert_true 0", "end test"].join("\n"),
      { filename: "mcp.mbas", target: "spectrum", readability: 0, testMode: true }
    );

    expect(output).toContain('PRINT "META CONTROL PROGRAM (M.C.P.) RUN STARTED"');
    expect(output).toContain('PRINT "META CONTROL PROGRAM (M.C.P.) RUN FINISHED"');
    expect(output).toContain('PRINT "RUNNING Good...";');
    expect(output).toContain('PRINT "RUNNING Bad...";');
    expect(output).toContain('PRINT "PASSED"');
    expect(output).toContain('PRINT "FAILED"');
    expect(output).toContain("BORDER 2");
    expect(output).not.toContain("PAPER 2");
    expect(output).toContain('PRINT "FAILED TESTS:"');
    expect(output).toContain("DIM M(2)");
    expect(output).toContain("IF M(1) THEN GO TO");
    expect(output).toContain("IF M(2) THEN GO TO");
    expect(output).toContain('PRINT "Bad"');
  });

  it("discovers multiple TESTs in deterministic source order", () => {
    const output = compileSource(
      ["test First()", "assert_true 1", "end test", "test Second()", "assert_true 1", "end test"].join("\n"),
      { filename: "order.mbas", target: "spectrum", readability: 0, testMode: true }
    );

    expect(count(output, "GO SUB")).toBeGreaterThanOrEqual(2);
    expect(output.indexOf("RUNNING First")).toBeLessThan(output.indexOf("RUNNING Second"));
  });

  it("supports LOCAL variables and normal FUNCTION calls inside TEST", () => {
    const output = compileSource(
      [
        "function Add(Left, Right)",
        "return Left + Right",
        "end function",
        "test AdditionWorks()",
        "local Result",
        "Result = Add(2, 3)",
        "assert_eq 5, Result",
        "end test"
      ].join("\n"),
      { filename: "locals.mbas", target: "spectrum", readability: 0, testMode: true }
    );

    expect(output).toContain("LET MBF1P1=2");
    expect(output).toContain("LET MBF1P2=3");
    expect(output).toContain("LET MBTEST1L1=MBF1R");
    expect(output).toContain("LET MBF1R=MBF1P1 + MBF1P2");
  });

  it("lowers ASSERT_TRUE and ASSERT_FALSE success and failure without aborting later assertions", () => {
    const output = compileSource(
      ["test Booleans()", "assert_true 1", "assert_true 0", "assert_false 0", "assert_false 1", "assert_true 1", "end test"].join("\n"),
      { filename: "bools.mbas", target: "spectrum", readability: 0, testMode: true }
    );

    expect(count(output, "LET MBASSERT=MBASSERT + 1")).toBe(2);
    expect(output).not.toContain("FAIL Booleans");
    expect(output.trimEnd().endsWith("RETURN")).toBe(true);
  });

  it("lowers ASSERT_EQ and ASSERT_NE success and failure without inline diagnostic output", () => {
    const output = compileSource(
      ["test Comparisons()", "assert_eq 5, 5", "assert_eq 5, 4", "assert_ne 5, 4", "assert_ne 5, 5", "end test"].join("\n"),
      { filename: "cmp.mbas", target: "spectrum", readability: 0, testMode: true }
    );

    expect(count(output, "LET MBASSERT=MBASSERT + 1")).toBe(2);
    expect(output).not.toContain("FAIL Comparisons");
    expect(output).not.toContain('PRINT "EXPECTED: ";');
  });

  it("captures logical PRINT output for ASSERT_PRINT, including multiple output assertions", () => {
    const output = compileSource(
      ['test Output()', 'print "A"; "B"', 'assert_print "AB"', 'print "CONNECTED"', 'assert_print "CONNECTED"', 'assert_print "WRONG"', "end test"].join("\n"),
      { filename: "print.mbas", target: "spectrum", readability: 0, testMode: true }
    );

    expect(output).not.toContain('PRINT "A";"B"');
    expect(output).not.toContain('PRINT "CONNECTED"');
    expect(output).not.toContain("FAIL Output");
    expect(count(output, "LET MBASSERT=MBASSERT + 1")).toBe(1);
  });

  it("captures logical PRINT_AT output for ASSERT_PRINTAT", () => {
    const output = compileSource(
      ['test PositionedOutput()', 'print_at 2, 3, "HI"', 'assert_printat 2, 3, "HI"', 'assert_printat 2, 4, "NO"', "end test"].join("\n"),
      { filename: "printat.mbas", target: "spectrum", readability: 0, testMode: true }
    );

    expect(output).not.toContain('PRINT AT 2,3;"HI"');
    expect(output).toContain("LET MBTPROW=2");
    expect(output).toContain("LET MBTPCOL=3");
    expect(output).not.toContain("FAIL PositionedOutput");
    expect(count(output, "LET MBASSERT=MBASSERT + 1")).toBe(1);
  });

  it("tracks portable colour commands for colour assertions", () => {
    const output = compileSource(
      [
        "test Colours()",
        "screen_border_color BLUE",
        "screen_background_color BLACK",
        "screen_text_color WHITE",
        "cell_text_color YELLOW",
        "cell_background_color RED",
        "assert_screen_border_color BLUE",
        "assert_screen_background_color BLACK",
        "assert_screen_text_color WHITE",
        "assert_cell_text_color YELLOW",
        "assert_cell_background_color RED",
        "assert_screen_border_color RED",
        "end test"
      ].join("\n"),
      { filename: "colours.mbas", target: "spectrum", readability: 0, testMode: true }
    );

    expect(output).toContain("LET MBTCB=1");
    expect(output).toContain("LET MBTCG=0");
    expect(output).toContain("LET MBTCT=7");
    expect(output).toContain("LET MBTCC=6");
    expect(output).toContain("LET MBTCD=2");
    expect(output).not.toContain("BORDER 1");
    expect(output).not.toContain("PAPER 0");
    expect(output).not.toContain("INK 7");
    expect(output).not.toContain("FAIL Colours");
    expect(count(output, "LET MBASSERT=MBASSERT + 1")).toBe(1);
  });

  it("captures CLS colour as screen background colour in test mode", () => {
    const output = compileSource("test ClearColour()\ncls BLUE\nassert_screen_background_color BLUE\nend test\n", {
      filename: "cls-colour.mbas",
      target: "spectrum",
      readability: 0,
      testMode: true
    });

    expect(output).toContain("LET MBTCG=1");
    expect(output).not.toContain("PAPER 1");
    expect(output).not.toContain("CLS");
  });

  it("keeps function unit tests concise with direct return assertions", () => {
    const output = compileSource(
      ["function Double(Value)", "return Value * 2", "end function", "test DoubleWorks()", "assert_eq 8, Double(4)", "end test"].join("\n"),
      { filename: "function-unit.mbas", target: "spectrum", readability: 0, testMode: true }
    );

    expect(output).toContain("LET MBF1P1=4");
    expect(output).toContain("LET MBF1R=MBF1P1 * 2");
    expect(output).not.toContain("FAIL DoubleWorks");
  });

  it("does not let a failed test prevent later tests from running", () => {
    const output = compileSource(
      ["test Fails()", "assert_true 0", "end test", "test StillRuns()", "assert_true 1", "end test"].join("\n"),
      { filename: "later.mbas", target: "spectrum", readability: 0, testMode: true }
    );

    expect(count(output, "GO SUB")).toBeGreaterThanOrEqual(2);
    expect(output).toContain("LET MBTFAIL=MBTFAIL + 1");
    expect(output).toContain("LET MBTPASS=MBTPASS + 1");
  });

  it("emits final summary counters and no test runtime in normal builds", () => {
    const testOutput = compileSource("test Counts()\nassert_true 1\nassert_false 0\nend test\n", {
      filename: "counts.mbas",
      target: "spectrum",
      readability: 0,
      testMode: true
    });

    expect(testOutput).toContain('PRINT "TESTS: ";MBTESTS');
    expect(testOutput).toContain('PRINT "PASSED: ";MBTPASS');
    expect(testOutput).toContain('PRINT "FAILED: ";MBTFAIL');
    expect(testOutput).toContain('PRINT "ASSERTIONS: ";MBASSERT');
    expect(testOutput).toContain('PRINT "FAILURES: ";MBFAIL');
    expect(testOutput).toContain('PRINT "FREE MEMORY: ";(65536 - USR 7962)');
    expect(count(testOutput, "LET MBASSERT=MBASSERT + 1")).toBe(2);

    const normalOutput = compileSource('print "OK"\n', { filename: "normal.mbas", target: "spectrum", readability: 0 });
    expect(normalOutput).not.toContain("MBASSERT");
    expect(normalOutput).not.toContain("MBTESTS");
  });

  it("rejects test-only constructs in normal builds", () => {
    expect(() => compileSource("test Hidden()\nassert_true 1\nend test\n", { filename: "normal-test.mbas", target: "spectrum" })).toThrow(
      "TEST blocks are only valid when testMode is enabled"
    );
    expect(() => compileSource("assert_true 1\n", { filename: "normal-assert.mbas", target: "spectrum" })).toThrow(
      "ASSERT_TRUE can only be used inside a TEST when testMode is enabled"
    );
    expect(() => compileSource('assert_printat 0, 0, "X"\n', { filename: "normal-printat.mbas", target: "spectrum" })).toThrow(
      "ASSERT_PRINTAT can only be used inside a TEST when testMode is enabled"
    );
    expect(() => compileSource("assert_screen_text_color WHITE\n", { filename: "normal-colour.mbas", target: "spectrum" })).toThrow(
      "ASSERT_SCREEN_TEXT_COLOR can only be used inside a TEST when testMode is enabled"
    );
  });

  it("discovers tests distributed across multiple source files", async () => {
    await withTempProject(async (dir) => {
      await writeFile(join(dir, "first.mbas"), "test First()\nassert_true 1\nend test\n", "utf8");
      await writeFile(join(dir, "second.mbas"), "test Second()\nassert_true 1\nend test\n", "utf8");

      const output = await compileBuildConfiguration(
        { files: ["first.mbas", "second.mbas"], testMode: true },
        { baseDir: dir, target: "spectrum", readability: 0 }
      );

      expect(output).toContain("RUNNING First");
      expect(output).toContain("RUNNING Second");
      expect(count(output, "GO SUB")).toBeGreaterThanOrEqual(2);
    });
  });
});

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

async function withTempProject(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "mbas-test-mode-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
