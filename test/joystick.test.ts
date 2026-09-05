import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";
import { compileSourceDetailed } from "../src/compiler.js";
import type { TargetId } from "../src/targets/target.js";

const targets: TargetId[] = ["spectrum", "atari800xl", "c64"];
const source = "x = get_joystick(JOY_X)\ny = get_joystick(JOY_Y)\nf = get_joystick(JOY_FIRE1)\n";

describe("joystick input", () => {
  it.each(targets)("does not count hardware input functions as variables on %s", target => {
    const result = compileSourceDetailed(source, { filename: "input.mbas", target, readability: 0 });
    expect(result.stats.numericVariables).not.toEqual(expect.arrayContaining(["IN"]));
    expect(result.stats.numericVariables).not.toEqual(expect.arrayContaining(["STICK"]));
    expect(result.stats.numericVariables).not.toEqual(expect.arrayContaining(["STRIG"]));
  });

  it("rejects test setters in normal builds and writes to selectors", () => {
    expect(() => compileSource("set_joystick(JOY_X, 0)", { filename: "input.mbas", target: "c64" })).toThrow(/test mode/);
    expect(() => compileSource("JOY_X = 1", { filename: "input.mbas", target: "c64" })).toThrow();
  });
  it.each(targets)("decodes every switch combination on %s", target => {
    const output = compileSource(source, { filename: "input.mbas", target, readability: 2 });
    const expressions = [...output.matchAll(/^\d+ (?:LET )?\w+=(.*)$/gm)]
      .map(match => match[1].split(":")[0])
      .filter(value => /PEEK\(56320\)|STICK|STRIG|IN \d/.test(value));
    expect(expressions).toHaveLength(3);
    const evaluate = expressions.map(expression => new Function("ports", "stick", "trigger", "return " + expression
      .replaceAll("INT(", "Math.floor(")
      .replaceAll("PEEK(56320)", "stick")
      .replaceAll("STICK(0)", "(stick & 15)")
      .replaceAll("STRIG(0)", "trigger")
      .replaceAll("AND", "&")
      .replace(/IN (\d+)/g, "ports[$1]")) as (ports: Record<number, number>, stick: number, trigger: number) => number);
    for (let switches = 0; switches < 256; switches++) {
      const bit = (index: number) => (switches >> index) & 1;
      const ports = {
        57342: 252 + bit(3) + 2 * bit(2),
        64510: 254 + bit(0),
        65022: 254 + bit(1),
        32766: 254 + bit(4)
      };
      expect(evaluate.map(fn => fn(ports, switches, bit(4)))).toEqual([
        bit(2) - bit(3), bit(0) - bit(1), 1 - bit(4)
      ]);
    }
    expect(output).not.toMatch(/MBTJ[XYF]/);
  });

  it.each(targets)("accepts aliases and expression use on %s", target => {
    expect(() => compileSource("const axis = JOY_X\nif get_joystick(axis) < 0 then\nprint get_joystick(JOY_FIRE1)\nend if\n", { filename: "input.mbas", target })).not.toThrow();
  });

  it.each(["get_joystick()", "get_joystick(JOY_X, 0)", "get_joystick(3)", "get_joystick(-1)", "get_joystick(0.5)", 'get_joystick("X")', "get_joystick(axis)"])("rejects %s", expression => {
    expect(() => compileSource("x = " + expression + "\n", { filename: "input.mbas", target: "c64" })).toThrow(/input.mbas:1/);
  });

  it.each(targets)("uses independent resettable fakes on %s", target => {
    const output = compileSource([
      "function readX()", "return get_joystick(JOY_X)", "end function",
      "test First()", "set_joystick(JOY_X, -1)", "set_joystick(JOY_Y, 1)", "set_joystick(JOY_FIRE1, 1)",
      "assert_eq -1, readX()", "assert_eq 1, get_joystick(JOY_Y)", "assert_eq 1, get_joystick(JOY_FIRE1)", "end test",
      "test Second()", "assert_eq 0, get_joystick(JOY_X)", "assert_eq 0, get_joystick(JOY_Y)", "assert_eq 0, get_joystick(JOY_FIRE1)", "end test"
    ].join("\n"), { filename: "input.mbas", target, testMode: true, readability: 2 });
    expect(output).not.toMatch(/PEEK\(56320\)|STICK\(|STRIG\(|IN 57342/);
    if (target === "spectrum") {
      for (const name of ["MBTJX", "MBTJY", "MBTJF"]) {
        expect(output.split("LET " + name + "=0").length - 1).toBe(2);
      }
      expect(output).toContain("LET MBTJX=-1");
      expect(output).toContain("LET MBTJY=1");
      expect(output).toContain("LET MBTJF=1");
    }
  });

  it.each([
    "set_joystick(JOY_X, 1)",
    "function fake()\nset_joystick(JOY_X, 1)\nend function",
    "test Bad()\nx = set_joystick(JOY_X, 1)\nend test",
    "test Bad()\nset_joystick(JOY_X)\nend test",
    "test Bad()\nset_joystick(7, 1)\nend test",
    'test Bad()\nset_joystick(JOY_X, "left")\nend test'
  ])("rejects invalid fake use", source => {
    expect(() => compileSource(source, { filename: "input.mbas", target: "spectrum", testMode: true })).toThrow(/input.mbas:/);
  });
});
