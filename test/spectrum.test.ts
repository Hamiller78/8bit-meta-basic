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
      "10 REM START:",
      '20 PRINT "WARNING"',
      "30 IF CONFIRMED THEN GO TO 50",
      "40 GO TO 80",
      "50 REM __MB_1:",
      '60 PRINT "ATTACK CONFIRMED"',
      "70 GO TO 100",
      "80 REM __MB_3:",
      '90 PRINT "AWAITING SECOND SOURCE"',
      "100 REM __MB_2:",
      "110 GO TO 10",
      ""
    ].join("\n");

    expect(compileSource(source, { filename: "warning.mbas", target: "spectrum" })).toBe(expected);
    expect(compileSource(source, { filename: "warning.mbas", target: "spectrum" })).toBe(expected);
  });

  it("resolves forward labels", () => {
    expect(compileSource('goto done\nprint "NO"\ndone:\nprint "YES"\n', { filename: "forward.mbas", target: "spectrum" })).toBe(
      ['10 GO TO 30', '20 PRINT "NO"', "30 REM DONE:", '40 PRINT "YES"', ""].join("\n")
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

    expect(compileSource(source, { filename: "warning.mbas", target: "spectrum", readability: 1 })).toBe(
      [
        "10 REM START:",
        '20 PRINT "WARNING"',
        "30 IF CONFIRMED THEN GO TO 50",
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

    expect(compileSource(source, { filename: "warning.mbas", target: "spectrum", readability: 0 })).toBe(
      [
        '10 PRINT "WARNING"',
        "20 IF CONFIRMED THEN GO TO 40",
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
      ["10 IF READY THEN GO TO 30", "20 GO TO 50", "30 REM __MB_1:", '40 PRINT "READY"', "50 REM __MB_2:", ""].join("\n")
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
        "10 LET DECIMAL=1.5",
        "20 LET GROUPED=(A + B) * 2",
        "30 LET UNARY=-A + 3",
        "40 IF ((NOT (CONFIRMED <> 0)) <> 0) OR ((((A <> B) <> 0) AND ((C <= 10) <> 0)) <> 0) THEN GO TO 60",
        "50 GO TO 80",
        "60 REM __MB_1:",
        '70 PRINT "YES";',
        "80 REM __MB_2:",
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
        "50 REM __MB_1:",
        '60 PRINT "NEVER"',
        "70 REM __MB_2:",
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
    ).toBe(["10 LET URGENCY=SENSORCOUNT * 2 + ALERTLEVEL", '20 PRINT "SECONDS: ";URGENCY;', ""].join("\n"));
  });

  it("renders positioned output with Spectrum PRINT AT from source PRINT_AT", () => {
    expect(compileSource('print_at 10, 5; "WARNING";\n', { filename: "at.mbas", target: "spectrum" })).toBe(
      ['10 PRINT AT 10,5;"WARNING";', ""].join("\n")
    );
  });

  it("reports Spectrum constant coordinate ranges", () => {
    expect(() => compileSource('print_at 22, 0; "NO"\n', { filename: "range.mbas", target: "spectrum" })).toThrow(
      "Spectrum PRINT_AT row coordinate 22 is outside the supported range 0..21"
    );
    expect(() => compileSource('print_at 0, 32; "NO"\n', { filename: "range.mbas", target: "spectrum" })).toThrow(
      "Spectrum PRINT_AT column coordinate 32 is outside the supported range 0..31"
    );
  });

  it("rejects generated lines longer than the Spectrum practical editable limit", () => {
    expect(() => compileSource(`print "${"X".repeat(630)}"\n`, { filename: "long-line.mbas", target: "spectrum" })).toThrow(
      "Generated Spectrum BASIC line is 641 characters, exceeding the practical editable line limit of 640."
    );
  });

  it("uses dense line numbering when Spectrum line numbers would exceed 9999", () => {
    const source = Array.from({ length: 1000 }, (_, index) => `print "${index}"`).join("\n");
    const output = compileSource(`${source}\n`, { filename: "many.mbas", target: "spectrum" });

    expect(output.split("\n").at(-2)).toBe('1009 PRINT "999"');
  });

  it("uses Spectrum environment constants and case-insensitive lookup", () => {
    expect(
      compileSource('const row = text_rows - 2\nprint_at row, TEXT_COLUMNS - 1; "EDGE"\n', {
        filename: "env.mbas",
        target: "spectrum"
      })
    ).toBe(['10 PRINT AT 20,31;"EDGE"', ""].join("\n"));
  });

  it("renders Spectrum CLS and every portable background colour without border or text-colour changes", () => {
    const source = ["cls", ...portableColors.map((color) => `cls ${color}`)].join("\n");
    const output = compileSource(`${source}\n`, { filename: "colors.mbas", target: "spectrum" });

    expect(output).toBe(
      [
        "10 CLS",
        "20 PAPER 0",
        "30 CLS",
        "40 PAPER 1",
        "50 CLS",
        "60 PAPER 2",
        "70 CLS",
        "80 PAPER 3",
        "90 CLS",
        "100 PAPER 4",
        "110 CLS",
        "120 PAPER 5",
        "130 CLS",
        "140 PAPER 6",
        "150 CLS",
        "160 PAPER 7",
        "170 CLS",
        ""
      ].join("\n")
    );
    expect(output).not.toContain("BORDER");
    expect(output).not.toContain("INK");
  });

  it("renders Spectrum BORDER_COLOR for every portable colour", () => {
    const source = portableColors.map((color) => `border_color ${color}`).join("\n");

    expect(compileSource(`${source}\n`, { filename: "border.mbas", target: "spectrum" })).toBe(
      ["10 BORDER 0", "20 BORDER 1", "30 BORDER 2", "40 BORDER 3", "50 BORDER 4", "60 BORDER 5", "70 BORDER 6", "80 BORDER 7", ""].join(
        "\n"
      )
    );
  });

  it("renders Spectrum TEXT_COLOR as INK", () => {
    expect(compileSource("text_color WHITE\ntext_color YELLOW\n", { filename: "text-color.mbas", target: "spectrum" })).toBe(
      ["10 INK 7", "20 INK 6", ""].join("\n")
    );
  });

  it("maps long string variable names to Spectrum single-letter string variables", () => {
    expect(compileSource('tickerText$ = "READY"\nprint tickerText$\n', { filename: "strings.mbas", target: "spectrum" })).toBe(
      ['10 LET A$="READY"', "20 PRINT A$", ""].join("\n")
    );
  });

  it("folds compile-time STRING$ and SPACE$ using target constants", () => {
    expect(
      compileSource('const borderLine$ = string$("*", TEXT_COLUMNS - 2)\nprint borderLine$\nprint space$(3)\n', {
        filename: "fill.mbas",
        target: "spectrum"
      })
    ).toBe([`10 PRINT "${"*".repeat(30)}"`, '20 PRINT "   "', ""].join("\n"));
  });

  it("renders MID$ as Spectrum string slicing", () => {
    expect(compileSource('tickerText$ = "HELLO WORLD"\nprint mid$(tickerText$, 2, 5)\n', { filename: "mid.mbas", target: "spectrum" })).toBe(
      ['10 LET A$="HELLO WORLD"', "20 PRINT A$(2 TO 2 + 5 - 1)", ""].join("\n")
    );
  });

  it("renders LEN as a Spectrum string length expression", () => {
    expect(compileSource('tickerText$ = "HELLO WORLD"\ntextLength = len(tickerText$)\nprint textLength\n', { filename: "len.mbas", target: "spectrum" })).toBe(
      ['10 LET A$="HELLO WORLD"', "20 LET TEXTLENGTH=LEN A$", "30 PRINT TEXTLENGTH", ""].join("\n")
    );
  });

  it("renders JIFFIES from the Spectrum FRAMES counter", () => {
    expect(compileSource("lastTick = jiffies()\nprint JIFFIES_PER_SECOND\n", { filename: "jiffies.mbas", target: "spectrum" })).toBe(
      ["10 LET LASTTICK=PEEK 23672 + 256 * PEEK 23673 + 65536 * PEEK 23674", "20 PRINT 50", ""].join("\n")
    );
  });

  it("reports invalid compile-time string fill calls", () => {
    expect(() => compileSource('print string$("ab", 1)\n', { filename: "fill.mbas", target: "spectrum" })).toThrow(
      "STRING$ first argument must be a string with exactly one character"
    );
    expect(() => compileSource("print space$(256)\n", { filename: "fill.mbas", target: "spectrum" })).toThrow(
      "SPACE$ result length must not exceed 255 characters"
    );
  });

  it("reports invalid MID$ calls", () => {
    expect(() => compileSource('print mid$(1, 2, 3)\n', { filename: "mid.mbas", target: "spectrum" })).toThrow(
      "MID$ first argument must be a string expression"
    );
    expect(() => compileSource('print mid$("ABC", "2", 1)\n', { filename: "mid.mbas", target: "spectrum" })).toThrow(
      "MID$ start argument must be numeric"
    );
  });

  it("reports invalid LEN calls", () => {
    expect(() => compileSource("print len()\n", { filename: "len.mbas", target: "spectrum" })).toThrow("LEN expects exactly one argument");
    expect(() => compileSource("print len(123)\n", { filename: "len.mbas", target: "spectrum" })).toThrow("LEN argument must be a string expression");
  });

  it("reports invalid JIFFIES calls", () => {
    expect(() => compileSource("print jiffies(1)\n", { filename: "jiffies.mbas", target: "spectrum" })).toThrow("JIFFIES expects no arguments");
  });

  it("accepts a constant alias as a CLS colour and rejects invalid colour uses", () => {
    expect(compileSource("const alert_colour = RED\ncls alert_colour\n", { filename: "alias.mbas", target: "spectrum" })).toBe(
      ["10 PAPER 2", "20 CLS", ""].join("\n")
    );
    expect(() => compileSource("const TEXT_ROWS = 1\n", { filename: "redeclare.mbas", target: "spectrum" })).toThrow(
      'redeclare.mbas:1: Cannot redeclare environment constant "TEXT_ROWS"'
    );
    expect(() => compileSource("text_columns = 1\n", { filename: "assign.mbas", target: "spectrum" })).toThrow(
      'assign.mbas:1: Cannot assign to environment constant "text_columns"'
    );
    expect(() => compileSource("cls 1\n", { filename: "badcolor.mbas", target: "spectrum" })).toThrow(
      "badcolor.mbas:1: CLS colour must be a compile-time portable colour"
    );
    expect(() => compileSource("cls runtimeColour\n", { filename: "runtimecolor.mbas", target: "spectrum" })).toThrow(
      'runtimecolor.mbas:1: Unknown constant "runtimeColour"'
    );
    expect(() => compileSource("border_color 1\n", { filename: "badborder.mbas", target: "spectrum" })).toThrow(
      "badborder.mbas:1: BORDER_COLOR colour must be a compile-time portable colour"
    );
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
        "10 IF OUTER THEN GO TO 30",
        "20 GO TO 120",
        "30 REM __MB_1:",
        "40 IF INNER THEN GO TO 60",
        "50 GO TO 90",
        "60 REM __MB_3:",
        '70 PRINT "BOTH"',
        "80 GO TO 110",
        "90 REM __MB_5:",
        '100 PRINT "OUTER"',
        "110 REM __MB_4:",
        "120 REM __MB_2:",
        ""
      ].join("\n")
    );
  });

  it("renders exact output for the updated warning example", () => {
    const source = [
      "const warningRow = TEXT_ROWS - 2",
      "const initialCountdown = 5 * 12",
      'const borderLine$ = string$("*", TEXT_COLUMNS)',
      "",
      "sensorCount = 1",
      "alertLevel = 2",
      "confirmed = 1",
      'tickerText$ = "DEFENCE NETWORK ONLINE"',
      "",
      "    border_color BLUE",
      "    cls BLUE",
      "",
      "start:",
      "    print borderLine$",
      '    print "WARNING"',
      "    print tickerText$",
      '    print "SECONDS: "; initialCountdown',
      "",
      "    urgency = sensorCount * 2 + alertLevel",
      "",
      "    if confirmed and urgency >= 4 then",
      '        print_at warningRow, 5; "ATTACK CONFIRMED"',
      "    else",
      '        print "AWAITING SECOND SOURCE AT ROW "; warningRow',
      "    end if",
      "",
      "    goto start"
    ].join("\n");

    expect(compileSource(source, { filename: "warning.mbas", target: "spectrum" })).toBe(
      [
        "10 LET SENSORCOUNT=1",
        "20 LET ALERTLEVEL=2",
        "30 LET CONFIRMED=1",
        '40 LET A$="DEFENCE NETWORK ONLINE"',
        "50 BORDER 1",
        "60 PAPER 1",
        "70 CLS",
        "80 REM START:",
        '90 PRINT "********************************"',
        '100 PRINT "WARNING"',
        "110 PRINT A$",
        '120 PRINT "SECONDS: ";60',
        "130 LET URGENCY=SENSORCOUNT * 2 + ALERTLEVEL",
        "140 IF ((CONFIRMED) <> 0) AND ((URGENCY >= 4) <> 0) THEN GO TO 160",
        "150 GO TO 190",
        "160 REM __MB_1:",
        '170 PRINT AT 20,5;"ATTACK CONFIRMED"',
        "180 GO TO 210",
        "190 REM __MB_3:",
        '200 PRINT "AWAITING SECOND SOURCE AT ROW ";20',
        "210 REM __MB_2:",
        "220 GO TO 80",
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
      expect(stdoutRun.stdout).toBe(['10 REM START:', '20 PRINT "OK"', "30 GO TO 10", ""].join("\n"));
      expect(stdoutRun.stderr).toBe("");

      const compactRun = await runCli(sourcePath, "--target", "spectrum", "--readability", "0");
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

      await expect(runCli(sourcePath, "--target", "atari800xl")).resolves.toMatchObject({ stderr: "" });
      await expect(runCli(sourcePath, "--target", "c64")).resolves.toMatchObject({ stderr: "" });
      await expect(runCli(sourcePath, "--target", "unknown")).rejects.toMatchObject({ code: 1 });
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

const portableColors = ["BLACK", "BLUE", "RED", "MAGENTA", "GREEN", "CYAN", "YELLOW", "WHITE"] as const;
