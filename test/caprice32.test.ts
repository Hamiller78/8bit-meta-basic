import { describe, expect, it } from "vitest";
import { capriceConfiguration, capriceLaunchArguments, instrumentCpcTestListing } from "../scripts/lib/caprice32.mjs";
import { capriceSpawnOptions, parseCpcArgs } from "../scripts/lib/launch-cpc.mjs";

describe("Caprice32 launch preparation", () => {
  it("creates a separate configuration with printer capture and installation resources", () => {
    const base = "[system]\nauto_pause=1\nprinter=0\nresources_path=\n[file]\nprinter_file=./printer.dat\n[rom]\nrom_path=\n";
    const configured = capriceConfiguration(base, "emulator/cap32.exe", "build/capture.txt");
    expect(configured).toContain("auto_pause=0\nprinter=1");
    expect(configured).toMatch(/resources_path=.*emulator\/resources\//);
    expect(configured).toMatch(/printer_file=.*build\/capture\.txt/);
    expect(configured).toMatch(/rom_path=.*emulator\/rom\//);
    expect(base).toContain("printer=0");
    const custom = capriceConfiguration(base.replace("rom_path=", "rom_path=custom-roms"), "emulator/cap32.exe", "build/capture.txt");
    expect(custom).toMatch(/rom_path=.*emulator\/custom-roms/);
    expect(() => capriceConfiguration("[system]\nprinter=0", "cap32.exe", "out.txt")).toThrow(/missing/);
  });

  it("passes the disk and an automatic BASIC run command as separate arguments", () => {
    const args = capriceLaunchArguments("config.cfg", "program.dsk", "main.bas");
    expect(args[0]).toMatch(/^--cfg_file=.*config\.cfg$/);
    expect(args[1]).toBe('--autocmd=RUN"MAIN.BAS"');
    expect(args[2]).toMatch(/program\.dsk$/);
    expect(() => capriceLaunchArguments("x", "y", 'BAD".BAS')).toThrow(/8.3/);
  });

  it("instruments the runner without replacing its existing line numbers", () => {
    const listing = instrumentCpcTestListing('10 PRINT "START"\n20 END\n');
    expect(listing).toContain('5 ON ERROR GOTO 65000\n10 PRINT "START"');
    expect(listing).toContain('20 FOR ZZ=1 TO 40:PRINT #8,"__MBCPC FLUSH__";STRING$(180,45):NEXT:END');
    expect(listing).toContain('65000 PRINT #8,"ERROR";ERR;" AT";ERL');
    expect(() => instrumentCpcTestListing("5 END\n")).toThrow(/line 5/);
    expect(() => instrumentCpcTestListing("10 PRINT 1\n")).toThrow(/END/);
  });

  it("defaults to visible launches and validates test options", () => {
    const options = parseCpcArgs(["--project", "project", "--run-tests", "--module", "storage", "--printer-output", "--restart"]);
    expect(options).toMatchObject({ projectPath: "project", testMode: true, moduleName: "storage", testPrinterOutput: true, restart: true, hidden: false });
    expect(() => parseCpcArgs(["--module", "storage"])).toThrow(/requires/);
    expect(() => parseCpcArgs(["--test-output-device", "rs232"])).toThrow(/printer/);
  });

  it("applies window hiding only on Windows and reports unsupported hidden launches", () => {
    expect(capriceSpawnOptions(true, "win32")).toEqual({ stdio: "ignore", windowsHide: true });
    expect(capriceSpawnOptions(false, "win32")).toEqual({ stdio: "ignore", windowsHide: false });
    expect(capriceSpawnOptions(false, "linux")).toEqual({ stdio: "ignore" });
    expect(capriceSpawnOptions(false, "darwin")).toEqual({ stdio: "ignore" });
    expect(capriceSpawnOptions(false, "win32", true)).toEqual({ stdio: "ignore", detached: true, windowsHide: false });
    expect(capriceSpawnOptions(false, "linux", true)).toEqual({ stdio: "ignore", detached: true });
    expect(() => capriceSpawnOptions(true, "linux")).toThrow(/only on Windows/);
    expect(() => capriceSpawnOptions(true, "darwin")).toThrow(/only on Windows/);
  });
});
