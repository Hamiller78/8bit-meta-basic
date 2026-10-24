import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

const source = `
struct Person
  name$(12)
  age
end struct
dim people AS Person(2)
save_file "SAVE1", people
load_file "SAVE1", people
`;

describe("array file I/O", () => {
  it.each(["c64", "atari800xl", "spectrum", "agon"] as const)("compiles struct arrays for %s", (target) => {
    expect(() => compileSource(source, { filename: "file-io.mbas", target, readability: 2 })).not.toThrow();
  });

  it("uses disk by default and tape when selected on C64", () => {
    const disk = compileSource(source, { filename: "file-io.mbas", target: "c64", readability: 2 });
    const tape = compileSource(source, { filename: "file-io.mbas", target: "c64", readability: 2, fileStorage: "tape" });
    expect(disk).toContain('OPEN 1,8,1,"@0:SAVE1,S,W"');
    expect(tape).toContain('OPEN 1,1,1,"SAVE1"');
  });

  it("uses each rewritable target's replacing output mode for SAVE_FILE", () => {
    const c64 = compileSource(source, { filename: "file-io.mbas", target: "c64", readability: 2 });
    const atari = compileSource(source, { filename: "file-io.mbas", target: "atari800xl", readability: 2 });
    const agon = compileSource(source, { filename: "file-io.mbas", target: "agon", readability: 2 });
    expect(c64).toContain('OPEN 1,8,1,"@0:SAVE1,S,W"');
    expect(atari).toContain('OPEN #1,8,0,"D:SAVE1.DAT"');
    expect(agon).toContain('OPENOUT("SAVE1.DAT")');
  });

  it("deletes named data files on rewritable storage", () => {
    const program = 'delete_file "SAVE1"\n';
    expect(compileSource(program, { filename: "file-io.mbas", target: "c64", readability: 2 }))
      .toContain('OPEN 15,8,15,"S0:SAVE1":CLOSE 15');
    expect(compileSource(program, { filename: "file-io.mbas", target: "atari800xl", readability: 2 }))
      .toContain('XIO 33,#1,0,0,"D:SAVE1.DAT"');
    expect(compileSource(program, { filename: "file-io.mbas", target: "atari800xl", readability: 2, atariDataDriveSpec: "H6:" }))
      .toContain('XIO 33,#1,0,0,"H6:SAVE1.DAT"');
    expect(compileSource(program, { filename: "file-io.mbas", target: "agon", readability: 2 }))
      .toContain('*DELETE SAVE1.DAT');
  });

  it("rejects DELETE_FILE for tape storage", () => {
    const program = 'delete_file "SAVE1"\n';
    expect(() => compileSource(program, { filename: "file-io.mbas", target: "spectrum" })).toThrow(/tape has no file directory/);
    expect(() => compileSource(program, { filename: "file-io.mbas", target: "c64", fileStorage: "tape" })).toThrow(/tape has no file directory/);
    expect(() => compileSource(program, { filename: "file-io.mbas", target: "atari800xl", fileStorage: "tape" })).toThrow(/tape has no file directory/);
  });

  it("allows shared source to guard DELETE_FILE with FILE_STORAGE_DISK", () => {
    const program = 'if FILE_STORAGE_DISK then\ndelete_file "SAVE1"\nend if\nprint "READY"\n';
    const spectrum = compileSource(program, { filename: "file-io.mbas", target: "spectrum", readability: 2 });
    const c64 = compileSource(program, { filename: "file-io.mbas", target: "c64", readability: 2 });
    expect(spectrum).not.toContain("DELETE");
    expect(spectrum).toContain('PRINT "READY"');
    expect(c64).toContain('OPEN 15,8,15,"S0:SAVE1":CLOSE 15');
  });

  it("checks whether a named data file exists on rewritable storage", () => {
    const program = 'exists = file_exists("SAVE1")\n';
    const c64 = compileSource(program, { filename: "file-io.mbas", target: "c64", readability: 2 });
    const atari = compileSource(program, { filename: "file-io.mbas", target: "atari800xl", readability: 2 });
    const agon = compileSource(program, { filename: "file-io.mbas", target: "agon", readability: 2 });

    expect(c64).toContain('OPEN 1,8,0,"SAVE1,S,R"');
    expect(c64).toContain("INPUT#15");
    expect(c64).toMatch(/ABS\([^\r\n]*= 0\).*REM EXISTS/);
    expect(atari).toContain('OPEN #1,4,0,"D:SAVE1.DAT"');
    expect(atari).toContain("TRAP 40000");
    expect(atari).toContain("EXISTS=1");
    expect(atari).toContain("EXISTS=0");
    expect(atari).toMatch(/REM __MB_KEY_[0-9]+:\r?\n[0-9]+ TRAP 40000\r?\n[0-9]+ CLOSE #1\r?\n[0-9]+ EXISTS=0/);
    expect(agon).toContain('MBFILE%=OPENIN("SAVE1.DAT")');
    expect(agon).toContain("EXISTS=-(MBFILE%<>0)");
    expect(agon).toContain("CLOSE#MBFILE%");
  });

  it("rejects FILE_EXISTS on tape unless a disk guard removes it", () => {
    const unguarded = 'exists = file_exists("SAVE1")\n';
    const guarded = 'if FILE_STORAGE_DISK then\nexists = file_exists("SAVE1")\nend if\nprint "READY"\n';
    expect(() => compileSource(unguarded, { filename: "file-io.mbas", target: "spectrum" })).toThrow(/tape has no file directory/);
    expect(() => compileSource(unguarded, { filename: "file-io.mbas", target: "c64", fileStorage: "tape" })).toThrow(/tape has no file directory/);
    const spectrum = compileSource(guarded, { filename: "file-io.mbas", target: "spectrum", readability: 2 });
    expect(spectrum).not.toContain("OPENIN");
    expect(spectrum).toContain('PRINT "READY"');
  });

  it("validates FILE_EXISTS filenames and its deliberately narrow expression form", () => {
    expect(() => compileSource('exists = file_exists(name$)\n', { filename: "x.mbas", target: "c64" })).toThrow(/string-literal filename/);
    expect(() => compileSource('exists = file_exists("TOO-LONG!")\n', { filename: "x.mbas", target: "c64" })).toThrow(/Portable data filenames/);
    expect(() => compileSource('print file_exists("SAVE1")\n', { filename: "x.mbas", target: "c64" })).toThrow(/complete right-hand side/);
  });

  it("uses unnamed C: files for Atari tape", () => {
    const output = compileSource(source, { filename: "file-io.mbas", target: "atari800xl", readability: 2, fileStorage: "tape" });
    expect(output).toContain('OPEN #1,8,0,"C:"');
  });

  it("keeps D: for Atari disk builds and allows emulator host-drive override", () => {
    const disk = compileSource(source, { filename: "file-io.mbas", target: "atari800xl", readability: 2 });
    const host = compileSource(source, { filename: "file-io.mbas", target: "atari800xl", readability: 2, atariDataDriveSpec: "H6:" });
    expect(disk).toContain('OPEN #1,8,0,"D:SAVE1.DAT"');
    expect(host).toContain('OPEN #1,8,0,"H6:SAVE1.DAT"');
  });

  it("reads Atari file values through a scalar before assigning array elements", () => {
    const output = compileSource(source, { filename: "file-io.mbas", target: "atari800xl", readability: 2 });
    expect(output).toMatch(/INPUT #1;[A-Z][A-Z0-9]*/);
    expect(output).not.toMatch(/INPUT #1;[A-Z][A-Z0-9]*\(/);
  });

  it("exposes the selected medium as compile-time constants", () => {
    const program = 'if FILE_STORAGE_TAPE then\nprint "TAPE"\nelse\nprint "DISK"\nend if\n';
    expect(compileSource(program, { filename: "x.mbas", target: "c64", fileStorage: "disk" })).toContain('PRINT "DISK"');
    expect(compileSource(program, { filename: "x.mbas", target: "c64", fileStorage: "disk" })).not.toContain('PRINT "TAPE"');
    expect(compileSource(program, { filename: "x.mbas", target: "c64", fileStorage: "tape" })).toContain('PRINT "TAPE"');
    expect(compileSource(program, { filename: "x.mbas", target: "c64", fileStorage: "tape" })).not.toContain('PRINT "DISK"');
  });

  it("packs a Spectrum struct array into one character-array tape block", () => {
    const output = compileSource(source, { filename: "file-io.mbas", target: "spectrum", readability: 2 });
    expect(output.match(/SAVE "SAVE1" DATA/g)).toHaveLength(1);
    expect(output.match(/LOAD "SAVE1" DATA/g)).toHaveLength(1);
    expect(output).not.toContain('SAVE "SAVE11"');
    expect(output).toContain("STR$");
    expect(output).toContain("VAL");
  });

  it.each([
    "dim values(3)\nsave_file \"VALUES\", values\nload_file \"VALUES\", values\n",
    "dim words$(3, 8)\nsave_file \"WORDS\", words$\nload_file \"WORDS\", words$\n",
    "dim bytes as byte(3)\nsave_file \"BYTES\", bytes\nload_file \"BYTES\", bytes\n"
  ])("uses one Spectrum block for a native array", (program) => {
    const output = compileSource(program, { filename: "file-io.mbas", target: "spectrum", readability: 2 });
    expect(output.match(/SAVE \"[A-Z]+\" DATA/g)).toHaveLength(1);
    expect(output.match(/LOAD \"[A-Z]+\" DATA/g)).toHaveLength(1);
  });

  it("rejects nonportable filenames and unsupported media", () => {
    expect(() => compileSource('dim a(2)\nsave_file "TOO-LONG!", a\n', { filename: "x.mbas", target: "c64" })).toThrow(/Portable data filenames/);
    expect(() => compileSource('dim a(2)\nsave_file "SAVE", a\n', { filename: "x.mbas", target: "agon", fileStorage: "tape" })).toThrow(/SD-card/);
    expect(() => compileSource('delete_file "TOO-LONG!"\n', { filename: "x.mbas", target: "agon" })).toThrow(/Portable data filenames/);
  });
});
