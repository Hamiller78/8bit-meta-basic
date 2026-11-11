import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("BEEP", () => {
  it("renders the Spectrum duration and pitch in native order", () => {
    const output = compileSource("beep 0.25, -3\n", { filename: "beep.mbas", target: "spectrum" });
    expect(output).toMatch(/BEEP\s+0\.25\s*,\s*-3/);
  });

  it("captures beeps silently even when screen output is enabled", () => {
    const source = [
      "function PlayTone()",
      "beep 0.25, -3",
      "end function",
      "test Tone()",
      "PlayTone()",
      "assert_beep 0.25, -3",
      "end test"
    ].join("\n");
    const output = compileSource(source, { filename: "beep-test.mbas", target: "spectrum", testMode: true, testScreenOutput: true });
    expect(output).not.toMatch(/\bBEEP\s+0\.25/);
  });

  it("rejects nonnumeric beep arguments", () => {
    expect(() => compileSource('beep "long", 0\n', { filename: "bad-beep.mbas", target: "spectrum" })).toThrow(/BEEP.*numeric/i);
  });

  it.each(["spectrum", "atari800xl", "c64", "vic20", "agon"] as const)("compiles a constant and a variable pitch for %s", (target) => {
    const output = compileSource("pitch = NOTE_E4\nbeep 0.25, NOTE_C4\nbeep 0.25, pitch\n", { filename: "beep.mbas", target });
    expect(output.length).toBeGreaterThan(0);
    if (target === "c64") expect(output).toContain("4455");
  });

  it.each(["beep -1, 0", "beep 1, 25", "beep 1, -13"])("rejects out-of-range constant %s", (source) => {
    expect(() => compileSource(source, { filename: "bad-beep.mbas", target: "spectrum" })).toThrow(/BEEP/);
  });

  it("restricts ASSERT_BEEP to tests", () => {
    expect(() => compileSource("assert_beep 1, 0", { filename: "bad-assert.mbas", target: "spectrum" })).toThrow(/ASSERT_BEEP can only/);
  });

  it("resets the capture before each test", () => {
    const source = ["test First()", "beep 1, 0", "assert_beep 1, 0", "end test", "test Second()", "beep 0.5, 7", "assert_beep 0.5, 7", "end test"].join("\n");
    const output = compileSource(source, { filename: "beep-reset.mbas", target: "spectrum", testMode: true });
    expect(output.match(/LET MBBSET=0/g)).toHaveLength(2);
    expect(output.match(/LET MBBSET=1/g)).toHaveLength(2);
  });

  it("does not reuse user variables for beep capture", () => {
    const source = ["globals", "MBBDUR = 42", "MBBPIT = 43", "MBBSET = 44", "end globals", "test Tone()", "beep 1, 0", "assert_beep 1, 0", "assert_eq 42, MBBDUR", "assert_eq 43, MBBPIT", "assert_eq 44, MBBSET", "end test"].join("\n");
    const output = compileSource(source, { filename: "beep-names.mbas", target: "spectrum", testMode: true });
    expect(output).toContain("LET MBBDUR1=1");
    expect(output).toContain("LET MBBPIT1=0");
    expect(output).toContain("LET MBBSET1=1");
  });

  it("does not sound when a global initializer calls a function", () => {
    const source = ["globals", "Value = Play()", "end globals", "function Play()", "beep 0.25, 0", "return 1", "end function", "test Tone()", "assert_beep 0.25, 0", "end test"].join("\n");
    const output = compileSource(source, { filename: "beep-globals.mbas", target: "spectrum", testMode: true });
    expect(output).not.toMatch(/\bBEEP\s+0\.25/);
  });

  it("does not sound for zero duration but evaluates pitch", () => {
    const output = compileSource("beep 0, rnd()\n", { filename: "beep-zero.mbas", target: "spectrum" });
    expect(output).toContain("RND");
    expect(output).not.toMatch(/\bBEEP\b/);
  });

  it("precomputes a constant pitch even with a variable duration", () => {
    const output = compileSource("length = 0.5\nbeep length, NOTE_C4\n", { filename: "beep-constant.mbas", target: "c64" });
    expect(output).toContain("4455");
  });

  it.each(["c64", "vic20"] as const)("uses the 60 Hz native clock on %s", (target) => {
    const output = compileSource("beep 0.25, NOTE_C4", { filename: "beep-clock.mbas", target });
    expect(output).toMatch(/\* 60/);
  });

  it("uses finite Agon sound chunks and waits for the final sound to stop", () => {
    const output = compileSource("beep 13, NOTE_C4", { filename: "beep-long.mbas", target: "agon" });
    expect(output).toContain("254");
    expect(output).toMatch(/SOUND 1,-15,/);
    expect(output).toContain("SOUND 1,0,0,0");
    expect(output).not.toMatch(/SOUND 1,-15,[^\n]*,-1/);
  });
});
