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
  it("parenthesizes a polled key comparison when negating the condition", () => {
    const output = compileSource('if key_pressed() then\nprint "KEY"\nend if\n', { filename: "keys.mbas", target: "apple2", readability: 0 });
    expect(output).toMatch(/IF \([A-Z]\d\$ <> ""\) (?:=|<>) 0 THEN/u);
  });
  it("uses Applesoft's positive true values when normalizing memory and screen codes", () => {
    const output = compileSource('a=free_memory()\nb=screen_code(2,3)\n', { filename: "apple.mbas", target: "apple2" });
    expect(output).toContain("FRE(0)+65536*(FRE(0)<0)");
    expect(output).toContain(">=128)+64*(PEEK(");
  });
  it("evaluates screen coordinates once and validates constant bounds", () => {
    const output = compileSource('x=screen_code(1+int(rnd()*2),1+int(rnd()*2))\n', { filename: "screen.mbas", target: "apple2" });
    expect(output.match(/RND\(1\)/gu)).toHaveLength(2);
    expect(() => compileSource('x=screen_code(25,1)\n', { filename: "screen.mbas", target: "apple2" })).toThrow(/row coordinate.*1\.\.24/);
  });
  it("uses the monitor keyboard counter for unseeded RANDOMIZE", () => {
    const output = compileSource('randomize\nx=rnd()\n', { filename: "random.mbas", target: "apple2" });
    expect(output).toContain("RND(-1-PEEK(78)-256*PEEK(79))");
    expect(output).toContain("RND(1)");
  });
  it("routes printer output through the slot 1 parallel card", () => {
    const output = compileSource('open_device out, PRINTER\nprint_device out; "HELLO"\nclose_device out\n', { filename: "printer.mbas", target: "apple2" });
    expect(output).toContain('PR#1:PRINT "HELLO":PR#0');
    expect(() => compileSource('open_device out, RS232\n', { filename: "printer.mbas", target: "apple2" })).toThrow(/does not support the rs232 device/i);
  });
  it("renders sequential array file commands for Apple DOS", () => {
    const output = compileSource('dim values(2)\nsave_file "VALUES", values\nload_file "VALUES", values\n', { filename: "disk.mbas", target: "apple2" });
    expect(output).toContain('PRINT CHR$(13);CHR$(4);"OPEN VALUES":PRINT CHR$(4);"WRITE VALUES"');
    expect(output).toContain('PRINT CHR$(13);CHR$(4);"OPEN VALUES":PRINT CHR$(4);"READ VALUES"');
    expect(output).toContain('PRINT CHR$(4);"CLOSE"');
    const withPrinter = compileSource('dim values(2)\nopen_device out, PRINTER\nprint_device out; "STATUS"\nsave_file "VALUES", values\nclose_device out\n', { filename: "disk-printer.mbas", target: "apple2" });
    expect(withPrinter).toContain('PR#1:PRINT "STATUS":PR#0:CALL 1002');
  });
  it("renders a DOS delete command at the start of an output line", () => {
    const output = compileSource('delete_file "VALUES"\n', { filename: "disk-delete.mbas", target: "apple2" });
    expect(output).toContain('PRINT CHR$(13);CHR$(4);"DELETE VALUES"');
    const withPrinter = compileSource('open_device out, PRINTER\nprint_device out; "STATUS"\ndelete_file "VALUES"\nclose_device out\n', { filename: "disk-delete.mbas", target: "apple2" });
    expect(withPrinter).toContain('PR#1:PRINT "STATUS":PR#0:CALL 1002');
  });
});
