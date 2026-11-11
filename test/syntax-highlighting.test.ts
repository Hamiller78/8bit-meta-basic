import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtinFunctions } from "../src/functions.js";
import { keywords } from "../src/lexer.js";
import { targetEnvironments } from "../src/targets/environment.js";

interface Pattern { readonly match?: string; readonly patterns?: readonly Pattern[] }
interface Grammar { readonly repository: Readonly<Record<string, Pattern>> }
const grammar = JSON.parse(readFileSync("vscode-extension/syntaxes/metabasic.tmLanguage.json", "utf8")) as Grammar;
const configuration = JSON.parse(readFileSync("vscode-extension/language-configuration.json", "utf8")) as { readonly wordPattern: string };

function matches(section: string, source: string): string[] {
  return (grammar.repository[section].patterns ?? []).flatMap((pattern) => {
    if (!pattern.match) return [];
    const expression = new RegExp(pattern.match.replace(/^\(\?i\)/, ""), "i");
    const found = expression.exec(source);
    return found && found.index === 0 ? [found[0]] : [];
  });
}

describe("VS Code syntax highlighting", () => {
  it("matches every lexer keyword as a complete token", () => {
    for (const keyword of keywords) {
      expect(["keywords", "assertions", "constants"].flatMap((section) => matches(section, `${keyword.toLowerCase()} `)), keyword).toContain(keyword.toLowerCase());
    }
  });

  it("matches every built-in function including string suffixes", () => {
    for (const name of Object.values(builtinFunctions)) {
      expect(matches("builtins", `${name.toLowerCase()}(1)`), name).toContain(name.toLowerCase());
    }
  });

  it("matches all environment constants for every target", () => {
    for (const environment of Object.values(targetEnvironments)) {
      for (const name of environment.constants.keys()) {
        expect(matches("constants", `${name} `), name).toContain(name);
      }
    }
    for (const name of ["FILE_STORAGE_TAPE", "FILE_STORAGE_DISK"]) expect(matches("constants", name)).toContain(name);
  });

  it("does not colour a keyword, function or constant prefix inside another identifier", () => {
    for (const identifier of ["PRINT$", "PRINT%", "RND$", "MID$extra", "NOTE_C4$", "JOY_X%", "ASSERT_BEEP_MORE"]) {
      expect(["keywords", "assertions", "builtins", "constants"].flatMap((section) => matches(section, identifier)), identifier).toEqual([]);
    }
  });

  it("matches decimal literals and keeps type suffixes in editor words", () => {
    for (const number of [".5", "0.5", "1.", "42"]) expect(matches("numbers", number)).toContain(number);
    const word = new RegExp(configuration.wordPattern, "g");
    expect("count% name$ .5".match(word)).toEqual(["count%", "name$", ".5"]);
  });
});
