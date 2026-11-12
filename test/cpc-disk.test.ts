import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCpcDataDisk, writeCpcDiskImage } from "../scripts/lib/cpc-disk.mjs";

describe("CPC DATA disk packaging", () => {
  it("creates a standard disk with a headerless ASCII BASIC file", () => {
    const image = createCpcDataDisk("main.bas", "10 PRINT 1\n20 END\n");
    expect(image.subarray(0, 8).toString("ascii")).toBe("MV - CPC");
    expect(image[0x30]).toBe(40);
    expect(image.readUInt16LE(0x32)).toBe(4864);
    expect(image[256 + 0x1a]).toBe(0xc1);
    const entry = image.subarray(512, 544);
    expect(entry.subarray(1, 12).toString("ascii")).toBe("MAIN    BAS");
    expect(entry[15]).toBe(1);
    expect(entry[16]).toBe(2);
    expect(image.subarray(512 + 2048, 512 + 2048 + 21).toString("ascii"))
      .toBe("10 PRINT 1\r\n20 END\r\n\x1a");
  });

  it("records multiple extents and rejects unsupported input", () => {
    const image = createCpcDataDisk("A.BAS", "A".repeat(16384));
    expect(image[512 + 15]).toBe(128);
    expect(image[512 + 32 + 12]).toBe(1);
    expect(image[512 + 32 + 16]).toBe(18);
    expect(() => createCpcDataDisk("longfilename.bas", "10 END")).toThrow(/8.3/);
    expect(() => createCpcDataDisk("A.BAS", "é")).toThrow(/ASCII/);
    expect(() => createCpcDataDisk("A.BAS", "A".repeat(185000))).toThrow(/capacity/);
  });

  it("preserves disk images changed since generation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "metabasic-cpc-"));
    const path = join(directory, "program.dsk");
    try {
      const first = createCpcDataDisk("MAIN.BAS", "10 END\n");
      const second = createCpcDataDisk("MAIN.BAS", "10 PRINT 1\n");
      await writeCpcDiskImage(path, first);
      await writeCpcDiskImage(path, second);
      const changed = Buffer.from(second);
      changed[changed.length - 1] ^= 1;
      await writeFile(path, changed);
      await expect(writeCpcDiskImage(path, first)).rejects.toThrow(/has changed/);
      expect(await readFile(path)).toEqual(changed);
      await rm(`${path}.sha256`);
      await expect(writeCpcDiskImage(path, first)).rejects.toThrow(/has changed/);
      expect(await readFile(path)).toEqual(changed);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
