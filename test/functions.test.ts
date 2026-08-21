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
    expect(output).toContain("LET TOTAL=MBT1");
    expect(output).toContain("LET OTHER=MBT2");
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
    expect(output).toContain("LET Y=MBT1");
  });

  it("allocates distinct local storage for identically named locals in different functions", () => {
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
    expect(output).toContain("LET MBF2L1=MBF2P1 + 2");
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
        "40 GO SUB 150",
        "50 LET MBT1=MBF1R",
        "60 LET MBF2P1=B",
        "70 GO SUB 170",
        "80 LET MBT2=MBF2R",
        "90 LET MBF3P1=MBT1",
        "100 LET MBF3P2=MBT2",
        "110 GO SUB 190",
        "120 LET MBT3=MBF3R",
        "130 LET X=MBT3",
        "140 GO TO 210",
        "150 LET MBF1R=MBF1P1 + 1",
        "160 RETURN",
        "170 LET MBF2R=MBF2P1 + 2",
        "180 RETURN",
        "190 LET MBF3R=MBF3P1 * 10 + MBF3P2",
        "200 RETURN",
        "210 REM END",
        ""
      ].join("\n")
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
