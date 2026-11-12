import { describe, expect, it } from "vitest";
import { allocateCpcVariableNames } from "../src/targets/cpc-variables.js";

describe("Locomotive BASIC variable names", () => {
  it("retains readable names while resolving case, punctuation, and length collisions", () => {
    const names = allocateCpcVariableNames(["score_value", "SCORE_VALUE", "score.value", "print", "9x", "x".repeat(60), `${"x".repeat(59)}y`]);
    expect(names.get("score_value")).toBe("V.SCORE.VALUE");
    expect(names.get("score.value")).toBe("V.SCORE.VALUE.1");
    expect(names.get("print")).toBe("V.PRINT");
    expect(names.get("9x")).toBe("V.9X");
    expect(new Set(names.values()).size).toBe(names.size);
    for (const value of names.values()) expect(value.length).toBeLessThanOrEqual(40);
  });

  it("keeps string and integer suffixes and distinguishes their storage", () => {
    const names = allocateCpcVariableNames(["value", "value$", "value%"]);
    expect([...names.values()]).toEqual(["V.VALUE", "V.VALUE$", "V.VALUE%"]);
  });
});
