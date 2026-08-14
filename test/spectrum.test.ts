import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

const execFileAsync = promisify(execFile);

describe("Spectrum compiler", () => {
  it("renders deterministic exact output for labels, PRINT, IF/ELSE, and backward GOTO", () => {
    const source = [
      "start:",
      '  print "WARNING"',
      "  if confirmed then",
      '    print "ATTACK CONFIRMED"',
      "  else",
      '    print "AWAITING SECOND SOURCE"',
      "  end if",
      "  goto start"
    ].join("\n");

    const expected = [
      "10 REM start:",
      '20 PRINT "WARNING"',
      "30 IF confirmed THEN GO TO 50",
      "40 GO TO 80",
      "50 REM __mb_1:",
      '60 PRINT "ATTACK CONFIRMED"',
      "70 GO TO 100",
      "80 REM __mb_3:",
      '90 PRINT "AWAITING SECOND SOURCE"',
      "100 REM __mb_2:",
      "110 GO TO 10",
      ""
    ].join("\n");

    expect(compileSource(source, { filename: "warning.mbas", target: "spectrum" })).toBe(expected);
    expect(compileSource(source, { filename: "warning.mbas", target: "spectrum" })).toBe(expected);
  });

  it("resolves forward labels", () => {
    expect(compileSource('goto done\nprint "NO"\ndone:\nprint "YES"\n', { filename: "forward.mbas", target: "spectrum" })).toBe(
      ['10 GO TO 30', '20 PRINT "NO"', "30 REM done:", '40 PRINT "YES"', ""].join("\n")
    );
  });

  it("can omit generated label comment lines while keeping source label comment lines", () => {
    const source = [
      "start:",
      'print "WARNING"',
      "if confirmed then",
      'print "ATTACK CONFIRMED"',
      "else",
      'print "AWAITING SECOND SOURCE"',
      "end if",
      "goto start"
    ].join("\n");

    expect(compileSource(source, { filename: "warning.mbas", target: "spectrum", comments: 1 })).toBe(
      [
        "10 REM start:",
        '20 PRINT "WARNING"',
        "30 IF confirmed THEN GO TO 50",
        "40 GO TO 70",
        '50 PRINT "ATTACK CONFIRMED"',
        "60 GO TO 80",
        '70 PRINT "AWAITING SECOND SOURCE"',
        "80 GO TO 10",
        ""
      ].join("\n")
    );
  });

  it("can omit all label comment lines", () => {
    const source = [
      "start:",
      'print "WARNING"',
      "if confirmed then",
      'print "ATTACK CONFIRMED"',
      "else",
      'print "AWAITING SECOND SOURCE"',
      "end if",
      "goto start"
    ].join("\n");

    expect(compileSource(source, { filename: "warning.mbas", target: "spectrum", comments: 0 })).toBe(
      [
        '10 PRINT "WARNING"',
        "20 IF confirmed THEN GO TO 40",
        "30 GO TO 60",
        '40 PRINT "ATTACK CONFIRMED"',
        "50 GO TO 70",
        '60 PRINT "AWAITING SECOND SOURCE"',
        "70 GO TO 10",
        ""
      ].join("\n")
    );
  });

  it("renders IF without ELSE", () => {
    expect(compileSource('if ready then\nprint "READY"\nend if\n', { filename: "if.mbas", target: "spectrum" })).toBe(
      ["10 IF ready THEN GO TO 30", "20 GO TO 50", "30 REM __mb_1:", '40 PRINT "READY"', "50 REM __mb_2:", ""].join("\n")
    );
  });

  it("renders primary, unary, binary, comparison, and logical expression forms", () => {
    expect(
      compileSource(
        [
          "decimal = 1.5",
          "grouped = (a + b) * 2",
          "unary = -a + 3",
          "if not confirmed or a <> b and c <= 10 then",
          'print "YES";',
          "end if"
        ].join("\n"),
        { filename: "forms.mbas", target: "spectrum" }
      )
    ).toBe(
      [
        "10 LET decimal=1.5",
        "20 LET grouped=(a + b) * 2",
        "30 LET unary=-a + 3",
        "40 IF NOT confirmed OR a <> b AND c <= 10 THEN GO TO 60",
        "50 GO TO 80",
        "60 REM __mb_1:",
        '70 PRINT "YES";',
        "80 REM __mb_2:",
        ""
      ].join("\n")
    );
  });

  it("evaluates constants, substitutes them, and folds constant subexpressions", () => {
    expect(
      compileSource(
        [
          "const screenRows = 24",
          "const warningRow = screenRows - 2",
          "const initialCountdown = 5 * 12",
          'print "SECONDS: "; initialCountdown',
          'print "ROW: "; warningRow + 1',
          "if true and false then",
          'print "NEVER"',
          "end if"
        ].join("\n"),
        { filename: "consts.mbas", target: "spectrum" }
      )
    ).toBe(
      [
        '10 PRINT "SECONDS: ";60',
        '20 PRINT "ROW: ";23',
        "30 IF 0 THEN GO TO 50",
        "40 GO TO 70",
        "50 REM __mb_1:",
        '60 PRINT "NEVER"',
        "70 REM __mb_2:",
        ""
      ].join("\n")
    );
  });

  it("renders assignment as Spectrum LET output and PRINT with multiple items and trailing semicolon", () => {
    expect(
      compileSource('urgency = sensorCount * 2 + alertLevel\nprint "SECONDS: "; urgency;\n', {
        filename: "let-print.mbas",
        target: "spectrum"
      })
    ).toBe(["10 LET urgency=sensorCount * 2 + alertLevel", '20 PRINT "SECONDS: ";urgency;', ""].join("\n"));
  });

  it("reports constant and assignment diagnostics", () => {
    expect(() => compileSource("const a = 1\nconst A = 2\n", { filename: "dupconst.mbas", target: "spectrum" })).toThrow(
      'dupconst.mbas:2: Duplicate constant "A"'
    );
    expect(() => compileSource("const a = missing + 1\n", { filename: "unknownconst.mbas", target: "spectrum" })).toThrow(
      'unknownconst.mbas:1: Unknown constant "missing"'
    );
    expect(() => compileSource("const a = 1\nA = 2\n", { filename: "assignconst.mbas", target: "spectrum" })).toThrow(
      'assignconst.mbas:2: Cannot assign to constant "A"'
    );
    expect(() => compileSource("const a = 1 / 0\n", { filename: "zero.mbas", target: "spectrum" })).toThrow(
      "zero.mbas:1: Division by zero"
    );
    expect(() => compileSource('const a = "x" - "y"\n', { filename: "types.mbas", target: "spectrum" })).toThrow(
      "types.mbas:1: Operator - requires numeric operands"
    );
  });

  it("renders nested IF statements", () => {
    const output = compileSource(
      "if outer then\nif inner then\nprint \"BOTH\"\nelse\nprint \"OUTER\"\nend if\nend if\n",
      { filename: "nested.mbas", target: "spectrum" }
    );

    expect(output).toBe(
      [
        "10 IF outer THEN GO TO 30",
        "20 GO TO 120",
        "30 REM __mb_1:",
        "40 IF inner THEN GO TO 60",
        "50 GO TO 90",
        "60 REM __mb_3:",
        '70 PRINT "BOTH"',
        "80 GO TO 110",
        "90 REM __mb_5:",
        '100 PRINT "OUTER"',
        "110 REM __mb_4:",
        "120 REM __mb_2:",
        ""
      ].join("\n")
    );
  });

  it("renders exact output for the updated warning example", () => {
    const source = [
      "const screenRows = 24",
      "const warningRow = screenRows - 2",
      "const initialCountdown = 5 * 12",
      "",
      "start:",
      '    print "WARNING"',
      '    print "SECONDS: "; initialCountdown',
      "",
      "    urgency = sensorCount * 2 + alertLevel",
      "",
      "    if confirmed and urgency >= 4 then",
      '        print "ATTACK CONFIRMED"',
      "    else",
      '        print "AWAITING SECOND SOURCE AT ROW "; warningRow',
      "    end if",
      "",
      "    goto start"
    ].join("\n");

    expect(compileSource(source, { filename: "warning.mbas", target: "spectrum" })).toBe(
      [
        "10 REM start:",
        '20 PRINT "WARNING"',
        '30 PRINT "SECONDS: ";60',
        "40 LET urgency=sensorCount * 2 + alertLevel",
        "50 IF confirmed AND urgency >= 4 THEN GO TO 70",
        "60 GO TO 100",
        "70 REM __mb_1:",
        '80 PRINT "ATTACK CONFIRMED"',
        "90 GO TO 120",
        "100 REM __mb_3:",
        '110 PRINT "AWAITING SECOND SOURCE AT ROW ";22',
        "120 REM __mb_2:",
        "130 GO TO 10",
        ""
      ].join("\n")
    );
  });

  it("reports duplicate labels", () => {
    expect(() => compileSource("again:\nAgain:\n", { filename: "dup.mbas", target: "spectrum" })).toThrow(
      'dup.mbas:2: Duplicate label "Again"'
    );
  });

  it("reports undefined labels", () => {
    expect(() => compileSource("goto missing\n", { filename: "undef.mbas", target: "spectrum" })).toThrow(
      'undef.mbas:1: Undefined label "missing"'
    );
  });

  it("runs the CLI to stdout, writes files, and returns nonzero for invalid source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mbas-"));

    try {
      const sourcePath = join(dir, "program.mbas");
      const outputPath = join(dir, "program.bas");
      await writeFile(sourcePath, 'start:\nprint "OK"\ngoto start\n', "utf8");

      const stdoutRun = await runCli(sourcePath, "--target", "spectrum");
      expect(stdoutRun.stdout).toBe(['10 REM start:', '20 PRINT "OK"', "30 GO TO 10", ""].join("\n"));
      expect(stdoutRun.stderr).toBe("");

      const compactRun = await runCli(sourcePath, "--target", "spectrum", "--comments", "0");
      expect(compactRun.stdout).toBe(['10 PRINT "OK"', "20 GO TO 10", ""].join("\n"));
      expect(compactRun.stderr).toBe("");

      const fileRun = await runCli(sourcePath, "--target", "spectrum", "-o", outputPath);
      expect(fileRun.stdout).toBe("");
      expect(fileRun.stderr).toBe("");
      await expect(readFile(outputPath, "utf8")).resolves.toBe(stdoutRun.stdout);

      const invalidPath = join(dir, "invalid.mbas");
      await writeFile(invalidPath, "else\n", "utf8");
      await expect(runCli(invalidPath, "--target", "spectrum")).rejects.toMatchObject({
        code: 1
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function runCli(...args: string[]) {
  return execFileAsync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: process.cwd()
  });
}
