import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";
import { isTargetId } from "../src/targets/index.js";

describe("Apple II Applesoft backend", () => {
  it("registers the target and renders arrays and one-based cursor positions", () => {
    expect(isTargetId("apple2")).toBe(true);
    const source = 'dim score(3)\nscore(0)=42\nprint_at 3,4,score(0)\n';
    for (const readability of [0, 2] as const) {
      const output = compileSource(source, { filename: "apple.mbas", target: "apple2", readability });
      expect(output).toContain("DIM A0(2)");
      expect(output).toContain("A0(0)=42");
      expect(output).toContain("VTAB 3:HTAB 4:PRINT A0(0)");
    }
  });
  it("rejects out-of-range coordinates and unsupported sound", () => {
    expect(() => compileSource('print_at 25,1,"X"\n', { filename: "apple.mbas", target: "apple2" })).toThrow(/row coordinate.*1\.\.24/);
    expect(() => compileSource('beep 1,1\n', { filename: "apple.mbas", target: "apple2" })).toThrow(/Apple II support for beep is not implemented/i);
  });
  it("uses Applesoft inverse mode and the keyboard strobe", () => {
    const output = compileSource('print_invert_at 2,3,"HI"\na=key_code()\n', { filename: "apple.mbas", target: "apple2" });
    expect(output).toContain("INVERSE");
    expect(output).toContain("NORMAL");
    expect(output).toContain("PEEK(49152)");
    expect(output).toContain("POKE 49168,0");
  });
  it("uses Applesoft's positive true values when normalizing memory and screen codes", () => {
    const output = compileSource('a=free_memory()\nb=screen_code(2,3)\n', { filename: "apple.mbas", target: "apple2" });
    expect(output).toContain("FRE(0)+65536*(FRE(0)<0)");
    expect(output).toContain(">=128)+64*(PEEK(");
  });
  it("routes printer output through the slot 1 parallel card", () => {
    const output = compileSource('open_device out, PRINTER\nprint_device out; "HELLO"\nclose_device out\n', { filename: "printer.mbas", target: "apple2" });
    expect(output).toContain('PR#1:PRINT "HELLO":PR#0');
    expect(() => compileSource('open_device out, RS232\n', { filename: "printer.mbas", target: "apple2" })).toThrow(/does not support the rs232 device/i);
  });
  it("renders sequential array file commands for Apple DOS", () => {
    const output = compileSource('dim values(2)\nsave_file "VALUES", values\nload_file "VALUES", values\n', { filename: "disk.mbas", target: "apple2" });
    expect(output).toContain('PRINT CHR$(4);"OPEN VALUES":PRINT CHR$(4);"WRITE VALUES"');
    expect(output).toContain('PRINT CHR$(4);"OPEN VALUES":PRINT CHR$(4);"READ VALUES"');
    expect(output).toContain('PRINT CHR$(4);"CLOSE"');
  });
});
