import type { Expression, PrintStatement, Program, Statement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { builtinFunctions, canonicalFunctionName } from "./functions.js";
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
    const textBindings = statement.textBindings?.map((binding) => ({
      ...binding,
      expression: resolveTextExpression(binding.expression, options),
      maxLength: resolveTextExpression(binding.maxLength, options)
    }));
    if (!statement.textResource) {
      return [{ ...statement, items: statement.items.map((item) => resolveTextExpression(item, options)), ...(textBindings ? { textBindings } : {}) }];
    }
    const key = statement.items[0];
    if (key?.kind !== "string") throw new DiagnosticError(statement.location, "PRINT_TEXT requires a literal resource name, such as PRINT_TEXT \"intro\".");
    const value = resolveTextValue(key.value, statement.location, options);
    return [{
      ...statement,
      textResource: false,
      items: [{ kind: "string", value, location: statement.location }],
      textBindings: textBindings ?? []
    }];
  });
}

function resolveTextExpression(expression: Expression, options: TextOptions): Expression {
  switch (expression.kind) {
    case "function-call": {
      if (canonicalFunctionName(expression.name) === builtinFunctions.text) {
        if (expression.args.length !== 1 || expression.args[0]?.kind !== "string") {
          throw new DiagnosticError(expression.location, "TEXT$ expects exactly one literal resource name, such as TEXT$(\"continue\").");
        }
        return { kind: "string", value: resolveTextValue(expression.args[0].value, expression.location, options), location: expression.location };
      }
      return { ...expression, args: expression.args.map((arg) => resolveTextExpression(arg, options)) };
    }
    case "array-access":
    case "struct-field-access":
      return { ...expression, indices: expression.indices.map((index) => resolveTextExpression(index, options)) };
    case "parenthesized":
      return { ...expression, expression: resolveTextExpression(expression.expression, options) };
    case "unary":
      return { ...expression, operand: resolveTextExpression(expression.operand, options) };
    case "binary":
      return { ...expression, left: resolveTextExpression(expression.left, options), right: resolveTextExpression(expression.right, options) };
    default:
      return expression;
  }
}

function resolveTextValue(key: string, location: PrintStatement["location"], options: TextOptions): string {
  const value = Object.hasOwn(options.texts ?? {}, key) ? options.texts![key] : undefined;
  if (value === undefined) throw new DiagnosticError(location, `Missing text resource "${key}" for language "${options.language ?? "en"}".`);
  return value;
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
    if (!statement.textBindings && (font === "uppercase" || (target === "c64" && font !== "mixed"))) value = value.toUpperCase();
    const width = statement.wrapWidth;
    if (width && (width.kind !== "number" || !Number.isInteger(width.value) || width.value < 1 || width.value > columns)) {
      throw new DiagnosticError(statement.location, `Text width must be a compile-time integer in 1..${columns}.`);
    }
    const available = width?.kind === "number" ? width.value : columns;
    if (statement.textBindings) {
      return layoutTextTemplate(value, available, columns, target, font, statement);
    }
    const lines = wrapText(value, available);
    return lines.flatMap((line): PrintStatement[] => {
      const text = statement.layout === "center" ? " ".repeat(Math.floor((available - line.length) / 2)) + line : line;
      const items = encodeText(text, target, font, statement);
      return [{ kind: "print", items, layoutOutput: true, trailingSemicolon: target !== "spectrum" && text.length === columns, location: statement.location }];
    });
  });
}

interface TemplateLiteralPart {
  readonly kind: "literal";
  readonly value: string;
}

interface TemplateValuePart {
  readonly kind: "value";
  readonly expression: Expression;
  readonly maxLength: number;
  readonly name: string;
}

type TemplatePart = TemplateLiteralPart | TemplateValuePart;

function layoutTextTemplate(
  value: string,
  available: number,
  columns: number,
  target: TargetId,
  font: TextFont,
  statement: PrintStatement
): PrintStatement[] {
  const bindings = new Map<string, TemplateValuePart>();
  for (const binding of statement.textBindings ?? []) {
    const key = binding.name.toLowerCase();
    if (bindings.has(key)) {
      throw new DiagnosticError(binding.location, `Duplicate PRINT_TEXT placeholder binding "${binding.name}".`);
    }
    if (binding.maxLength.kind !== "number" || !Number.isInteger(binding.maxLength.value) || binding.maxLength.value < 1) {
      throw new DiagnosticError(binding.maxLength.location, `PRINT_TEXT placeholder "${binding.name}" maximum length must be a positive compile-time integer.`);
    }
    if (binding.maxLength.value > available) {
      throw new DiagnosticError(
        binding.maxLength.location,
        `PRINT_TEXT placeholder "${binding.name}" maximum length ${binding.maxLength.value} exceeds the available text width ${available}.`
      );
    }
    bindings.set(key, { kind: "value", expression: binding.expression, maxLength: binding.maxLength.value, name: binding.name });
  }

  const used = new Set<string>();
  const template = parseTextTemplate(value, bindings, used, statement);
  for (const [key, binding] of bindings) {
    if (!used.has(key)) {
      throw new DiagnosticError(statement.location, `PRINT_TEXT placeholder binding "${binding.name}" is not used by the selected text resource.`);
    }
  }

  const transformed = template.map((part): TemplatePart => part.kind === "literal"
    ? { ...part, value: font === "uppercase" || (target === "c64" && font !== "mixed") ? part.value.toUpperCase() : part.value }
    : part);
  const lines = wrapTemplate(transformed, available, statement);
  return lines.map((line) => {
    const centered = statement.layout === "center"
      ? [{ kind: "literal" as const, value: " ".repeat(Math.floor((available - templateLength(line)) / 2)) }, ...line]
      : line;
    const merged = mergeTemplateLiterals(centered);
    const items = merged.flatMap((part): Expression[] => part.kind === "value"
      ? [part.expression]
      : encodeText(part.value, target, font, statement));
    const staticLength = merged.every((part) => part.kind === "literal") ? templateLength(merged) : undefined;
    return {
      kind: "print",
      items: items.length ? items : [{ kind: "string", value: "", location: statement.location }],
      layoutOutput: true,
      trailingSemicolon: target !== "spectrum" && staticLength === columns,
      location: statement.location
    };
  });
}

