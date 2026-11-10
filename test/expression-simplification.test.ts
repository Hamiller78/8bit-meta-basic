import { describe, expect, it } from "vitest";
import type { Expression } from "../src/ast.js";
import { generatedBinary, generatedNumber, simplifyGeneratedExpression } from "../src/targets/expression-simplification.js";

const location = { filename: "generated.mbas", line: 1 };
const number = (value: number): Expression => generatedNumber(value, location);
const binary = (operator: "+" | "-" | "*", left: Expression, right: Expression): Expression => generatedBinary(operator, left, right, location);
const variable: Expression = { kind: "identifier", name: "X", location };
const call: Expression = { kind: "function-call", name: "rnd", args: [], location };

describe("late generated-expression simplification", () => {
  it("folds integer constants and combines adjacent offsets", () => {
    expect(simplifyGeneratedExpression(binary("-", binary("+", number(2), number(5)), number(1)))).toMatchObject({ kind: "number", value: 6 });
    expect(simplifyGeneratedExpression(binary("+", binary("-", variable, number(2)), number(1)))).toMatchObject({ kind: "binary", operator: "-", left: variable, right: { kind: "number", value: 1 } });
    expect(simplifyGeneratedExpression(binary("-", binary("+", variable, number(1)), number(1)))).toEqual(variable);
    const combined = simplifyGeneratedExpression(binary("+", binary("+", variable, number(1)), number(2)));
    expect(simplifyGeneratedExpression(combined)).toEqual(combined);
  });

  it("preserves evaluation of calls when applying identities", () => {
    expect(simplifyGeneratedExpression(binary("+", binary("*", call, number(1)), number(0)))).toEqual(call);
    expect(simplifyGeneratedExpression(binary("*", call, number(0)))).toMatchObject({ kind: "binary", operator: "*", left: call, right: { kind: "number", value: 0 } });
    expect(simplifyGeneratedExpression(binary("+", call, call))).toMatchObject({ kind: "binary", left: call, right: call });
  });

  it("folds exact integer division but retains unsafe and fractional results", () => {
    const overflow = binary("+", number(Number.MAX_SAFE_INTEGER), number(1));
    expect(simplifyGeneratedExpression(overflow)).toEqual(overflow);
    const division: Expression = { kind: "binary", operator: "/", left: number(1), right: number(0), location };
    expect(simplifyGeneratedExpression(division)).toEqual(division);
    const fractional: Expression = { kind: "binary", operator: "/", left: number(1), right: number(2), location };
    expect(simplifyGeneratedExpression(fractional)).toEqual(fractional);
    const exact: Expression = { kind: "binary", operator: "/", left: number(8), right: number(2), location };
    expect(simplifyGeneratedExpression(exact)).toMatchObject({ kind: "number", value: 4 });
  });

  it("simplifies nested generated indexes and function arguments", () => {
    const expression: Expression = { kind: "function-call", name: "abs", args: [{ kind: "array-access", name: "A", indices: [binary("+", variable, number(0))], location }], location };
    expect(simplifyGeneratedExpression(expression)).toMatchObject({ kind: "function-call", args: [{ kind: "array-access", indices: [variable] }] });
  });
});
