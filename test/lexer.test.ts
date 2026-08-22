import { describe, expect, it } from "vitest";
import { keywords, tokenize } from "../src/lexer.js";

describe("lexer", () => {
  it("records token locations for representative tokens", () => {
    const tokens = tokenize('print_at 10,5; "HI"; value\n', "tokens.mbas");

    expect(tokens).toMatchObject([
      { kind: "keyword", text: "PRINT_AT", location: { filename: "tokens.mbas", line: 1, column: 1 } },
      { kind: "number", value: 10, location: { filename: "tokens.mbas", line: 1, column: 10 } },
      { kind: "punctuation", text: ",", location: { filename: "tokens.mbas", line: 1, column: 12 } },
      { kind: "number", value: 5, location: { filename: "tokens.mbas", line: 1, column: 13 } },
      { kind: "punctuation", text: ";", location: { filename: "tokens.mbas", line: 1, column: 14 } },
      { kind: "string", value: "HI", location: { filename: "tokens.mbas", line: 1, column: 16 } },
      { kind: "punctuation", text: ";", location: { filename: "tokens.mbas", line: 1, column: 20 } },
      { kind: "identifier", text: "value", location: { filename: "tokens.mbas", line: 1, column: 22 } },
      { kind: "newline", location: { filename: "tokens.mbas", line: 1, column: 27 } },
      { kind: "eof", location: { filename: "tokens.mbas", line: 2, column: 1 } }
    ]);
  });

  it("treats trailing type markers as part of identifiers", () => {
    const tokens = tokenize('tickerText$ = "READY"\ncount% = 1\nprint tickerText$; count%\n', "typed.mbas");

    expect(tokens).toContainEqual(expect.objectContaining({ kind: "identifier", text: "tickerText$" }));
    expect(tokens).toContainEqual(expect.objectContaining({ kind: "identifier", text: "count%" }));
    expect(tokens.filter((token) => token.kind === "identifier").map((token) => token.text)).toEqual([
      "tickerText$",
      "count%",
      "tickerText$",
      "count%"
    ]);
  });

  it("does not interpret keywords inside strings or comments", () => {
    const tokens = tokenize('print "IF THEN ELSE" \' goto ignored\nx = 1\n', "keywords.mbas");

    expect(tokens.filter((token) => token.kind === "keyword").map((token) => token.text)).toEqual(["PRINT"]);
    expect(tokens).toContainEqual(expect.objectContaining({ kind: "string", value: "IF THEN ELSE" }));
    expect(tokens).not.toContainEqual(expect.objectContaining({ kind: "punctuation", text: "'" }));
  });

  it("recognizes keywords case-insensitively through the centralized keyword set", () => {
    expect(keywords.has("PRINT")).toBe(true);
    expect(keywords.has("BORDER_COLOR")).toBe(true);
    expect(keywords.has("PRINT_AT")).toBe(true);
    expect(keywords.has("AND")).toBe(true);
    expect(keywords.has("FOR")).toBe(true);
    expect(keywords.has("NEXT")).toBe(true);
    expect(keywords.has("TO")).toBe(true);
    expect(keywords.has("STEP")).toBe(true);
    expect(keywords.has("AT")).toBe(false);
    expect(keywords.has("LET")).toBe(false);
    expect(tokenize("pRiNt true and false\n", "case.mbas").filter((token) => token.kind === "keyword").map((token) => token.text)).toEqual([
      "PRINT",
      "TRUE",
      "AND",
      "FALSE"
    ]);
  });
});
