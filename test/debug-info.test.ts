import { describe, expect, it } from "vitest";
import { compileSourceDetailed } from "../src/compiler.js";

describe("compiler debug information", () => {
  it.each(["spectrum", "atari800xl", "c64"] as const)("maps final %s BASIC lines, labels, and function storage", (target) => {
    const source = [
      "value = Twice(3)",
      "start:",
      "print value",
      "goto start",
      "FUNCTION Twice(Input)",
      "LOCAL Work",
      "Work = Input * 2",
      "RETURN Work",
      "END FUNCTION"
    ].join("\n");
    const result = compileSourceDetailed(source, { filename: "mapping.mbas", target, readability: 0 });
    const { debugInfo } = result;
    const basicLines = result.output.trimEnd().split("\n").map((line) => Number.parseInt(line, 10));

    expect(debugInfo.formatVersion).toBe(1);
    expect(debugInfo.target).toBe(target);
    expect(debugInfo).toMatchObject({ language: "en", font: "default", testMode: false });
    expect(debugInfo.sourceFiles).toEqual(["mapping.mbas"]);
    expect(debugInfo.lines.map((line) => line.basicLine)).toEqual(basicLines);
    expect(debugInfo.lines.find((line) => line.instruction === "print" && line.source.line === 3)).toBeDefined();
    expect(debugInfo.labels.find((label) => label.name.toLowerCase() === "start")?.basicLine).toBe(
      debugInfo.lines.find((line) => line.instruction === "print" && line.source.line === 3)?.basicLine
    );

    const fn = debugInfo.functions.find((item) => item.name === "Twice");
    expect(fn?.entryLine).toBeTypeOf("number");
    expect(result.output).toMatch(new RegExp(`(?:GO SUB|GOSUB) ${fn?.entryLine}`));
    expect(fn?.parameters[0]).toMatchObject({ sourceName: "Input", targetName: expect.any(String) });
    expect(fn?.locals[0]).toMatchObject({ sourceName: "Work", targetName: expect.any(String) });
    expect(debugInfo.variables.find((variable) => variable.storageName === fn?.locals[0].storageName.toLowerCase())).toMatchObject({
      targetName: fn?.locals[0].targetName,
      sourceAliases: expect.arrayContaining([expect.objectContaining({ name: "Twice.Work" })])
    });
  });

  it("records all aliases when separate functions share generated local storage", () => {
    const result = compileSourceDetailed([
      "print First(1); Second(2)",
      "FUNCTION First(Value)",
      "LOCAL Temp",
      "Temp = Value + 1",
      "RETURN Temp",
      "END FUNCTION",
      "FUNCTION Second(Value)",
      "LOCAL Temp",
      "Temp = Value + 2",
      "RETURN Temp",
      "END FUNCTION"
    ].join("\n"), { filename: "shared.mbas", target: "c64", readability: 0 });
    const [first, second] = result.debugInfo.functions;
    expect(first.locals[0].storageName).toBe(second.locals[0].storageName);
    const variable = result.debugInfo.variables.find((item) => item.storageName === first.locals[0].storageName.toLowerCase());
    expect(variable?.sourceAliases.map((alias) => alias.name)).toEqual(expect.arrayContaining(["First.Temp", "Second.Temp"]));
  });

  it("marks expanded inline functions without inventing a BASIC entry line", () => {
    const result = compileSourceDetailed([
      "print Double(3)",
      "INLINE FUNCTION Double(Value)",
      "RETURN Value * 2",
      "END FUNCTION"
    ].join("\n"), { filename: "inline.mbas", target: "spectrum", readability: 0 });
    expect(result.debugInfo.functions).toMatchObject([{ name: "Double", inline: true }]);
    expect(result.debugInfo.functions[0].entryLine).toBeUndefined();
  });

  it("maps variables that are only read in source expressions", () => {
    const result = compileSourceDetailed("print ReadOnly\n", { filename: "read.mbas", target: "c64", readability: 0 });
    expect(result.debugInfo.variables).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceAliases: [expect.objectContaining({ name: "ReadOnly" })] })
    ]));
  });

  it.each(["spectrum", "atari800xl", "c64"] as const)("maps %s struct fields to native array storage", (target) => {
    const source = [
      "STRUCT Pair",
      "Left%",
      "Right%",
      "Name$(8)",
      "END STRUCT",
      "DIM entries AS Pair(3)",
      "entries(0).Left% = 7",
      "entries(0).Right% = 8",
      "print entries(0).Name$"
    ].join("\n");
    const result = compileSourceDetailed(source, { filename: "fields.mbas", target, readability: 0 });
    const left = result.debugInfo.structFields.find((field) => field.sourceName === "entries.Left%");
    const right = result.debugInfo.structFields.find((field) => field.sourceName === "entries.Right%");
    const name = result.debugInfo.structFields.find((field) => field.sourceName === "entries.Name$");
    expect(left?.targetName).toBeTruthy();
    expect(right?.targetName).toBeTruthy();
    expect(name?.targetName).toBeTruthy();
    expect(result.output).toContain(`DIM ${left?.targetName}(`);
    expect(left?.targetElementIndexBase).toBe(target === "spectrum" ? 1 : 0);
    if (target === "atari800xl") {
      expect(left?.targetFieldIndex).toBeUndefined();
      expect(right?.targetFieldIndex).toBeUndefined();
      expect(left?.targetName).not.toBe(right?.targetName);
    } else {
      expect(left?.targetName).toBe(right?.targetName);
      expect(left?.targetFieldIndex).toBe(target === "spectrum" ? 1 : 0);
      expect(right?.targetFieldIndex).toBe(target === "spectrum" ? 2 : 1);
    }
  });
});
