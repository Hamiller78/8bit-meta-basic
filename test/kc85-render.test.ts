import { describe, expect, it } from "vitest";
import { renderKc85Line } from "../src/targets/kc85-render.js";

const location = { filename: "screen.mbas", line: 1 };
const number = (value: number) => ({ kind: "number" as const, value, raw: String(value), location });

describe("KC 85 HC-BASIC rendering", () => {
  it("uses zero-based coordinates within the KC 85/3 default window", () => {
    expect(renderKc85Line(10, { kind: "set-position", row: number(3), column: number(4), location }, new Map(), new Map()))
      .toBe("10 LOCATE 2,3");
    expect(renderKc85Line(10, { kind: "set-position", row: number(30), column: number(40), location }, new Map(), new Map()))
      .toBe("10 LOCATE 29,39");
    expect(() => renderKc85Line(10, { kind: "set-position", row: number(31), column: number(1), location }, new Map(), new Map()))
      .toThrow(/screen\.mbas:1.*row coordinate 31/);
    expect(() => renderKc85Line(10, { kind: "set-position", row: number(1), column: number(41), location }, new Map(), new Map()))
      .toThrow(/screen\.mbas:1.*column coordinate 41/);
  });

  it("keeps the row relative to the current window when setting the column", () => {
    expect(renderKc85Line(10, { kind: "set-column", column: number(4), location }, new Map(), new Map()))
      .toBe("10 LOCATE CSRLIN(1),3");
  });

  it("reports unsupported operations instead of emitting another dialect", () => {
    expect(() => renderKc85Line(10, { kind: "suppress-scroll-prompt", location }, new Map(), new Map()))
      .toThrow(/KC 85 support for suppress-scroll-prompt is not implemented/);
  });

  it("rejects seeded RANDOMIZE, which is not in the documented KC 85 syntax", () => {
    expect(() => renderKc85Line(10, { kind: "randomize", seed: number(5), location }, new Map(), new Map()))
      .toThrow(/seeded RANDOMIZE is not implemented/);
  });
});
