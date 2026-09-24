import { describe, expect, it } from "vitest";
import { analyzeBasicOutput } from "../src/output-stats.js";

describe("BASIC output statistics", () => {
  it("recognizes every DIM in a packed BASIC line", () => {
    const stats = analyzeBasicOutput(["10 DIM Q(2):DIM Q$(2):DIM M(2)"], "c64");

    expect(stats.numericArrays).toEqual(["M", "Q"]);
    expect(stats.stringArrays).toEqual(["Q$"]);
    expect(stats.numericArrays).not.toContain("DIM");
  });

  it("does not split on a colon inside a string literal", () => {
    const stats = analyzeBasicOutput(['10 PRINT "A:B":DIM V(2)'], "c64");

    expect(stats.numericArrays).toEqual(["V"]);
  });
});
