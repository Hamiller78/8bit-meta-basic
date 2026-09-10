import type { Expression, PrintStatement, Program, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { builtinFunctions } from "./functions.js";
import type { TargetId } from "./targets/index.js";
import { targetEnvironments } from "./targets/environment.js";

export type TextFont = "default" | "uppercase" | "mixed";
export interface TextOptions {
  readonly language?: string;
  readonly font?: TextFont;
  readonly texts?: Readonly<Record<string, string>>;
}

export function requireLanguage(value: string): string {
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value)) {
    throw new Error(`Invalid language "${value}". Use a language code such as en or de.`);
  }
  return value.toLowerCase();
}

export function requireTextFont(value: string): TextFont {
  if (value !== "default" && value !== "uppercase" && value !== "mixed") {
    throw new Error(`Invalid font "${value}". Expected default, uppercase, or mixed.`);
  }
  return value;
}

function mapStatements(program: Program, transform: (statement: PrintStatement) => readonly Statement[]): Program {
  const visit = (statements: readonly Statement[]): Statement[] => statements.flatMap((statement): readonly Statement[] => {
    if (statement.kind === "print") return transform(statement);
    if (statement.kind === "if") return [{ ...statement, thenBranch: visit(statement.thenBranch), elseBranch: visit(statement.elseBranch) }];
    if ("body" in statement) return [{ ...statement, body: visit(statement.body) }];
    return [statement];
  });
  return { ...program, statements: visit(program.statements) };
}

/** Resource I/O belongs to the build shell; the compiler only consumes text values. */
export function resolveTextResources(program: Program, options: TextOptions): Program {
  return mapStatements(program, (statement) => {
    if (!statement.textResource) return [statement];
    const key = statement.items[0];
    if (key?.kind !== "string") throw new DiagnosticError(statement.location, "PRINT_TEXT requires a literal resource name, such as PRINT_TEXT \"intro\".");
    const value = Object.hasOwn(options.texts ?? {}, key.value) ? options.texts![key.value] : undefined;
    if (value === undefined) throw new DiagnosticError(statement.location, `Missing text resource "${key.value}" for language "${options.language ?? "en"}".`);
    return [{ ...statement, textResource: false, items: [{ kind: "string", value, location: statement.location }] }];
  });
}

/** Runs after constant folding, before control-flow lowering. */
export function layoutText(program: Program, target: TargetId, options: TextOptions): Program {
  const columns = targetEnvironments[target].textColumns;
  const font = options.font ?? "default";
  return mapStatements(program, (statement) => {
    if (!statement.layout) return [statement];
    const item = statement.items[0];
    if (item?.kind !== "string") throw new DiagnosticError(statement.location, "Text layout requires a compile-time string; runtime text cannot be wrapped at compile time.");
    let value = portableText(item.value, statement);
    if (font === "uppercase" || (target === "c64" && font !== "mixed")) value = value.toUpperCase();
    const width = statement.wrapWidth;
    if (width && (width.kind !== "number" || !Number.isInteger(width.value) || width.value < 1 || width.value > columns)) {
      throw new DiagnosticError(statement.location, `Text width must be a compile-time integer in 1..${columns}.`);
    }
    const available = width?.kind === "number" ? width.value : columns;
    const lines = wrapText(value, available);
    return lines.flatMap((line): PrintStatement[] => {
      const text = statement.layout === "center" ? " ".repeat(Math.floor((available - line.length) / 2)) + line : line;
      const items = encodeText(text, target, font, statement);
      return [{ kind: "print", items, layoutOutput: true, trailingSemicolon: target !== "spectrum" && text.length === columns, location: statement.location }];
    });
  });
}

export function wrapText(value: string, columns: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r\n?/g, "\n").replace(/\n$/, "").split(/\n\s*\n/)) {
    if (lines.length) lines.push("");
    let line = "";
    for (let word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > columns) { lines.push(line); line = ""; }
      while (word.length > columns) { lines.push(word.slice(0, columns)); word = word.slice(columns); }
      if (word) line += (line ? " " : "") + word;
    }
    if (line || !paragraph.trim()) lines.push(line);
  }
  return lines;
}

function portableText(value: string, statement: PrintStatement): string {
  const replacements: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss", ẞ: "SS", '“': '"', '”': '"', '„': '"', '’': "'", '–': "-", '—': "-", '…': "..." };
  const text = value.replace(/[äöüÄÖÜßẞ“”„’–—…]/g, (char) => replacements[char]);
  const unsupported = text.match(/[^\x20-\x7e\r\n\t]/u);
  if (unsupported) throw new DiagnosticError(statement.location, `Unsupported text character "${unsupported[0]}". Use portable text or a supported German transliteration.`);
  return text;
}

function encodeText(text: string, target: TargetId, font: TextFont, statement: PrintStatement): Expression[] {
  const location = statement.location;
  const items: Expression[] = [];
  let literal = "";
  const flush = () => { if (literal) { items.push({ kind: "string", value: literal, location }); literal = ""; } };
  for (const char of text) {
    let code: number | undefined;
    if (char === '"') code = 34;
    else if ((target === "c64" && /[\\^_`{|}~]/.test(char)) || (target === "spectrum" && /[\\^`]/.test(char)) || (target === "atari800xl" && /[`{|}~]/.test(char))) {
      throw new DiagnosticError(location, `Character "${char}" is not available in the selected ${target} text font.`);
    }
    if (code !== undefined) {
      flush();
      items.push({ kind: "function-call", name: builtinFunctions.chr, args: [{ kind: "number", value: code, raw: String(code), location }], valueType: "string", location });
    } else literal += target === "c64" && font !== "mixed" ? char.toUpperCase() : char;
  }
  flush();
  return items.length ? items : [{ kind: "string", value: "", location }];
}

export function usesTextLayout(program: Program): boolean {
  const visit = (statements: readonly Statement[]): boolean => statements.some((statement) => {
    if (statement.kind === "print" && statement.layout) return true;
    if (statement.kind === "if") return visit(statement.thenBranch) || visit(statement.elseBranch);
    return "body" in statement && visit(statement.body);
  });
  return visit(program.statements);
}

/** Split encoded text only after logical PRINT capture has been handled. */
export function splitTextItems(items: readonly Expression[]): readonly (readonly Expression[])[] {
  const groups: Expression[][] = [];
  let group: Expression[] = [];
  let size = 0;
  for (const expression of items) {
    const cost = expression.kind === "string" ? expression.value.length + 3 : 11;
    if (size + cost > 55 && group.length) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(expression);
    size += cost;
  }
  groups.push(group);
  return groups;
}
