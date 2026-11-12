import { dirname, resolve } from "node:path";

/** Build an isolated Caprice32 configuration without changing the installation. */
export function capriceConfiguration(base, emulatorPath, printerPath) {
  const installation = dirname(resolve(emulatorPath)).replaceAll("\\", "/");
  const replacements = {
    "system.auto_pause": "0",
    "system.printer": "1",
    "system.resources_path": `${installation}/resources/`,
    "file.printer_file": resolve(printerPath).replaceAll("\\", "/"),
    "rom.rom_path": `${installation}/rom/`
  };
  const found = new Set();
  let section = "";
  const lines = base.split(/\r?\n/u).map((line) => {
    const header = /^\s*\[([^\]]+)\]/u.exec(line);
    if (header) section = header[1].toLowerCase();
    const property = /^\s*([^#;=\s]+)\s*=/u.exec(line);
    if (!property) return line;
    const key = `${section}.${property[1].toLowerCase()}`;
    if (!Object.hasOwn(replacements, key)) return line;
    found.add(key);
    const configured = line.slice(line.indexOf("=") + 1).trim();
    const value = (key === "system.resources_path" || key === "rom.rom_path") && configured
      ? resolve(installation, configured).replaceAll("\\", "/")
      : replacements[key];
    return `${property[1]}=${value}`;
  });
  const missing = Object.keys(replacements).filter((key) => !found.has(key));
  if (missing.length) throw new Error(`Caprice32 configuration is missing: ${missing.join(", ")}.`);
  return lines.join("\n");
}

export function capriceLaunchArguments(configPath, diskPath, basicName = "MAIN.BAS") {
  if (!/^[A-Z0-9_]{1,8}\.[A-Z0-9_]{1,3}$/iu.test(basicName)) {
    throw new Error("CPC BASIC filename must have an 8.3 alphanumeric or underscore name.");
  }
  return [`--cfg_file=${resolve(configPath)}`, `--autocmd=RUN"${basicName.toUpperCase()}"`, resolve(diskPath)];
}

/** Add a runtime-error report and flush Caprice32's buffered printer output. */
export function instrumentCpcTestListing(listing) {
  const lines = [...listing.matchAll(/^\s*(\d+)\b/gmu)].map((match) => Number(match[1]));
  if (!lines.length || Math.min(...lines) <= 5 || Math.max(...lines) >= 65000) {
    throw new Error("CPC test instrumentation needs line 5 and line 65000 to be free.");
  }
  const withFlush = listing.replace(/^(\d+) END\s*$/mu, '$1 FOR ZZ=1 TO 40:PRINT #8,"__MBCPC FLUSH__";STRING$(180,45):NEXT:END');
  if (withFlush === listing) throw new Error("CPC test runner has no standalone END line to instrument.");
  return `5 ON ERROR GOTO 65000\n${withFlush.trimEnd()}\n65000 PRINT #8,"ERROR";ERR;" AT";ERL:FOR ZZ=1 TO 40:PRINT #8,"__MBCPC FLUSH__";STRING$(180,45):NEXT:END\n`;
}