function mergeTemplateLiterals(parts: readonly TemplatePart[]): TemplatePart[] {
  const merged: TemplatePart[] = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (part.kind === "literal" && previous?.kind === "literal") {
      merged[merged.length - 1] = { kind: "literal", value: previous.value + part.value };
    } else {
      merged.push(part);
    }
  }
  return merged;
}

function parseTextTemplate(
  value: string,
  bindings: ReadonlyMap<string, TemplateValuePart>,
  used: Set<string>,
  statement: PrintStatement
): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let literal = "";
  const flush = () => {
    if (literal) {
      parts.push({ kind: "literal", value: literal });
      literal = "";
    }
  };

  for (let index = 0; index < value.length;) {
    if (value.startsWith("{{", index)) {
      literal += "{";
      index += 2;
      continue;
    }
    if (value.startsWith("}}", index)) {
      literal += "}";
      index += 2;
      continue;
    }
    if (value[index] === "}") {
      throw new DiagnosticError(statement.location, "Unexpected } in localized text template; use }} for a literal brace.");
    }
    if (value[index] !== "{") {
      literal += value[index];
      index += 1;
      continue;
    }

    const end = value.indexOf("}", index + 1);
    if (end < 0) {
      throw new DiagnosticError(statement.location, "Unclosed placeholder in localized text template; use {{ for a literal brace.");
    }
    const name = value.slice(index + 1, end);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new DiagnosticError(statement.location, `Invalid localized text placeholder "{${name}}"; use an identifier name.`);
    }
    const key = name.toLowerCase();
    const binding = bindings.get(key);
    if (!binding) {
      throw new DiagnosticError(statement.location, `Localized text placeholder "{${name}}" has no PRINT_TEXT binding.`);
    }
    flush();
    parts.push(binding);
    used.add(key);
    index = end + 1;
  }
  flush();
  return parts;
}

function wrapTemplate(parts: readonly TemplatePart[], columns: number, statement: PrintStatement): TemplatePart[][] {
  const markerStart = "\uE000";
  const markerEnd = "\uE001";
  const values: TemplateValuePart[] = [];
  const encoded = parts.map((part) => {
    if (part.kind === "literal") return part.value;
    const index = values.push(part) - 1;
    return `${markerStart}${index}${markerEnd}`;
  }).join("").replace(/\r\n?/g, "\n").replace(/\n$/, "");

  const lines: TemplatePart[][] = [];
  for (const paragraph of encoded.split(/\n\s*\n/)) {
    if (lines.length) lines.push([{ kind: "literal", value: "" }]);
    let line: TemplatePart[] = [];
    let lineLength = 0;
    for (const encodedWord of paragraph.trim().split(/\s+/).filter(Boolean)) {
      let word = decodeTemplateWord(encodedWord, values, markerStart, markerEnd);
      let wordLength = templateLength(word);
      const hasValue = word.some((part) => part.kind === "value");
      if (hasValue && wordLength > columns) {
        const names = word.filter((part): part is TemplateValuePart => part.kind === "value").map((part) => `{${part.name}}`).join(", ");
        throw new DiagnosticError(statement.location, `Localized text word containing ${names} can be up to ${wordLength} characters, exceeding text width ${columns}.`);
      }
      if (lineLength && lineLength + 1 + wordLength > columns) {
        lines.push(line);
        line = [];
        lineLength = 0;
      }
      while (!hasValue && wordLength > columns) {
        const literal = word.map((part) => part.kind === "literal" ? part.value : "").join("");
        lines.push([{ kind: "literal", value: literal.slice(0, columns) }]);
        word = [{ kind: "literal", value: literal.slice(columns) }];
        wordLength = templateLength(word);
      }
      if (wordLength) {
        if (lineLength) {
          line.push({ kind: "literal", value: " " });
          lineLength += 1;
        }
        line.push(...word);
        lineLength += wordLength;
      }
    }
    if (line.length || !paragraph.trim()) lines.push(line.length ? line : [{ kind: "literal", value: "" }]);
  }
  return lines;
}

function decodeTemplateWord(
  encodedWord: string,
  values: readonly TemplateValuePart[],
  markerStart: string,
  markerEnd: string
): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let index = 0;
  while (index < encodedWord.length) {
    const marker = encodedWord.indexOf(markerStart, index);
    if (marker < 0) {
      parts.push({ kind: "literal", value: encodedWord.slice(index) });
      break;
    }
    if (marker > index) parts.push({ kind: "literal", value: encodedWord.slice(index, marker) });
    const end = encodedWord.indexOf(markerEnd, marker + markerStart.length);
    const valueIndex = Number(encodedWord.slice(marker + markerStart.length, end));
    parts.push(values[valueIndex]);
    index = end + markerEnd.length;
  }
  return parts;
}

function templateLength(parts: readonly TemplatePart[]): number {
  return parts.reduce((length, part) => length + (part.kind === "literal" ? part.value.length : part.maxLength), 0);
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
