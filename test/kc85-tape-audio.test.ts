import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenizeKc85Basic } from "../scripts/lib/kc85-basic-tokenizer.mjs";
import { createKc85TapeWav } from "../scripts/lib/kc85-tape-audio.mjs";

describe("KC 85 cassette WAV", () => {
  it("contains the BASIC header, program and valid block checksums", () => {
    const sss: Buffer = tokenizeKc85Basic('10 PRINT "HELLO"\n20 END\n');
    const wav: Buffer = createKc85TapeWav(sss, "hello-world");
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(22050);
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    let pos = 44 + 8000 * 10 + 40;
    const readByte = (): number => {
      let value = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const first = wav[pos]; let half = 0;
        while (wav[pos + half] === first) half += 1;
        expect([5, 10]).toContain(half);
        if (half === 10) value |= 1 << bit;
        pos += half * 2;
      }
      pos += 40;
      return value;
    };
    expect(readByte()).toBe(1);
    const block = Buffer.from(Array.from({ length: 128 }, readByte));
    const checksum = readByte();
    expect(checksum).toBe([...block].reduce((sum, value) => (sum + value) & 255, 0));
    expect(block.subarray(0, 3)).toEqual(Buffer.from([0xd3, 0xd3, 0xd3]));
    expect(block.toString("ascii", 3, 11)).toBe("HELLOWOR");
    const length = sss.readUInt16LE(0);
    expect(block.readUInt16LE(11)).toBe(length);
    expect(block.subarray(13, 13 + length)).toEqual(sss.subarray(2, 2 + length));
    expect(block[13 + length]).toBe(3);
  });
  it("rejects a truncated BASIC image", () => {
    expect(() => createKc85TapeWav(Buffer.alloc(128), "test")).toThrow("length or end marker");
  });
  it("rejects programs that exceed the cassette block-number range", () => {
    const sss = Buffer.alloc(32768);
    sss.writeUInt16LE(32753, 0);
    sss[32755] = 3;
    expect(() => createKc85TapeWav(sss, "test")).toThrow("255 tape blocks");
  });
  it("exports a WAV from the KC build helper when requested", () => {
    const outDir = mkdtempSync(join(tmpdir(), "metabasic-kc-wav-"));
    try {
      const result = spawnSync(process.execPath, ["scripts/build-target.mjs", "kc85", "--source", "examples/struct-demo.mbas", "--profile", "release", "--skip-build", "--no-tools", "--wav", "--out-dir", outDir], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("KC 85 cassette name: STRUCTDE");
      expect(readFileSync(join(outDir, "release", "kc85", "struct-demo.wav")).toString("ascii", 0, 4)).toBe("RIFF");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
