import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtinFunctions } from "../src/functions.js";
import { keywords } from "../src/lexer.js";

const grammar = JSON.parse(readFileSync("vscode-extension/syntaxes/metabasic.tmLanguage.json", "utf8")) as unknown;

describe("VS Code syntax highlighting", () => {
  it("mentions every lexer keyword", () => {
    const text = JSON.stringify(grammar).toUpperCase();

    for (const keyword of keywords) {
      expect(text, `Missing syntax highlighting entry for keyword ${keyword}`).toContain(keyword);
    }
  });

  it("mentions every built-in function", () => {
    const text = JSON.stringify(grammar).toUpperCase().replace(/\\/g, "");

    for (const functionName of Object.values(builtinFunctions)) {
      expect(text, `Missing syntax highlighting entry for function ${functionName}`).toContain(functionName);
    }
  });
});
