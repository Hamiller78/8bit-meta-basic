import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("VIC-20 compiler", () => {
  it("uses the expanded VIC-20 text screen and cursor routine", () => {
    expect(compileSource('print_at TEXT_ROWS, TEXT_COLUMNS, "EDGE"\n', {
      filename: "vic20.mbas",
      target: "vic20",
      readability: 0
    })).toBe('10 POKE 214,22:POKE 211,21:SYS 58759:PRINT "EDGE"\n');
  });

  it("reports VIC-20 coordinate ranges", () => {
    expect(() => compileSource('print_at 24, 1, "NO"\n', { filename: "range.mbas", target: "vic20" })).toThrow(
      "VIC-20 PRINT_AT row coordinate 24 is outside the supported range 1..23"
    );
    expect(() => compileSource('print_at 1, 23, "NO"\n', { filename: "range.mbas", target: "vic20" })).toThrow(
      "VIC-20 PRINT_AT column coordinate 23 is outside the supported range 1..22"
    );
  });

  it("preserves the other VIC colour-register bits", () => {
    const output = compileSource("screen_border_color RED\nscreen_background_color BLUE\n", {
      filename: "colors.mbas",
      target: "vic20",
      readability: 0
    });
    expect(output).toContain("POKE 36879");
    expect(output).toContain("PEEK(36879) AND 248");
    expect(output).toContain("PEEK(36879) AND 15");
  });

  it("reads screen memory through the KERNAL screen-page pointer", () => {
    const output = compileSource("code = screen_code(1, 1)\n", {
      filename: "screen.mbas",
      target: "vic20",
      readability: 0
    });
    expect(output).toContain("PEEK(648)*256-23+1*22+1");
  });

  it("temporarily exposes the VIC joystick right-direction bit", () => {
    const output = compileSource("x = get_joystick(JOY_X)\ny = get_joystick(JOY_Y)\nf = get_joystick(JOY_FIRE1)\n", {
      filename: "joystick.mbas",
      target: "vic20",
      readability: 0
    });
    expect(output.match(/POKE 37154,127/g)).toHaveLength(3);
    expect(output.match(/POKE 37154,255/g)).toHaveLength(3);
    expect(output).toContain("PEEK(37152) AND 128");
    expect(output).toContain("PEEK(37137) AND 32");
  });

  it("uses the safe VIC-20 PROGRAM_MODE lowering", () => {
    expect(compileSource("program_mode\n", { filename: "mode.mbas", target: "vic20", readability: 0 })).toBe("10 POKE 204,1\n");
  });

  it("treats the configured VICE text printer as available", () => {
    expect(compileSource("available = device_available(TEXT_PRINTER)\n", {
      filename: "printer.mbas",
      target: "vic20",
      readability: 0
    })).toContain("=1");
  });
});
