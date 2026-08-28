import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("Meta-BASIC functions", () => {
  it("lowers parameter variables, constant arguments, expression arguments, locals, and return expressions", () => {
    const source = [
      "CurrentScore = 5",
      "Extra = 2",
      "Total = AddBonus(CurrentScore, 10)",
      "Other = AddBonus(CurrentScore + Extra * 3, 1)",
      "FUNCTION AddBonus(Score, Bonus)",
      "LOCAL Result",
      "Result = Score + Bonus",
      "RETURN Result",
      "END FUNCTION"
    ].join("\n");

    const output = compileSource(source, { filename: "fn.mbas", target: "spectrum", readability: 0 });

    expect(output).toContain("LET MBF1P1=CURRENTSCORE");
    expect(output).toContain("LET MBF1P2=10");
    expect(output).toContain("LET MBF1P1=CURRENTSCORE + EXTRA * 3");
    expect(output).toContain("LET MBF1L1=MBF1P1 + MBF1P2");
    expect(output).toContain("LET MBF1R=MBF1L1");
    expect(output).toContain("LET TOTAL=MBF1R");
    expect(output).toContain("LET OTHER=MBF1R");
    expect(output).not.toContain("LET TOTAL=MBT");
  });

  it("does not emit a duplicate RETURN after a function RETURN expression", () => {
    const output = compileSource("X = Double(3)\nFUNCTION Double(Value)\nRETURN Value * 2\nEND FUNCTION\n", {
      filename: "return.mbas",
      target: "spectrum",
      readability: 0
    });

    expect(output).not.toContain("RETURN\nRETURN");
  });

  it("lets parameters and locals shadow globals without changing the global storage", () => {
    const output = compileSource(
      ["X = 10", "Y = Foo(X)", "FUNCTION Foo(X)", "LOCAL Y", "Y = X + 1", "RETURN Y", "END FUNCTION"].join("\n"),
      { filename: "shadow.mbas", target: "spectrum", readability: 0 }
    );

    expect(output).toContain("LET X=10");
    expect(output).toContain("LET MBF1P1=X");
    expect(output).toContain("LET MBF1L1=MBF1P1 + 1");
    expect(output).toContain("LET Y=MBF1R");
  });

  it("reuses local storage for independent functions with identically named locals", () => {
    const output = compileSource(
      [
        "A = Foo(1)",
        "B = Bar(2)",
        "FUNCTION Foo(Value)",
        "LOCAL Result",
        "Result = Value + 1",
        "RETURN Result",
        "END FUNCTION",
        "FUNCTION Bar(Value)",
        "LOCAL Result",
        "Result = Value + 2",
        "RETURN Result",
        "END FUNCTION"
      ].join("\n"),
      { filename: "locals.mbas", target: "spectrum", readability: 0 }
    );

    expect(output).toContain("LET MBF1L1=MBF1P1 + 1");
    expect(output).toContain("LET MBF1L1=MBF1P1 + 2");
  });

  it("keeps caller and callee storage distinct when functions can be active together", () => {
    const output = compileSource(
      [
        "A = Outer(1)",
        "FUNCTION Outer(Value)",
        "LOCAL Result",
        "Result = Inner(Value) + Value",
        "RETURN Result",
        "END FUNCTION",
        "FUNCTION Inner(Value)",
        "LOCAL Result",
        "Result = Value + 1",
        "RETURN Result",
        "END FUNCTION"
      ].join("\n"),
      { filename: "active-storage.mbas", target: "spectrum", readability: 0 }
    );

    expect(output).toContain("LET MBF1P1=1");
    expect(output).toContain("LET MBF2P1=MBF1P1");
    expect(output).toContain("LET MBF2L1=MBF2P1 + 1");
    expect(output).toContain("LET MBF1L1=MBT1 + MBF1P1");
  });

  it("lowers function calls, nested argument calls, and preserved intermediate return values left-to-right", () => {
    const source = [
      "A = 1",
      "B = 2",
      "X = Foo(Bar(A), Baz(B))",
      "FUNCTION Bar(Value)",
      "RETURN Value + 1",
      "END FUNCTION",
      "FUNCTION Baz(Value)",
      "RETURN Value + 2",
      "END FUNCTION",
      "FUNCTION Foo(Left, Right)",
      "RETURN Left * 10 + Right",
      "END FUNCTION"
    ].join("\n");

    expect(compileSource(source, { filename: "nested.mbas", target: "spectrum", readability: 0 })).toBe(
      [
        "10 LET A=1",
        "20 LET B=2",
        "30 LET MBF1P1=A",
        "40 GO SUB 140",
        "50 LET MBT1=MBF1R",
        "60 LET MBF1P1=B",
        "70 GO SUB 160",
        "80 LET MBT2=MBF1R",
        "90 LET MBF1P1=MBT1",
        "100 LET MBF1P2=MBT2",
        "110 GO SUB 180",
        "120 LET X=MBF1R",
        "130 GO TO 200",
        "140 LET MBF1R=MBF1P1 + 1",
        "150 RETURN",
        "160 LET MBF1R=MBF1P1 + 2",
        "170 RETURN",
        "180 LET MBF1R=MBF1P1 * 10 + MBF1P2",
        "190 RETURN",
        "200 REM END",
        ""
      ].join("\n")
    );
  });

  it("lowers standalone function calls and discards their return values", () => {
    const source = [
      "DrawHeader()",
      "SetLevel(3)",
      "FUNCTION DrawHeader()",
      "PRINT \"HEADER\"",
      "RETURN 0",
      "END FUNCTION",
      "FUNCTION SetLevel(Level)",
      "PRINT Level",
      "RETURN Level",
      "END FUNCTION"
    ].join("\n");

    const output = compileSource(source, { filename: "standalone-call.mbas", target: "spectrum", readability: 0 });

    expect(output).toContain("GO SUB");
    expect(output).toContain("LET MBF1P1=3");
    expect(output).toContain('PRINT "HEADER"');
    expect(output).toContain("PRINT MBF1P1");
    expect(output).not.toContain("LET MBT");
  });

  it("expands INLINE FUNCTION calls without emitting GOSUB or function bodies", () => {
    const source = [
      "Score = Double(3)",
      "Draw(Score)",
      "INLINE FUNCTION Double(Value)",
      "RETURN Value * 2",
      "END FUNCTION",
      "INLINE FUNCTION Draw(Value)",
      "PRINT Value",
      "END FUNCTION"
    ].join("\n");

    expect(compileSource(source, { filename: "inline.mbas", target: "spectrum", readability: 0 })).toBe(["10 LET SCORE=3 * 2", "20 PRINT SCORE", ""].join("\n"));
  });

  it("allows INLINE FUNCTION bodies to use locals", () => {
    const source = [
      "Draw(2)",
      "INLINE FUNCTION Draw(Value)",
      "LOCAL Result",
      "Result = Value + 1",
      "PRINT Result",
      "END FUNCTION"
    ].join("\n");

    expect(compileSource(source, { filename: "inline-local.mbas", target: "spectrum", readability: 0 })).toBe(["10 LET MBF1L1=2 + 1", "20 PRINT MBF1L1", ""].join("\n"));
  });

  it("rejects inline functions with unsafe control flow or parameter mutation", () => {
    expect(() =>
      compileSource("INLINE FUNCTION Bad(Value)\nValue = 2\nPRINT Value\nEND FUNCTION\nBad(1)\n", { filename: "inline-bad.mbas", target: "spectrum" })
    ).toThrow('INLINE FUNCTION Bad cannot assign to parameter "Value".');

    expect(() =>
      compileSource("INLINE FUNCTION Bad()\nIF 1 THEN\nRETURN 1\nEND IF\nRETURN 2\nEND FUNCTION\nX = Bad()\n", { filename: "inline-bad.mbas", target: "spectrum" })
    ).toThrow("INLINE FUNCTION Bad supports only a final RETURN statement.");
  });

  it("allows standalone function calls without a return value", () => {
    const source = [
      "DrawHeader()",
      "FUNCTION DrawHeader()",
      "PRINT \"HEADER\"",
      "END FUNCTION"
    ].join("\n");

    const output = compileSource(source, { filename: "procedure-style.mbas", target: "spectrum", readability: 0 });

    expect(output).toContain("GO SUB");
    expect(output).toContain('PRINT "HEADER"');
    expect(output).toContain("RETURN");
  });

  it("uses top-level constants inside function bodies", () => {
    const output = compileSource(
      ["const txtQueueSize = 20", "txtQueueIndex = -1", "Add()", "FUNCTION Add()", "IF txtQueueIndex = txtQueueSize - 1 THEN", "PRINT txtQueueSize", "END IF", "END FUNCTION"].join("\n"),
      { filename: "function-const.mbas", target: "spectrum", readability: 0 }
    );

    expect(output).toContain("IF TXTQUEUEINDEX = 19 THEN GO TO");
    expect(output).toContain("PRINT 20");
    expect(output).not.toContain("TXTQUEUESIZE");
  });

  it("allows bare RETURN inside functions that never return a value", () => {
    const source = [
      "DrawHeader()",
      "FUNCTION DrawHeader()",
      "IF 1 THEN",
      "RETURN",
      "END IF",
      "PRINT \"HEADER\"",
      "END FUNCTION"
    ].join("\n");

    const output = compileSource(source, { filename: "procedure-return.mbas", target: "spectrum", readability: 0 });

    expect(output).toContain("GO SUB");
    expect(output).toContain("RETURN");
    expect(output).toContain('PRINT "HEADER"');
  });

  it("allows multiple RETURN expressions inside value-returning functions", () => {
    const source = [
      "X = Clamp(Value)",
      "FUNCTION Clamp(Value)",
      "IF Value < 0 THEN",
      "RETURN 0",
      "END IF",
      "RETURN Value",
      "END FUNCTION"
    ].join("\n");

    const output = compileSource(source, { filename: "value-return.mbas", target: "spectrum", readability: 0 });

    expect(output).toContain("LET MBF1R=0");
    expect(output).toContain("LET MBF1R=MBF1P1");
  });

  it("rejects mixing bare RETURN and RETURN expression inside one function", () => {
    expect(() =>
      compileSource("Draw()\nFUNCTION Draw()\nRETURN\nRETURN 1\nEND FUNCTION\n", { filename: "mixed-return.mbas", target: "spectrum" })
    ).toThrow("FUNCTION Draw cannot mix RETURN with and without an expression.");

    expect(() =>
      compileSource("X = Pick(1)\nFUNCTION Pick(Value)\nRETURN Value\nRETURN\nEND FUNCTION\n", { filename: "mixed-return.mbas", target: "spectrum" })
    ).toThrow("FUNCTION Pick cannot mix RETURN with and without an expression.");
  });

  it("rejects using a function without a return value inside an expression", () => {
    expect(() =>
      compileSource("X = DrawHeader()\nFUNCTION DrawHeader()\nPRINT \"HEADER\"\nEND FUNCTION\n", { filename: "procedure-expression.mbas", target: "spectrum" })
    ).toThrow("FUNCTION DrawHeader does not return a value and can only be called as a statement.");
  });

  it("rejects standalone array reads with a function-call-specific diagnostic", () => {
    expect(() => compileSource("DIM Values(3)\nValues(0)\n", { filename: "bare-array.mbas", target: "spectrum" })).toThrow(
      "Standalone calls are supported only for user-defined FUNCTIONs."
    );
  });

  it("rejects direct recursion", () => {
    expect(() =>
      compileSource("X = Foo(1)\nFUNCTION Foo(Value)\nRETURN Foo(Value)\nEND FUNCTION\n", { filename: "direct.mbas", target: "spectrum" })
    ).toThrow("Recursive function calls are not supported: Foo -> Foo");
  });

  it("rejects indirect recursion", () => {
    expect(() =>
      compileSource(
        "X = Foo(1)\nFUNCTION Foo(Value)\nRETURN Bar(Value)\nEND FUNCTION\nFUNCTION Bar(Value)\nRETURN Foo(Value)\nEND FUNCTION\n",
        { filename: "indirect.mbas", target: "spectrum" }
      )
    ).toThrow("Recursive function calls are not supported: Foo -> Bar -> Foo");
  });

  it("rejects cross-function control flow", () => {
    expect(() =>
      compileSource("GOTO Inside\nFUNCTION Foo()\nInside:\nRETURN 1\nEND FUNCTION\n", { filename: "cross-in.mbas", target: "spectrum" })
    ).toThrow("cannot cross a FUNCTION boundary");

    expect(() =>
      compileSource("Outside:\nPRINT 1\nFUNCTION Foo()\nGOTO Outside\nRETURN 1\nEND FUNCTION\n", { filename: "cross-out.mbas", target: "spectrum" })
    ).toThrow("cannot cross a FUNCTION boundary");
  });
});
