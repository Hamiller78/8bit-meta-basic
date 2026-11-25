import { describe, expect, it } from "vitest";
import { parseAppleWinArgs, verifyAppleWinCapture } from "../scripts/lib/launch-applewin.mjs";
import { launcherScriptFor } from "../scripts/target-configurations.mjs";

describe("AppleWin launcher", () => {
  it("selects the AppleWin launcher and preserves external project paths", () => {
    expect(launcherScriptFor({ emulator: { type: "applewin" } })).toBe("scripts/launch-applewin.mjs");
    const options = parseAppleWinArgs(["--target-configuration", "apple2", "--project", "C:/outside/project", "--hidden", "--skip-build", "--restart"]);
    expect(options.projectPath).toBe("C:/outside/project");
    expect(options.hidden).toBe(true);
    expect(options.runBuild).toBe(false);
    expect(options.restart).toBe(true);
  });
  it("validates test options and conflicting inputs", () => {
    expect(() => parseAppleWinArgs(["--source", "a.mbas", "--project", "project"])).toThrow(/select only one/i);
    expect(() => parseAppleWinArgs(["--printer-output"])).toThrow(/require --run-tests/i);
    expect(() => parseAppleWinArgs(["--run-tests", "--test-output-device", "rs232"])).toThrow(/printer/i);
    expect(() => parseAppleWinArgs(["--project"])).toThrow(/missing value/i);
    expect(parseAppleWinArgs(["--project", "p", "--run-tests", "--module", "screen", "--printer-output"]).testPrinterOutput).toBe(true);
  });
  it("accepts only a complete matching passing capture", () => {
    const capture = 'META CONTROL PROGRAM (M.C.P.) RUN FINISHED\nTESTS: 2\nPASSED: 2\nFAILED: 0\nASSERTIONS: 3\nFAILURES: 0\nFREE MEMORY: 100\n';
    expect(verifyAppleWinCapture(capture, 2)).toBe(true);
    expect(verifyAppleWinCapture(capture.replace('FAILURES: 0', 'FAILURES: 1'), 2)).toBe(false);
    expect(verifyAppleWinCapture(capture, 3)).toBe(false);
    expect(verifyAppleWinCapture(capture.replace('FREE MEMORY: 100', ''), 2)).toBe(false);
  });
});
