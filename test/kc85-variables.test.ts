import { describe, expect, it } from "vitest";
import { allocateKc85VariableNames } from "../src/targets/kc85-variables.js";

describe("KC 85 HC-BASIC variable names", () => {
  it("avoids first-two-character and numeric-type collisions", () => {
    const map = allocateKc85VariableNames(["score", "SCORE", "score%", "score$", "second", "if"]);
    expect([...map.values()]).toEqual(["A0", "A1", "A0$", "A2", "A3"]);
  });

  it("rejects exhaustion instead of silently aliasing variables", () => {
    expect(() => allocateKc85VariableNames(Array.from({ length: 261 }, (_, i) => `number${i}`)))
      .toThrow("more than 260 numeric variable names");
  });
});
