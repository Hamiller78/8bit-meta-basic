import { describe, expect, it } from "vitest";

describe("build scripts", () => {
  it("creates Atari LST bytes with Atari line endings", async () => {
    const { toAtariListingBytes } = await import("../scripts/build-target.mjs");

    expect([...toAtariListingBytes("10 PRINT \"OK\"\r\n20 GOTO 10\n")]).toEqual([
      0x31,
      0x30,
      0x20,
      0x50,
      0x52,
      0x49,
      0x4e,
      0x54,
      0x20,
      0x22,
      0x4f,
      0x4b,
      0x22,
      0x9b,
      0x32,
      0x30,
      0x20,
      0x47,
      0x4f,
      0x54,
      0x4f,
      0x20,
      0x31,
      0x30,
      0x9b
    ]);
  });

  it("rejects non-ASCII text in Atari LST output for now", async () => {
    const { toAtariListingBytes } = await import("../scripts/build-target.mjs");

    expect(() => toAtariListingBytes("10 PRINT \"ä\"\n")).toThrow("ASCII");
  });

  it("creates Atari DOS-compatible filenames for disk directories", async () => {
    const { toAtariDosFileName } = await import("../scripts/build-target.mjs");

    expect(toAtariDosFileName("warning", "lst")).toBe("WARNING.LST");
    expect(toAtariDosFileName("long-example_name", "basic")).toBe("LONGEXAM.BAS");
  });
});
