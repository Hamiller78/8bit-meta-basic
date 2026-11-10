import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileProgram, compileSource } from "../src/compiler.js";
import { parseSource } from "../src/parser.js";
import { validateModuleAccess } from "../src/module-semantics.js";
import { targetEnvironments } from "../src/targets/environment.js";
import { analyzeProgram } from "../src/semantic.js";
import { lowerProgram } from "../src/lowering.js";
import type { Program } from "../src/ast.js";

function program(files: Record<string, string>): Program {
  return {
    sourceFiles: Object.keys(files).map((file) => resolve("module-tests", file)),
    statements: Object.entries(files).flatMap(([file, source]) => parseSource(source, resolve("module-tests", file)).statements)
  };
}

function validate(files: Record<string, string>): void {
  validateModuleAccess(program(files), targetEnvironments.c64);
}

describe("HOT_MODULE layout hint", () => {
  it("parses a case-insensitive standalone directive", () => {
    expect(parseSource("hot_module\n", "main.mbas").statements[0]).toMatchObject({ kind: "hot-module" });
    expect(() => parseSource("hot_module 1\n", "main.mbas")).toThrow();
  });

  it("rejects duplicate and nested hints", () => {
    expect(() => validate({ "main.mbas": "hot_module\nhot_module\n" })).toThrow(/only once per module/);
    expect(() => validate({ "main.mbas": "if true then\nhot_module\nend if\n" })).toThrow(/only allowed at module level/);
    expect(() => validate({ "main.mbas": "function F()\nhot_module\nend function\n" })).toThrow(/only allowed at module level/);
  });

  it("leaves a single-module program unchanged", () => {
    const options = { filename: "main.mbas", target: "c64" as const, readability: 0 as const };
    expect(compileSource('hot_module\nprint "HELLO"\n', options)).toBe(compileSource('print "HELLO"\n', options));
  });

  it.each(["spectrum", "atari800xl", "c64", "vic20", "agon"] as const)("orders hot modules before cold modules on %s", (target) => {
    const ast = program({
      "main.mbas": 'print "ENTRY"\n',
      "cold.mbas": 'print "COLD RUN"\nfunction Cold()\nprint "COLD FN"\nend function\n',
      "hot.mbas": 'hot_module\nprint "HOT RUN"\nfunction Hot()\nprint "HOT FN"\nend function\n',
      "hot2.mbas": 'hot_module\nfunction Hot2()\nprint "HOT TWO"\nend function\n'
    });
    const output = compileProgram(ast, { filename: "main.mbas", target, readability: 0 });
    expect(output.indexOf('"HOT RUN"')).toBeLessThan(output.indexOf('"ENTRY"'));
    expect(output.indexOf('"HOT FN"')).toBeLessThan(output.indexOf('"HOT TWO"'));
    expect(output.indexOf('"HOT TWO"')).toBeLessThan(output.indexOf('"COLD FN"'));
    expect(output).toMatch(/(?:GO TO|GOTO) \d+/);
    expect(output).not.toContain("HOT_MODULE");
  });

  it("preserves initialization, entry and executable module order when the entry is moved", () => {
    const ast = program({
      "main.mbas": 'print "ENTRY"\ndata "A"\n',
      "cold-init.mbas": 'trace=1\n',
      "cold-run.mbas": 'print "COLD"\ndata "B"\n',
      "hot-init.mbas": 'uses "cold-init.mbas"\nhot_module\ntrace=trace*10+2\n',
      "hot-run.mbas": 'hot_module\nprint "HOT"\n'
    });
    const lowered = lowerProgram(analyzeProgram(ast, targetEnvironments.c64));
    const instructions = lowered.instructions;
    const destination = (label: string): number => {
      const index = instructions.findIndex((instruction) => instruction.kind === "label" && instruction.name === label);
      expect(index).toBeGreaterThanOrEqual(0);
      return index;
    };
    const first = instructions[0];
    const second = instructions[1];
    const entry = instructions[2];
    expect(first.kind).toBe("gosub");
    expect(second.kind).toBe("gosub");
    expect(entry.kind).toBe("goto");
    if (first.kind !== "gosub" || second.kind !== "gosub" || entry.kind !== "goto") throw new Error("Missing startup routes");
    expect(instructions[destination(first.label) + 1].location.filename).toContain("cold-init.mbas");
    expect(instructions[destination(second.label) + 1].location.filename).toContain("hot-init.mbas");
    expect(instructions[destination(entry.label) + 1].location.filename).toContain("main.mbas");
    const runtimePrints = instructions.flatMap((instruction, index) => instruction.kind === "print" ? [{ instruction, index }] : []);
    const byModule = (name: string) => runtimePrints.find(({ instruction }) => instruction.location.filename.endsWith(name))!;
    const cold = byModule("cold-run.mbas");
    const main = byModule("main.mbas");
    const hot = byModule("hot-run.mbas");
    expect(hot.index).toBeLessThan(main.index);
    expect(main.index).toBeLessThan(cold.index);
    const afterMain = instructions[main.index + 1];
    const afterCold = instructions[cold.index + 1];
    expect(afterMain.kind).toBe("goto");
    expect(afterCold.kind).toBe("goto");
    if (afterMain.kind !== "goto" || afterCold.kind !== "goto") throw new Error("Missing runtime routes");
    expect(destination(afterMain.label)).toBe(cold.index - 1);
    expect(destination(afterCold.label)).toBe(hot.index - 1);
    const data = instructions.filter((instruction) => instruction.kind === "data");
    expect(data.map((instruction) => instruction.location.filename.split(/[\\/]/).pop())).toEqual(["main.mbas", "cold-run.mbas"]);
  });
});

