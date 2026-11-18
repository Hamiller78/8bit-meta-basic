/** Build an isolated JKCEMU profile which types a listing into KC 85/3 BASIC. */
export function kc85AutoInputProfile(listing, version = "0.9.9.1") {
  const lines = listing.replace(/\r\n?/gu, "\n").split("\n");
  while (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) throw new Error("The KC 85 BASIC listing is empty.");
  let previous = -1;
  for (const line of lines) {
    const match = /^(\d+) (.*)$/u.exec(line);
    if (!match || /[^\x20-\x5a\x5e-\x5f\x61-\x7a]/u.test(line) || line.length > 72) {
      throw new Error("KC 85 AutoInput requires numbered lines of at most 72 characters using JKCEMU's supported input characters.");
    }
    const number = Number(match[1]);
    if (number <= previous || number > 65529) throw new Error("KC 85 BASIC line numbers must increase and not exceed 65529.");
    previous = number;
  }
  const inputs = [
    { wait: 5000, text: "SWITCH 8 43\rBASIC\r" },
    { wait: 3000, text: "\r" },
    { wait: 1000, text: `${lines.join("\r")}\r` },
    { wait: 1000, text: "RUN\r" }
  ];
  return profileXml(inputs, [], version);
}

/** Stage a tokenized BASIC program for loading after BASIC has initialized. */
export function kc85AutoLoadProfile(file, version = "0.9.9.1") {
  if (!file || /[\r\n]/u.test(file)) throw new Error("A valid KC 85 BASIC file path is required.");
  return profileXml([
    { wait: 5000, text: "SWITCH 8 43\rBASIC\r" },
    { wait: 3000, text: "\r" },
    { wait: 12000, text: "RUN\r" }
  ], [["jkcemu.kc85_3.autoload.count", "1"],
    ["jkcemu.kc85_3.autoload.0.wait.millis", "15000"],
    ["jkcemu.kc85_3.autoload.0.file", file]], version);
}

function profileXml(inputs, extraEntries, version) {
  if (version !== "0.9.9.1") throw new Error(`JKCEMU ${version} is not supported by this profile; expected 0.9.9.1.`);
  const entries = [
    ["jkcemu.version", version], ["jkcemu.system", "KC85_3"],
    ["jkcemu.kc85_3.module.count", "2"], ["jkcemu.kc85_3.module.08.name", "M011"], ["jkcemu.kc85_3.module.0C.name", "M008"], ...extraEntries,
    ["jkcemu.kc85_3.autoinput.count", String(inputs.length)],
    ...inputs.flatMap((input, index) => [
      [`jkcemu.kc85_3.autoinput.${index}.wait.millis`, String(input.wait)],
      [`jkcemu.kc85_3.autoinput.${index}.input_text`, encodeURIComponent(input.text)]
    ])
  ];
  const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd">\n<properties>\n${entries.map(([key, value]) => `  <entry key="${escape(key)}">${escape(value)}</entry>`).join("\n")}\n</properties>\n`;
}
