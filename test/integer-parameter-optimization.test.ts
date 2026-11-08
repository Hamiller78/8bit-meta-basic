import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";
import { parseSource } from "../src/parser.js";
import { analyzeProgram } from "../src/semantic.js";
import { targetEnvironments } from "../src/targets/environment.js";
import { optimizeIntegerParameters } from "../src/integer-parameter-optimization.js";
import type { Expression } from "../src/ast.js";

const targets = ["spectrum", "atari800xl"] as const;

describe("integer parameter optimization", () => {
  it.each(targets)("recognizes an integral loop index passed through a read-only numeric parameter on %s", (target) => {
    const source = ["print Run()", "function Run()", "local i, result%", "result% = 0", "for i = 1 to 3", "result% = Convert(i)", "next i", "return result%", "end function", "function Convert(value)", "local result%", "result% = value", "return result%", "end function"].join("\n");
    expect(compileSource(source, { filename: "whole-loop-parameter.mbas", target, readability: 2 })).not.toMatch(/\bINT\b/u);
  });

  it.each(targets)("retains conversion for fractional loop starts and steps on %s", (target) => {
    for (const header of ["for i = 0.5 to 2", "for i = 0 to 2 step 0.5"]) {
      const source = ["print Run()", "function Run()", "local i, result%", header, "result% = Convert(i)", "next i", "return result%", "end function", "function Convert(value)", "local result%", "result% = value", "return result%", "end function"].join("\n");
      expect(compileSource(source, { filename: "fractional-loop.mbas", target, readability: 2 })).toMatch(/\bINT\b/u);
    }
  });

  it.each(targets)("retains conversion when the loop body modifies its index on %s", (target) => {
    const source = ["print Run()", "function Run()", "local i, result%", "for i = 1 to 3", "i = 1.5", "result% = Convert(i)", "next i", "return result%", "end function", "function Convert(value)", "local result%", "result% = value", "return result%", "end function"].join("\n");
    expect(compileSource(source, { filename: "modified-loop.mbas", target, readability: 2 })).toMatch(/\bINT\b/u);
  });

  it.each(targets)("retains conversion for mixed and modified numeric parameters on %s", (target) => {
    const mixed = ["print Convert(1)", "print Convert(-1.25)", "function Convert(value)", "local result%", "result% = value", "return result%", "end function"].join("\n");
    const modified = ["print Convert(1)", "function Convert(value)", "local result%", "value = -1.25", "result% = value", "return result%", "end function"].join("\n");
    for (const source of [mixed, modified]) expect(compileSource(source, { filename: "numeric-parameter.mbas", target, readability: 2 })).toMatch(/\bINT\b/u);
  });

  it.each(targets)("recognizes numeric scalar fields only when all writes are integral on %s", (target) => {
    const prefix = ["struct Player", "row", "end struct", "dim player as Player"];
    const whole = [...prefix, "player.row = 2", "result% = player.row"].join("\n");
    const fractional = [...prefix, "player.row = -1.25", "result% = player.row"].join("\n");
    const input = [...prefix, "input player.row", "result% = player.row"].join("\n");
    expect(compileSource(whole, { filename: "whole-scalar-field.mbas", target, readability: 2 })).not.toMatch(/\bINT\b/u);
    for (const source of [fractional, input]) expect(compileSource(source, { filename: "fractional-scalar-field.mbas", target, readability: 2 })).toMatch(/\bINT\b/u);
  });
  it.each(targets)("recognizes numeric struct array fields with only integral writes on %s", (target) => {
    const source = ["struct Monster", "speed", "end struct", "dim monsters as Monster(2)", "monsters(0).speed = 2", "result% = monsters(0).speed"].join("\n");
    expect(compileSource(source, { filename: "whole-field.mbas", target, readability: 2 })).not.toMatch(/\bINT\b/u);
  });

  it.each(targets)("keeps coercion for numeric struct fields with a fractional write on %s", (target) => {
    const source = ["struct Monster", "speed", "end struct", "dim monsters as Monster(2)", "monsters(0).speed = 2", "monsters(1).speed = -1.25", "result% = monsters(0).speed"].join("\n");
    expect(compileSource(source, { filename: "fractional-field.mbas", target, readability: 2 })).toMatch(/\bINT\b/u);
  });

  it.each(targets)("keeps coercion for numeric struct fields loaded from files on %s", (target) => {
    const source = ["struct Monster", "speed", "end struct", "dim monsters as Monster(2)", 'load_file "SAVE", monsters', "result% = monsters(0).speed"].join("\n");
    expect(compileSource(source, { filename: "loaded-field.mbas", target, readability: 2 })).toMatch(/\bINT\b/u);
  });

  it.each(targets)("keeps coercion for numeric struct fields populated by insertion on %s", (target) => {
    const source = ["struct Monster", "speed", "end struct", "dim monsters as Monster(2)", "dim newMonster as Monster", "newMonster.speed = -1.25", "insert_element(monsters, 0, newMonster)", "result% = monsters(0).speed"].join("\n");
    expect(compileSource(source, { filename: "inserted-field.mbas", target, readability: 2 })).toMatch(/\bINT\b/u);
  });
  it.each(targets)("recognizes integer function results through calls and branches on %s", (target) => {
    const source = [
      "result% = Forward(1)", "function Choice(flag)", "if flag then", "return -1", "else", "return 2", "end if", "end function",
      "function Forward(flag)", "return Choice(flag) + 1", "end function"
    ].join("\n");
    expect(compileSource(source, { filename: "integer-return.mbas", target, readability: 2 })).not.toMatch(/\bINT\b/u);
  });

  it.each(targets)("keeps coercion when a return branch is fractional on %s", (target) => {
    const source = ["result% = Choice(1)", "function Choice(flag)", "if flag then", "return -1.25", "end if", "return 2", "end function"].join("\n");
    expect(compileSource(source, { filename: "fractional-return.mbas", target, readability: 2 })).toMatch(/\bINT\b/u);
  });

  it.each(targets)("keeps coercion when a function can fall through without returning a value on %s", (target) => {
    const source = ["result% = Choice(1)", "function Choice(flag)", "if flag then", "return 2", "end if", "end function"].join("\n");
    expect(compileSource(source, { filename: "fallthrough-return.mbas", target, readability: 2 })).toMatch(/\bINT\b/u);
  });

  it.each(targets)("retains coercion when a function returns a fractional input parameter on %s", (target) => {
    const source = ["result% = Identity(-1.25)", "function Identity(value%)", "return value%", "end function"].join("\n");
    expect(compileSource(source, { filename: "fractional-parameter-return.mbas", target, readability: 2 })).toMatch(/\bINT\b/u);
  });
  it.each(targets)("simplifies initialized counters and integer struct field reads on %s", (target) => {
    const source = [
      "struct Box", "left%", "right%", "end struct", "dim boxes as Box(2)",
      "boxes(0).left% = 2", "boxes(0).right% = 3", "print Count()",
      "function Count()", "local count%", "count% = boxes(0).left% + boxes(0).right%",
      "while count% > 0", "count% = count% - 1", "wend", "return count%", "end function"
    ].join("\n");
    expect(compileSource(source, { filename: "integer-counter.mbas", target, readability: 2 })).not.toMatch(/\bINT\b/u);
  });

  it.each(targets)("retains coercion when a counter is read from DATA on %s", (target) => {
    const source = ["data -1.25", "print Count()", "function Count()", "local count%", "read count%", "count% = count% - 1", "return count%", "end function"].join("\n");
    expect(compileSource(source, { filename: "read-counter.mbas", target, readability: 2 })).toMatch(/\bINT\b/u);
  });

  it.each(targets)("retains coercion for struct fields loaded without integer conversion on %s", (target) => {
    const source = ["struct Box", "left%", "right%", "end struct", "dim boxes as Box(2)", 'load_file "SAVE", boxes', "result% = boxes(0).left% + 1"].join("\n");
    expect(compileSource(source, { filename: "loaded-struct.mbas", target, readability: 2 })).toMatch(/\bINT\b/u);
  });
  it.each(targets)("recognizes a scoped integer assigned before the call on %s", (target) => {
    const source = [
      "print Pollute%()", "print Wrapper()", "function Pollute%()", "return -1.25", "end function",
      "function Wrapper()", "local source%", "source% = 4", "return Adjust(source%)", "end function",
      "function Adjust(value%)", "local result%", "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    expect(compileSource(source, { filename: "assigned-local.mbas", target, readability: 2 })).not.toMatch(/\bINT\b/u);
  });

  it("requires assignment on both branches before treating a reused local as integral", () => {
    const source = [
      "print Pollute%()", "print Wrapper()", "function Pollute%()", "return -1.25", "end function",
      "function Wrapper()", "local source%", "if flag% then", "source% = 4", "end if", "return Adjust(source%)", "end function",
      "function Adjust(value%)", "local result%", "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    expect(optimizedAssignment(source)).toMatchObject({ kind: "function-call", name: "INT" });
  });

  it.each(targets)("recognizes values from integer arrays without unsafe writes on %s", (target) => {
    const source = [
      "dim values%(2)", "values%(0) = -3", "print Adjust(values%(0))",
      "function Adjust(value%)", "local result%", "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    expect(compileSource(source, { filename: "array-parameter.mbas", target, readability: 2 })).not.toMatch(/\bINT\b/u);
  });

  it.each(targets)("does not assume inserted array elements are integers on %s", (target) => {
    const source = [
      "dim values%(2)", "insert_element(values%, 0, -1.25)", "print Adjust(values%(0))",
      "function Adjust(value%)", "local result%", "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    expect(compileSource(source, { filename: "inserted-parameter.mbas", target, readability: 2 })).toMatch(/\bINT\b/u);
  });

  it("does not assume loaded array elements are integers", () => {
    const source = [
      "dim values%(2)", 'load_file "SAVE", values%', "print Adjust(values%(0))",
      "function Adjust(value%)", "local result%", "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    expect(optimizedAssignment(source)).toMatchObject({ kind: "function-call", name: "INT" });
  });

  it("does not assume a reused local contains an integer after a fractional function return", () => {
    const source = [
      "print Pollute%()", "print Wrapper()", "function Pollute%()", "return -1.25", "end function",
      "function Wrapper()", "local source%", "return Adjust(source%)", "end function",
      "function Adjust(value%)", "local result%", "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    expect(optimizedAssignment(source)).toMatchObject({ kind: "function-call", name: "INT" });
  });

  it("does not assume a reused local contains an integer after READ in another function", () => {
    const source = [
      "data -1.25", "print Pollute(1)", "print Wrapper()",
      "function Pollute(value%)", "read value%", "return value%", "end function",
      "function Wrapper()", "local source%", "return Adjust(source%)", "end function",
      "function Adjust(value%)", "local result%", "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    expect(optimizedAssignment(source)).toMatchObject({ kind: "function-call", name: "INT" });
  });

  it.each(targets)("retains fractional parameter reassignment but simplifies its later use on %s", (target) => {
    const source = [
      "print Adjust(3)", "function Adjust(value%)", "local result%", "value% = value% / 2",
      "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    const output = compileSource(source, { filename: "reassigned-parameter.mbas", target, readability: 2 });
    expect(output.match(/\bINT\b/gu)).toHaveLength(1);
  });

  it.each(targets)("preserves mixed calls when another function shares parameter storage on %s", (target) => {
    const source = [
      "print Safe(2)", "print Mixed(-1.25)", "function Safe(value%)", "local result%", "result% = value% + 1", "return result%", "end function",
      "function Mixed(value%)", "local result%", "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    const output = compileSource(source, { filename: "shared-parameters.mbas", target, readability: 2 });
    expect(output.match(/\bINT\b/gu)).toHaveLength(1);
  });

  it.each(targets)("removes coercion when every call supplies an integer on %s", (target) => {
    const source = [
      "source% = 3", "print Adjust(source%)", "print Adjust(-2)",
      "function Adjust(value%)", "local result%", "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    const output = compileSource(source, { filename: "integer-parameters.mbas", target, readability: 2 });
    expect(output).not.toMatch(/\bINT\b/u);
  });

  it.each(targets)("keeps coercion when one call supplies a fraction on %s", (target) => {
    const source = [
      "print Adjust(2)", "print Adjust(-1.25)",
      "function Adjust(value%)", "local result%", "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    const output = compileSource(source, { filename: "mixed-parameters.mbas", target, readability: 2 });
    expect(output).toMatch(/\bINT\b/u);
  });

  it.each(targets)("keeps coercion for parameters overwritten by READ on %s", (target) => {
    const source = [
      "data -1.25", "print Adjust(2)", "function Adjust(value%)", "local result%", "read value%",
      "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    const output = compileSource(source, { filename: "read-parameter.mbas", target, readability: 2 });
    expect(output).toMatch(/\bINT\b/u);
  });

  it.each(targets)("keeps coercion when a caller reads a fractional integer variable on %s", (target) => {
    const source = [
      "data -1.25", "read source%", "print Adjust(source%)",
      "function Adjust(value%)", "local result%", "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    const output = compileSource(source, { filename: "read-caller.mbas", target, readability: 2 });
    expect(output).toMatch(/\bINT\b/u);
  });

  it.each(targets)("propagates proven integer parameters through calls on %s", (target) => {
    const source = [
      "print Outer(4)", "function Outer(value%)", "return Inner(value%)", "end function",
      "function Inner(value%)", "local result%", "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    const output = compileSource(source, { filename: "forwarded-parameters.mbas", target, readability: 2 });
    expect(output).not.toMatch(/\bINT\b/u);
  });

  it.each(targets)("counts calls inside test assertions on %s", (target) => {
    const source = [
      "test Calls()", "assert_eq 3, Adjust(2)", "assert_eq 0, Adjust(-1.25)", "end test",
      "function Adjust(value%)", "local result%", "result% = value% + 1", "return result%", "end function"
    ].join("\n");
    expect(optimizedAssignment(source, true)).toMatchObject({ kind: "function-call", name: "INT" });
  });
});

function optimizedAssignment(source: string, testMode = false): Expression {
  const ast = parseSource(source, "parameter-analysis.mbas");
  const analyzed = analyzeProgram(ast, targetEnvironments.spectrum, { testMode });
  const optimized = optimizeIntegerParameters(analyzed);
  const fn = optimized.statements.find((statement) => statement.kind === "function" && statement.name.toLowerCase() === "adjust");
  if (!fn || fn.kind !== "function") throw new Error("Missing Adjust function");
  const assignment = fn.body.find((statement) => statement.kind === "let" && statement.sourceName?.toLowerCase() === "result%");
  if (!assignment || assignment.kind !== "let") throw new Error("Missing result assignment");
  return assignment.expression;
}