describe("USES module dependencies", () => {
  it("parses a case-insensitive declaration and preserves its location", () => {
    expect(parseSource('uSeS "../lib/Math.mbas"\n', "main.mbas").statements).toEqual([
      { kind: "uses", path: "../lib/Math.mbas", location: { filename: "main.mbas", line: 1, column: 1 } }
    ]);
  });

  it.each(['uses helper\n', 'uses ""\n', 'uses "a.mbas", "b.mbas"\n', 'uses "a.mbas" + "b.mbas"\n'])("rejects malformed declarations: %s", (source) => {
    expect(() => parseSource(source, "main.mbas")).toThrow();
  });

  it("allows direct dependencies without emitting code or reordering startup", () => {
    const ast = program({ "main.mbas": 'uses "lib.mbas"\nprint Double(3)\n', "lib.mbas": 'function Double(x)\nreturn x * 2\nend function\n' });
    for (const target of ["c64", "spectrum", "atari800xl"] as const) {
      const output = compileProgram(ast, { filename: "main.mbas", target, readability: 0 });
      expect(output).not.toContain("USES");
      expect(output).toMatch(/GO ?SUB/);
    }
  });

  it.each([
    ['print Answer()\n', 'function Answer()\nreturn 42\nend function\n'],
    ['Answer()\n', 'inline function Answer()\nprint "OK"\nend function\n'],
    ['print limit\n', 'const limit = 42\n'],
    ['print_wrap "Hello", width\n', 'const width = 28\n'],
    ['print_text "intro", width\n', 'const width = 28\n'],
    ['print Ready\n', 'enum Status\nReady\nend enum\n'],
    ['print score\n', 'score = 42\n'],
    ['score = 1\n', 'dim score(2)\n'],
    ['print values(0)\n', 'dim values(2)\n'],
    ['values(0) = 1\n', 'dim values(2)\n'],
    ['dim value as Record\n', 'struct Record\nfield\nend struct\n'],
    ['print item.field\n', 'struct Record\nfield\nend struct\ndim item as Record\n'],
    ['item.field = 2\n', 'struct Record\nfield\nend struct\ndim item as Record\n'],
    ['function Accept(item as Record)\nreturn item.field\nend function\n', 'struct Record\nfield\nend struct\n'],
    ['gosub helper\n', 'helper:\nreturn\n'],
    ['read values\n', 'values = 0\n'],
    ['for values = 0 to 1\nnext values\n', 'values = 0\n'],
    ['print_device log; "OK"\n', 'open_device log, PRINTER\n'],
    ['test Example()\nassert_eq 1, score\nend test\n', 'score = 1\n'],
    ['globals\nscore = 0\nend globals\n', 'score = 1\n']
  ])("requires direct access for source reference %s", (source, library) => {
    // Explicit owners and ordinary writes in the library precede the reference here.
    expect(() => validate({ "lib.mbas": library, "main.mbas": source })).toThrow(/Cross-module access.*requires USES/);
    expect(() => validate({ "lib.mbas": library, "main.mbas": 'uses "lib.mbas"\n' + source })).not.toThrow();
  });

  it("rejects transitive access", () => {
    expect(() => validate({
      "main.mbas": 'uses "middle.mbas"\nprint secret\n',
      "middle.mbas": 'uses "state.mbas"\n',
      "state.mbas": 'secret = 1\n'
    })).toThrow(/requires USES "state.mbas"/);
  });

  it("allows an importing entry point to assign a library scalar before its initializer in file order", () => {
    expect(() => validate({ "main.mbas": 'uses "state.mbas"\nscore = 5\n', "state.mbas": 'score = 0\n' })).not.toThrow();
  });

  it("cannot hide a foreign function call behind a local variable of the same name", () => {
    expect(() => validate({
      "lib.mbas": 'function Score()\nreturn 1\nend function\n',
      "main.mbas": 'score = 0\nfunction F()\nlocal score\nreturn Score()\nend function\n'
    })).toThrow(/requires USES/);
  });

  it("rejects direct and indirect cycles even without calls", () => {
    expect(() => validate({ "a.mbas": 'uses "b.mbas"\n', "b.mbas": 'uses "a.mbas"\n' })).toThrow(/Circular USES/);
    expect(() => validate({ "a.mbas": 'uses "b.mbas"\n', "b.mbas": 'uses "c.mbas"\n', "c.mbas": 'uses "a.mbas"\n' })).toThrow(/Circular USES/);
    expect(() => validate({ "a.mbas": 'uses "./a.mbas"\n' })).toThrow(/Circular USES/);
  });

  it("resolves paths relative to the declaring module and allows shared dependencies", () => {
    expect(() => validate({
      "source/main.mbas": 'uses "../lib/a.mbas"\nuses "../lib/b.mbas"\n',
      "lib/a.mbas": 'uses "./empty.mbas"\n',
      "lib/b.mbas": 'uses "nested/../empty.mbas"\n',
      "lib/empty.mbas": ''
    })).not.toThrow();
  });

  it("rejects missing dependencies and duplicate aliases", () => {
    expect(() => validate({ "a.mbas": 'uses "missing.mbas"\n' })).toThrow(/source file in this build/);
    expect(() => validate({ "a.mbas": 'uses "b.mbas"\nuses "./b.mbas"\n', "b.mbas": '' })).toThrow(/Duplicate USES/);
  });

  it.each([
    'function F()\nuses "lib.mbas"\nend function\n',
    'if true then\nuses "lib.mbas"\nend if\n',
    'test T()\nuses "lib.mbas"\nend test\n',
    'globals\nuses "lib.mbas"\nend globals\n'
  ])("rejects nested USES", (source) => {
    expect(() => validate({ "main.mbas": source, "lib.mbas": '' })).toThrow(/only allowed at module level/);
  });

  it("respects parameters, LOCAL variables, local constants, and local labels", () => {
    expect(() => validate({
      "globals.mbas": 'score = 1\ncount = 2\nconst amount = 3\ndone:\n',
      "lib.mbas": 'function F(score)\nlocal count\nconst amount = 5\ncount = score + amount\ngoto done\ndone:\nreturn count\nend function\n'
    })).not.toThrow();
  });

  it("does not treat field names or builtins as module references", () => {
    expect(() => validate({
      "one.mbas": 'field = 1\nprint TEXT_COLUMNS\n',
      "two.mbas": 'struct Record\nfield\nend struct\ndim item as Record\nitem.field = int(PI)\nprint item.field; TEXT_COLUMNS\n'
    })).not.toThrow();
  });

  it("keeps recursion forbidden within a module", () => {
    expect(() => compileSource('function A()\nB()\nend function\nfunction B()\nA()\nend function\n', { filename: "main.mbas", target: "c64" })).toThrow(/recurs/i);
  });

  it("distinguishes device selectors from ordinary variables named printer", () => {
    expect(() => validate({ "lib.mbas": 'printer = 3\n', "main.mbas": 'print printer\n' })).toThrow(/requires USES/);
    expect(() => validate({
      "lib.mbas": 'printer = 3\n',
      "main.mbas": 'print device_available(PRINTER)\n',
      "other.mbas": 'print device_available(PRINTER)\n'
    })).not.toThrow();
  });

  it("rejects duplicate configured files", () => {
    const ast = program({ "a.mbas": '' });
    expect(() => validateModuleAccess({ ...ast, sourceFiles: [...ast.sourceFiles!, ...ast.sourceFiles!] }, targetEnvironments.c64)).toThrow(/more than once/);
  });
});
