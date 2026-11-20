import { describe, expect, it } from "vitest";
import { kc85AutoInputProfile, kc85AutoLoadProfile } from "../scripts/lib/jkcemu.mjs";
import { parseKc85Args } from "../scripts/lib/launch-kc85.mjs";

describe("JKCEMU KC 85/3 AutoInput profile", () => {
  it("uses a fresh KC 85/3 and enters the listing after BASIC starts", () => {
    const profile = kc85AutoInputProfile('10 PRINT "A&B"\n20 END\n');
    expect(profile).toContain('<entry key="jkcemu.system">KC85_3</entry>');
    expect(profile).toContain('<entry key="jkcemu.version">0.9.9.1</entry>');
    expect(profile).toContain('<entry key="jkcemu.kc85_3.module.08.name">M011</entry>');
    expect(profile).toContain('SWITCH%208%2043%0DBASIC%0D');
    expect(profile).toContain("BASIC%0D");
    expect(profile).toContain("10%20PRINT%20%22A%26B%22%0D20%20END%0D");
    expect(profile).toContain("RUN%0D");
  });

  it("rejects invalid, unordered, and overlong lines", () => {
    expect(() => kc85AutoInputProfile("")).toThrow(/empty/);
    expect(() => kc85AutoInputProfile("10 PRINT 1\n10 END\n")).toThrow(/increase/);
    expect(() => kc85AutoInputProfile(`10 PRINT "${"A".repeat(70)}"\n`)).toThrow(/72/);
    expect(() => kc85AutoInputProfile("10 PRINT \"é\"\n")).toThrow(/supported input characters/);
    expect(() => kc85AutoInputProfile('10 PRINT "["\n')).toThrow(/supported input characters/);
    expect(() => kc85AutoInputProfile('10 PRINT "ä"\n')).toThrow(/fast loader/);
    expect(() => kc85AutoInputProfile("10 END\n", "0.9.8")).toThrow(/expected 0\.9\.9\.1/);
  });

  it("creates an isolated binary-load profile with an escaped path", () => {
    const profile = kc85AutoLoadProfile('C:\\Build & Test\\demo.sss');
    expect(profile).toContain('C:\\Build &amp; Test\\demo.sss');
    expect(profile).toContain('<entry key="jkcemu.kc85_3.module.count">2</entry>');
    expect(profile).toContain('<entry key="jkcemu.kc85_3.module.0C.name">M021</entry>');
    expect(profile).toContain('SWITCH%208%2043%0DBASIC%0D');
    expect(profile).toContain('<entry key="jkcemu.kc85_3.autoload.0.wait.millis">15000</entry>');
    expect(profile).toContain("RUN%0D");
  });

  it("requires test mode for screen capture", () => {
    expect(() => parseKc85Args(["--printer-output"])).toThrow(/requires --run-tests/);
    expect(parseKc85Args(["--run-tests", "--printer-output"]).capture).toBe(true);
    expect(parseKc85Args(["--source", "demo.mbas", "--skip-build"]).source).toBe("demo.mbas");
    expect(parseKc85Args(["--capture-printer"]).printerCapture).toBe(true);
    expect(() => parseKc85Args(["--capture-printer", "--run-tests", "--printer-output"])).toThrow(/cannot be combined/);
    expect(parseKc85Args(["--project", "project", "--run-tests", "--module", "data"]).moduleName).toBe("data");
    expect(() => parseKc85Args(["--module", "data"])).toThrow(/requires --project and --run-tests/);
  });

  it("loads tokenized BASIC by default and permits typed input", () => {
    expect(parseKc85Args([]).fastLoad).toBe(true);
    expect(parseKc85Args(["--type-in"]).fastLoad).toBe(false);
    expect(parseKc85Args(["--type-in", "--fast-load"]).fastLoad).toBe(true);
  });
});
