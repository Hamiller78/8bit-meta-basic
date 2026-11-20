import { describe, expect, it } from "vitest";
import { renderKc85Line } from "../src/targets/kc85-render.js";

const location = { filename: "screen.mbas", line: 1 };
const number = (value: number) => ({ kind: "number" as const, value, raw: String(value), location });

describe("KC 85 HC-BASIC rendering", () => {
  it("uses zero-based coordinates within the full KC 85/3 window", () => {
    expect(renderKc85Line(10, { kind: "set-position", row: number(3), column: number(4), location }, new Map(), new Map()))
      .toBe("10 LOCATE 2,3");
    expect(renderKc85Line(10, { kind: "set-position", row: number(30), column: number(40), location }, new Map(), new Map()))
      .toBe("10 LOCATE 29,39");
    expect(renderKc85Line(10, { kind: "set-position", row: number(32), column: number(40), location }, new Map(), new Map()))
      .toBe("10 LOCATE 31,39");
    expect(() => renderKc85Line(10, { kind: "set-position", row: number(33), column: number(1), location }, new Map(), new Map()))
      .toThrow(/screen\.mbas:1.*row coordinate 33/);
    expect(() => renderKc85Line(10, { kind: "set-position", row: number(1), column: number(41), location }, new Map(), new Map()))
      .toThrow(/screen\.mbas:1.*column coordinate 41/);
  });

  it("keeps the row relative to the current window when setting the column", () => {
    expect(renderKc85Line(10, { kind: "set-column", column: number(4), location }, new Map(), new Map()))
      .toBe("10 LOCATE CSRLIN(1),3");
  });

  it("uses HC-BASIC foreground and background codes", () => {
    const color = { kind: "color" as const, color: "WHITE" as const, location };
    expect(renderKc85Line(10, { kind: "cls", color, location }, new Map(), new Map())).toBe("10 PAPER 7:CLS");
    expect(renderKc85Line(10, { kind: "cell-text-color", color, location }, new Map(), new Map())).toBe("10 INK 7");
    expect(renderKc85Line(10, { kind: "cell-background-color", color, location }, new Map(), new Map())).toBe("10 PAPER 7");
  });

  it("does not consume subsequent statements when scalar string storage is packed", () => {
    expect(renderKc85Line(10, { kind: "dim-string", name: "message$", length: 20, location }, new Map(), new Map()))
      .toBe('10 PRINT "";');
  });

  it("ignores border colour requests without consuming packed statements", () => {
    const color = { kind: "color" as const, color: "RED" as const, location };
    expect(renderKc85Line(10, { kind: "border-color", color, location }, new Map(), new Map()))
      .toBe('10 PRINT "";');
  });

  it("selects scrolling output without a prompt", () => {
    expect(renderKc85Line(10, { kind: "suppress-scroll-prompt", location }, new Map(), new Map()))
      .toBe("10 PRINT CHR$(18);");
  });

  it("rejects seeded RANDOMIZE, which is not in the documented KC 85 syntax", () => {
    expect(() => renderKc85Line(10, { kind: "randomize", seed: number(5), location }, new Map(), new Map()))
      .toThrow(/seeded RANDOMIZE is not implemented/);
  });
});
