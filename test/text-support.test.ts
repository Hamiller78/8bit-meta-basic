import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, loadBuildConfiguration, loadTexts } from "../src/build-configuration.js";
import { wrapText } from "../src/text-support.js";

const targets = ["spectrum", "atari800xl", "c64"] as const;
describe("localized text and layout", () => {
  it("wraps paragraphs and long words deterministically", () => {
    expect(wrapText("one two three\n\nfour", 7)).toEqual(["one two", "three", "", "four"]);
    expect(wrapText("abcdefghij next", 4)).toEqual(["abcd", "efgh", "ij", "next"]);
  });
  for (const target of targets) {
    it(`resolves text inside functions and wraps for ${target}`, () => {
      const result = compileSource('show()\nend\nfunction show()\nprint_text "intro"\nend function', {
        filename: "intro.mbas", target, texts: { intro: "One two three four five six seven eight nine ten eleven twelve.\n\nGrüße!" }
      });
      expect(result).not.toContain("PRINT_TEXT");
      expect(result).toContain(target === "c64" ? "GRUESSE!" : "Gruesse!");
      const text = [...result.matchAll(/PRINT "([^"]*)"/g)].map((match) => match[1]);
      expect(text.every((line) => line.length <= (target === "spectrum" ? 32 : 40))).toBe(true);
      expect(result).toBe(compileSource('show()\nend\nfunction show()\nprint_text "intro"\nend function', {
        filename: "intro.mbas", target, texts: { intro: "One two three four five six seven eight nine ten eleven twelve.\n\nGrüße!" }
      }));
    });
    it(`positions without advancing the cursor for ${target}`, () => {
      const result = compileSource('set_pos 3, 4\nprint "Hello"', { filename: "position.mbas", target });
      expect(result).toContain(target === "spectrum" ? 'PRINT AT 2,3;"";' : target === "atari800xl" ? "POSITION 3,2" : "POKE 214,2");
      expect(() => compileSource("set_pos 0, 1", { filename: "bad.mbas", target })).toThrow(/bad.mbas:1/);
    });
    it(`folds constants before wrapping on ${target}`, () => {
      const result = compileSource('const title$ = "Hello " + "world"\nprint_wrap title$\nprint_centered "Title"\nprint', { filename: "test.mbas", target });
      expect(result).toContain(target === "c64" ? "HELLO WORLD" : "Hello world");
      expect(result).toContain('PRINT ""');
    });
  }
  it("reports missing translations and runtime wrapping with source locations", () => {
    expect(() => compileSource('print_text "missing"', { filename: "intro.mbas", target: "c64", language: "de" })).toThrow(/intro.mbas:1.*missing.*de/);
    expect(() => compileSource('print_centered text$("missing")', { filename: "intro.mbas", target: "c64", language: "de" })).toThrow(/intro.mbas:1.*missing.*de/);
    expect(() => compileSource("print_centered text$(key$)", { filename: "intro.mbas", target: "c64", texts: { continue: "Continue" } })).toThrow(/TEXT\$ expects exactly one literal resource name/);
    expect(() => compileSource('print_wrap title$', { filename: "intro.mbas", target: "c64" })).toThrow(/compile-time string/);
    expect(() => compileSource('print_wrap "😀"', { filename: "intro.mbas", target: "c64" })).toThrow(/Unsupported text character/);
  });
  it("selects the C64 mixed font and preserves quoted text case", () => {
    const result = compileSource('print_wrap "Hello WORLD"', { filename: "text.mbas", target: "c64", font: "mixed" });
    expect(result).toContain("print chr$(14);");
    expect(result).toContain('print "Hello WORLD"');
    expect(result).not.toContain("CHR$(69)");
    expect(result.split("\n").every((line) => line.length <= 80)).toBe(true);
  });
  it("supports explicit constant widths and rejects invalid widths", () => {
    expect(compileSource('print_wrap "one two three", 7', { filename: "width.mbas", target: "spectrum" })).toBe('10 PRINT "one two"\n20 PRINT "three"\n');
    for (const width of ["0", "33", "1.5", "width"]) {
      expect(() => compileSource(`print_wrap "hello", ${width}`, { filename: "width.mbas", target: "spectrum" })).toThrow(/compile-time integer/);
    }
  });
  it("does not overwrite captured print output when setting the cursor", () => {
    const output = compileSource('test cursor()\nprint "Hello"\nset_pos 1, 1\nassert_print "Hello"\nend test', { filename: "cursor.mbas", target: "spectrum", testMode: true });
    expect(output).not.toContain('LET MBTPOUT$=""');
  });
  it("keeps captured wrapped text within each target's line limit", () => {
    const source = 'function show()\nprint_text "intro"\nend function\ntest names()\nassert_true 1\nend test';
    const intro = "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen.";
    for (const target of targets) {
      const output = compileSource(source, { filename: "intro.mbas", target, testMode: true, texts: { intro } });
      const limit = target === "spectrum" ? 204 : target === "atari800xl" ? 120 : 80;
      expect(output.trimEnd().split("\n").every((line) => line.length <= limit)).toBe(true);
    }
  });
  it("encodes embedded quotes without breaking BASIC literals", () => {
    expect(compileSource('print_text "quote"', { filename: "text.mbas", target: "c64", texts: { quote: 'Say "hi"' } })).toContain("CHR$(34)");
  });
  it("uses keyed text in centered and ordinary output", () => {
    const texts = { continue: "PRESS ANY KEY TO CONTINUE" };
    const centered = compileSource('print_centered text$("continue")', { filename: "text.mbas", target: "spectrum", texts });
    expect(centered).toContain('PRINT "   PRESS ANY KEY TO CONTINUE"');
    expect(centered).not.toContain('"continue"');
    expect(compileSource('print text$("continue")', { filename: "text.mbas", target: "c64", texts })).toContain('PRINT "PRESS ANY KEY TO CONTINUE"');
  });
  it("loads keyed short texts beside long text files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mbas-text-resources-"));
    try {
      await mkdir(join(directory, "en"), { recursive: true });
      await writeFile(join(directory, "en", "intro.txt"), "A long introduction.");
      await writeFile(join(directory, "en", "strings.json"), JSON.stringify({ continue: "PRESS ANY KEY", quit: "QUIT" }));
      await expect(loadTexts(directory, "en")).resolves.toEqual({
        continue: "PRESS ANY KEY",
        intro: "A long introduction.",
        quit: "QUIT"
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("rejects invalid and duplicate keyed text resources", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mbas-text-resources-"));
    try {
      await mkdir(join(directory, "en"), { recursive: true });
      await writeFile(join(directory, "en", "strings.json"), JSON.stringify({ intro: 42 }));
      await expect(loadTexts(directory, "en")).rejects.toThrow(/strings\.json.*every value must be a string/);
      await writeFile(join(directory, "en", "strings.json"), JSON.stringify({ intro: "Short intro" }));
      await writeFile(join(directory, "en", "intro.txt"), "Long intro");
      await expect(loadTexts(directory, "en")).rejects.toThrow(/Duplicate text resource "intro".*en.*strings\.json/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("honors configuration defaults, explicit overrides, and relative resource paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mbas-texts-"));
    try {
      await mkdir(join(directory, "translations", "en"), { recursive: true });
      await mkdir(join(directory, "translations", "de"), { recursive: true });
      await writeFile(join(directory, "translations", "en", "intro.txt"), "Hello");
      await writeFile(join(directory, "translations", "de", "intro.txt"), "Hallo");
      await writeFile(join(directory, "main.mbas"), 'print_text "intro"');
      const configPath = join(directory, "metabasic.json");
      await writeFile(configPath, JSON.stringify({ files: ["main.mbas"], textsDir: "translations", language: "de", font: "uppercase" }));
      const configuration = await loadBuildConfiguration(configPath);
      expect(await build(configuration, { configPath, target: "spectrum" })).toContain('PRINT "HALLO"');
      expect(await build(configuration, { configPath, target: "spectrum", language: "en", font: "mixed" })).toContain('PRINT "Hello"');
      await expect(build(configuration, { configPath, target: "spectrum", language: "fr" })).rejects.toThrow(/main.mbas:1.*intro.*fr/);
      await writeFile(configPath, JSON.stringify({ files: ["main.mbas"], font: "unknown" }));
      await expect(loadBuildConfiguration(configPath)).rejects.toThrow(/Invalid font/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("loads the San-Golpe translations from optional project texts", async () => {
    for (const target of targets) for (const language of ["en", "de"]) {
      const result = await build({ files: ["source/main.mbas", "source/intro.mbas"] }, { baseDir: "examples/san-golpe", target, language });
      expect(result).toContain(language === "de" ? (target === "c64" ? "VEROEFFENTLICHTE" : "veroeffentlichte") : (target === "c64" ? "SMALL" : "small"));
      expect(result).not.toContain("PRINT_TEXT");
    }
  });
});
