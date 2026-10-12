import { describe, expect, it } from "vitest";

describe("Agon BBC BASIC tokenizer", () => {
  it("matches a program saved by Agon BBC BASIC ADL 1.03 byte for byte", async () => {
    const { tokenizeAgonBasic } = await import("../scripts/lib/agon-basic-tokenizer.mjs");
    const source = [
      "10 P%=PAGE",
      "20 REPEAT:P%=P%+1:UNTIL ?P%=126",
      "30 ?P%=196",
      '40 S$="Ä"',
      '50 F%=OPENOUT("RESULT.DAT")',
      "60 BPUT#F%,ASC(S$)",
      "70 CLOSE#F%",
      '80 SAVE "PATCHED.BBC"',
      "90 END",
      ""
    ].join("\n");
    const expected = Buffer.from(
      "080a0050253d900d171400f53a50253d50252b313afd203f50253d3132360d" +
      "0b1e003f50253d3139360d0a280053243d22c4220d16320046253dae282252" +
      "4553554c542e44415422290d0e3c00d52346252c97285324290d084600d923" +
      "46250d135000cd2022504154434845442e424243220d055a00e00d00ffff",
      "hex"
    );

    expect(tokenizeAgonBasic(source)).toEqual(expected);
  });

  it("encodes line references using the BBC BASIC pseudo-binary form", async () => {
    const { tokenizeAgonBasic } = await import("../scripts/lib/agon-basic-tokenizer.mjs");
    const output = tokenizeAgonBasic("10 GOTO 100\n100 END\n");

    expect([...output]).toEqual([
      9, 10, 0, 0xe5, 0x8d, 0x44, 0x64, 0x40, 13,
      5, 100, 0, 0xe0, 13,
      0, 0xff, 0xff
    ]);
  });

  it("encodes UTF-8 listing text as direct Windows-1252 string bytes", async () => {
    const { tokenizeAgonBasic } = await import("../scripts/lib/agon-basic-tokenizer.mjs");
    const source = '10 PRINT "Grüße"\n';

    const output = tokenizeAgonBasic(source);
    expect(output.includes(Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65]))).toBe(true);
    expect(output.includes(Buffer.from("CHR$", "ascii"))).toBe(false);
  });

  it("reports unnumbered input and characters outside Windows-1252", async () => {
    const { tokenizeAgonBasic } = await import("../scripts/lib/agon-basic-tokenizer.mjs");

    expect(() => tokenizeAgonBasic('PRINT "NO NUMBER"\n')).toThrow("has no line number");
    expect(() => tokenizeAgonBasic('10 PRINT "Ж"\n')).toThrow("Windows-1252 cannot encode");
    expect(() => tokenizeAgonBasic("65280 END\n")).toThrow("invalid line number");
  });
});
