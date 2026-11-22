import { describe, expect, it, vi } from "vitest";
import { compileSource, type Target } from "../src/compiler.js";
import type { Instruction } from "../src/lowering.js";
import { createRenderVariableMapCache } from "../src/targets/target.js";

describe("render variable map cache", () => {
  it("caches by readability and invalidates on each new render attempt", () => {
    const build = vi.fn((instructions: readonly Instruction[], readability: number) =>
      new Map([["value", `${instructions.length}:${readability}`]])
    );
    const cache = createRenderVariableMapCache(build);
    const first: Instruction[] = [];
    const second: Instruction[] = [{ kind: "rem", text: "other", location: { filename: "test", line: 1, column: 1 } }];
    cache.reset(first);
    expect(cache.get(0).get("value")).toBe("0:0");
    expect(cache.get(0).get("value")).toBe("0:0");
    expect(cache.get(2).get("value")).toBe("0:2");
    expect(build).toHaveBeenCalledTimes(2);
    cache.reset(second);
    expect(cache.get(0).get("value")).toBe("1:0");
    expect(build).toHaveBeenCalledTimes(3);
  });

  it.each(["spectrum", "atari800xl", "c64", "vic20", "agon", "cpc", "kc85"] as const satisfies readonly Target[])(
    "preserves naming across consecutive %s builds and readability levels",
    (target) => {
      const options = { filename: "cache.mbas", target, readability: 0 as const };
      const source = "score = 1\nprint score\n";
      const expected = compileSource(source, options);
      compileSource("other = 2\nprint other\n", options);
      compileSource(source, { ...options, readability: 2 });
      expect(compileSource(source, options)).toBe(expected);
    }
  );
});
