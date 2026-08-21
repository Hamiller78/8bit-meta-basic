import { DiagnosticError } from "./diagnostics.js";
import type { SourceLocation } from "./ast.js";

export const keywords = new Set([
  "AND",
  "BORDER_COLOR",
  "CELL_BACKGROUND_COLOR",
  "CELL_TEXT_COLOR",
  "CLS",
  "CONST",
  "DIM",
  "ELSE",
  "END",
  "ENDIF",
  "FALSE",
  "FOR",
  "FUNCTION",
  "GOSUB",
  "GOTO",
  "IF",
  "LOCAL",
  "NOT",
  "OR",
  "PRINT",
  "PRINT_AT",
  "RETURN",
  "REPEAT",
  "RANDOMIZE",
  "SCREEN_BACKGROUND_COLOR",
  "SCREEN_BORDER_COLOR",
  "SCREEN_TEXT_COLOR",
  "NEXT",
  "STEP",
  "THEN",
  "TO",
  "TEXT_COLOR",
  "TRUE",
  "UNTIL",
  "WEND",
  "WHILE"
]);

export type Keyword = typeof keywords extends Set<infer T> ? T & string : never;

export type Token =
  | IdentifierToken
  | KeywordToken
  | NumberToken
  | StringToken
  | OperatorToken
  | PunctuationToken
  | NewlineToken
  | EofToken;

export interface BaseToken {
  readonly location: Required<SourceLocation>;
}

export interface IdentifierToken extends BaseToken {
  readonly kind: "identifier";
  readonly text: string;
}

export interface KeywordToken extends BaseToken {
  readonly kind: "keyword";
  readonly text: string;
}

export interface NumberToken extends BaseToken {
  readonly kind: "number";
  readonly text: string;
  readonly value: number;
}

export interface StringToken extends BaseToken {
  readonly kind: "string";
  readonly text: string;
  readonly value: string;
}

export interface OperatorToken extends BaseToken {
  readonly kind: "operator";
  readonly text: string;
}

export interface PunctuationToken extends BaseToken {
  readonly kind: "punctuation";
  readonly text: "(" | ")" | ":" | "," | ";" | "=";
}

export interface NewlineToken extends BaseToken {
  readonly kind: "newline";
}

export interface EofToken extends BaseToken {
  readonly kind: "eof";
}

export function tokenize(source: string, filename: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const location = (): Required<SourceLocation> => ({ filename, line, column });

  while (index < source.length) {
    const char = source[index];

    if (char === " " || char === "\t") {
      advance(char);
      continue;
    }

    if (char === "\r" || char === "\n") {
      tokens.push({ kind: "newline", location: location() });
      if (char === "\r" && source[index + 1] === "\n") {
        index += 2;
      } else {
        index += 1;
      }
      line += 1;
      column = 1;
      continue;
    }

    if (char === "'") {
      while (index < source.length && source[index] !== "\r" && source[index] !== "\n") {
        advance(source[index]);
      }
      continue;
    }

    if (char === "\"") {
      tokens.push(scanString(source, filename, location(), () => source[index], advance));
      continue;
    }

    if (isDigit(char) || (char === "." && isDigit(source[index + 1] ?? ""))) {
      tokens.push(scanNumber(source, location(), () => source[index], advance));
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = location();
      let text = "";
      while (index < source.length && isIdentifierPart(source[index])) {
        text += source[index];
        advance(source[index]);
      }
      if (source[index] === "$" || source[index] === "%") {
        text += source[index];
        advance(source[index]);
      }
      const upper = text.toUpperCase();
      tokens.push(keywords.has(upper) ? { kind: "keyword", text: upper, location: start } : { kind: "identifier", text, location: start });
      continue;
    }

    const twoChar = `${char}${source[index + 1] ?? ""}`;
    if (twoChar === "<>" || twoChar === "<=" || twoChar === ">=") {
      tokens.push({ kind: "operator", text: twoChar, location: location() });
      advance(char);
      advance(source[index]);
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/" || char === "^" || char === "<" || char === ">") {
      tokens.push({ kind: "operator", text: char, location: location() });
      advance(char);
      continue;
    }

    if (char === "(" || char === ")" || char === ":" || char === "," || char === ";" || char === "=") {
      tokens.push({ kind: "punctuation", text: char, location: location() });
      advance(char);
      continue;
    }

    throw new DiagnosticError(location(), `Unexpected character "${char}".`);
  }

  tokens.push({ kind: "eof", location: { filename, line, column } });
  return tokens;

  function advance(current: string): void {
    index += 1;
    column += current.length;
  }
}

function scanString(
  source: string,
  filename: string,
  start: Required<SourceLocation>,
  current: () => string | undefined,
  advance: (char: string) => void
): StringToken {
  let text = "";
  let value = "";
  advance("\"");
  text += "\"";

  while (current() !== undefined && current() !== "\r" && current() !== "\n") {
    const char = current();
    if (char === undefined) {
      break;
    }
    if (char === "\"") {
      advance(char);
      text += "\"";
      return { kind: "string", text, value, location: start };
    }

    value += char;
    text += char;
    advance(char);
  }

  throw new DiagnosticError(start, `Unterminated string literal in ${filename}.`);
}

function scanNumber(
  source: string,
  start: Required<SourceLocation>,
  current: () => string | undefined,
  advance: (char: string) => void
): NumberToken {
  let text = "";

  while (current() !== undefined && isDigit(current() ?? "")) {
    text += current();
    advance(current() ?? "");
  }

  if (current() === ".") {
    text += ".";
    advance(".");
    while (current() !== undefined && isDigit(current() ?? "")) {
      text += current();
      advance(current() ?? "");
    }
  }

  return { kind: "number", text, value: Number(text), location: start };
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && /[0-9]/.test(char);
}
