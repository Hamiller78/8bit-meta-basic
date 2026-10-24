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
    expect(compileSource(program, { filename: "x.mbas", target: "c64", fileStorage: "disk" })).toMatch(/IF 0 THEN/);
    expect(compileSource(program, { filename: "x.mbas", target: "c64", fileStorage: "tape" })).toMatch(/IF 1 THEN/);
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
  });
});
