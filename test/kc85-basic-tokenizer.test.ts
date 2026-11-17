import { describe, expect, it } from "vitest";
import { tokenizeKc85Basic } from "../scripts/lib/kc85-basic-tokenizer.mjs";

describe("KC 85/3 BASIC packaging", () => {
  it("encodes linked lines, native tokens, end marker and 128-byte padding", () => {
    const file = tokenizeKc85Basic('10 PRINT "HI"\n20 END\n');
    expect([...file.subarray(0, 19)]).toEqual([
      19, 0,
      12, 4, 10, 0, 0x9e, 32, 34, 72, 73, 34, 0,
      18, 4, 20, 0, 0x80, 0
    ]);
    expect([...file.subarray(19, 22)]).toEqual([0, 0, 3]);
    expect(file.length).toBe(128);
  });

  it("preserves strings, comments and DATA while tokenizing statements after DATA", () => {
    const file = tokenizeKc85Basic('10 DATA "A:B",GOTO:PRINT "GOTO"\n20 REM PRINT+END\n');
    expect(file.includes(Buffer.from('"A:B",GOTO:', "ascii"))).toBe(true);
    expect(file.includes(Buffer.from('"GOTO"', "ascii"))).toBe(true);
    expect(file.includes(Buffer.from(' PRINT+END', "ascii"))).toBe(true);
    expect(file.includes(Buffer.from([0x9e, 32, 34]))).toBe(true);
  });

  it("rejects invalid lines and unsupported characters", () => {
    expect(() => tokenizeKc85Basic("10 PRINT 1\n10 END\n")).toThrow(/increase/);
    expect(() => tokenizeKc85Basic('10 PRINT "é"\n')).toThrow(/ASCII/);
    expect(() => tokenizeKc85Basic(`10 PRINT "${"X".repeat(70)}"\n`)).toThrow(/72/);
  });
});
