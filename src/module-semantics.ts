import { dirname, relative, resolve, sep } from "node:path";
import type { Expression, Program, SourceLocation, Statement, UsesStatement } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { isSourceDeviceName } from "./devices.js";
import { statementExpressions } from "./function-semantics.js";
import { builtinFunctions, canonicalFunctionName } from "./functions.js";
import { normalizeName } from "./symbols.js";
import type { TargetEnvironment } from "./targets/environment.js";

type SymbolKind = "value" | "function" | "type" | "label" | "device";
interface Reference {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly location: SourceLocation;
  readonly implicit?: boolean;
}
interface Entry {
  readonly statement: Statement;
  readonly locals: ReadonlySet<string>;
  readonly nested: boolean;
  readonly fixture: boolean;
  readonly routine: boolean;
}

function moduleKey(filename: string): string {
  const path = resolve(filename);
  return sep === "\\" ? path.toLowerCase() : path;
}

function symbolKey(kind: SymbolKind, name: string): string {
  return `${kind}:${normalizeName(name)}`;
}

/** Validate original source names before constants and function locals are lowered. */
export function validateModuleAccess(program: Program, environment: TargetEnvironment): void {
  const files = program.sourceFiles ?? [...new Set(program.statements.map((statement) => statement.location.filename))];
  const modules = new Map<string, Map<string, UsesStatement>>();
  for (const file of files) {
    const key = moduleKey(file);
    if (modules.has(key)) {
      throw new DiagnosticError({ filename: file, line: 1 }, "Source file is listed more than once in the build configuration.");
    }
    modules.set(key, new Map());
  }
  const entries = collectEntries(program.statements);
  for (const { statement, nested } of entries) {
    if (statement.kind !== "uses") continue;
    if (nested) throw new DiagnosticError(statement.location, "USES is only allowed at module level.");
    const source = moduleKey(statement.location.filename);
    const target = moduleKey(resolve(dirname(statement.location.filename), statement.path));
    if (!modules.has(target)) {
      throw new DiagnosticError(statement.location, `USES "${statement.path}" does not name a source file in this build. Add it to the build configuration.`);
    }
    const dependencies = modules.get(source)!;
    if (dependencies.has(target)) {
      throw new DiagnosticError(statement.location, `Duplicate USES declaration for "${statement.path}".`);
    }
    dependencies.set(target, statement);
  }
  const active: string[] = [];
  const visited = new Set<string>();
  const transitiveDependencies = new Map<string, Set<string>>();
  const visit = (file: string): void => {
    active.push(file);
    const reachable = new Set<string>();
    for (const [target, declaration] of modules.get(file)!) {
      const cycleStart = active.indexOf(target);
      if (cycleStart >= 0) {
        const chain = [...active.slice(cycleStart), target].join(" -> ");
        throw new DiagnosticError(declaration.location, `Circular USES dependency: ${chain}. Module dependencies must not form cycles.`);
      }
      if (!visited.has(target)) visit(target);
      reachable.add(target);
      for (const dependency of transitiveDependencies.get(target)!) reachable.add(dependency);
    }
    active.pop();
    visited.add(file);
    transitiveDependencies.set(file, reachable);
  };
  for (const file of modules.keys()) if (!visited.has(file)) visit(file);

  const dependsOn = (source: string, target: string): boolean => transitiveDependencies.get(source)?.has(target) ?? false;

  const owners = new Map<string, string>();
  const declare = (entry: Entry, kind: SymbolKind, name: string): void => {
    const key = symbolKey(kind, name);
    if (!entry.locals.has(key) && !owners.has(key)) owners.set(key, moduleKey(entry.statement.location.filename));
  };
  // Explicit declarations take priority over implicit assignments, including test fixtures.
  for (const entry of entries) {
    const s = entry.statement;
    if (s.kind === "function") declare(entry, "function", s.name);
    if (s.kind === "struct") declare(entry, "type", s.name);
    if (s.kind === "dim" || s.kind === "const") declare(entry, "value", s.name);
    if (s.kind === "enum") for (const member of s.members) declare(entry, "value", member.name);
    if (s.kind === "label") declare(entry, "label", s.name);
    if (s.kind === "open-device") declare(entry, "device", s.handle);
  }
  // A module-level initializer owns a scalar; otherwise its first unscoped write does.
  for (const fixture of [false, true]) {
    for (const routine of [false, true]) {
      const candidates = new Map<string, string>();
      const implicitOwner = (entry: Entry, name: string): void => {
        const key = symbolKey("value", name);
        if (entry.locals.has(key) || owners.has(key)) return;
        const file = moduleKey(entry.statement.location.filename);
        const previous = candidates.get(key);
        if (!previous || dependsOn(previous, file)) candidates.set(key, file);
      };
      for (const entry of entries) {
        if (entry.fixture !== fixture || entry.routine !== routine) continue;
        const s = entry.statement;
        if (s.kind === "let") implicitOwner(entry, s.name);
        if (s.kind === "for") implicitOwner(entry, s.variable);
        if (s.kind === "read") for (const name of s.targets) implicitOwner(entry, name);
      }
      for (const [key, file] of candidates) owners.set(key, file);
    }
  }
  const references = entries.map((entry) => ({ entry, refs: referencesFor(entry.statement, owners) }));
  const portableValue = (ref: Reference): boolean => ref.kind === "value" &&
    environment.constants.has(normalizeName(ref.name));
  // Even read-only implicit scalars have a single owner, rather than leaking across files.
  for (const { entry, refs } of references) {
    for (const ref of refs) {
      if (ref.implicit && !portableValue(ref)) declare(entry, "value", ref.name);
    }
  }
  for (const { entry, refs } of references) {
    for (const ref of refs) {
      const key = symbolKey(ref.kind, ref.name);
      if (entry.locals.has(key) || portableValue(ref)) continue;
      const owner = owners.get(key);
      const source = moduleKey(ref.location.filename);
      if (owner && owner !== source && !modules.get(source)?.has(owner)) {
        const path = relative(dirname(ref.location.filename), owner).split(sep).join("/");
        throw new DiagnosticError(ref.location, `Cross-module access to "${ref.name}" requires USES "${path}" in this file. Dependencies are not transitive.`);
      }
    }
  }
}

function children(statement: Statement): readonly Statement[] {
  if (statement.kind === "if") return [...statement.thenBranch, ...statement.elseBranch];
  if ("body" in statement) return statement.body;
  return [];
}

function scopeNames(statements: readonly Statement[], names = new Set<string>()): Set<string> {
  for (const s of statements) {
    if (s.kind === "local") for (const name of s.names) names.add(symbolKey("value", name));
    if (s.kind === "const") names.add(symbolKey("value", s.name));
    if (s.kind === "struct") names.add(symbolKey("type", s.name));
    if (s.kind === "enum") for (const member of s.members) names.add(symbolKey("value", member.name));
    if (s.kind === "label") names.add(symbolKey("label", s.name));
    if (s.kind !== "function" && s.kind !== "test") scopeNames(children(s), names);
  }
  return names;
}

function collectEntries(statements: readonly Statement[], locals: ReadonlySet<string> = new Set(), nested = false, fixture = false, routine = false): Entry[] {
  const entries: Entry[] = [];
  for (const statement of statements) {
    entries.push({ statement, locals, nested, fixture, routine });
    if (statement.kind === "function" || statement.kind === "test") {
      const scoped = scopeNames(statement.body);
      if (statement.kind === "function") for (const name of statement.parameters) scoped.add(symbolKey("value", name));
      entries.push(...collectEntries(statement.body, scoped, true, statement.kind === "test", true));
    } else {
      entries.push(...collectEntries(children(statement), locals, true, fixture || statement.kind === "globals", routine));
    }
  }
  return entries;
}

function referencesFor(s: Statement, owners: ReadonlyMap<string, string>): Reference[] {
  const refs: Reference[] = [];
  const add = (kind: SymbolKind, name: string, location = s.location, implicit = false): void => {
    refs.push({ kind, name, location, implicit });
  };
  const expression = (e: Expression): void => {
    switch (e.kind) {
      case "identifier": add("value", e.name, e.location, true); break;
      case "array-access": add("value", e.name, e.location); e.indices.forEach(expression); break;
      case "struct-field-access": add("value", e.base, e.location); e.indices.forEach(expression); break;
      case "function-call":
        if (canonicalFunctionName(e.name) === builtinFunctions.deviceAvailable && e.args.length === 1 &&
            e.args[0].kind === "identifier" && isSourceDeviceName(e.args[0].name)) break;
        if (!canonicalFunctionName(e.name)) {
          add(owners.has(symbolKey("function", e.name)) ? "function" : "value", e.name, e.location);
        }
        e.args.forEach(expression);
        break;
      case "parenthesized": expression(e.expression); break;
      case "unary": expression(e.operand); break;
      case "binary": expression(e.left); expression(e.right); break;
      case "number": case "string": case "boolean": case "color": break;
    }
  };
  statementExpressions(s).forEach(expression);
  if (s.kind === "let" || s.kind === "array-let") add("value", s.name);
  if (s.kind === "struct-field-let") add("value", s.base);
  if (s.kind === "for") add("value", s.variable);
  if (s.kind === "read") for (const name of s.targets) add("value", name);
  if (s.kind === "dim") {
    add("value", s.name);
    if (s.asType) add("type", s.asType);
  }
  if (s.kind === "function") for (const param of s.parameterTypes ?? []) add("type", param.asType);
  if (s.kind === "struct") for (const field of s.fields) field.dimensions.forEach(expression);
  if (s.kind === "enum") for (const member of s.members) if (member.expression) expression(member.expression);
  if (s.kind === "goto" || s.kind === "gosub") add("label", s.label);
  if (s.kind === "print-device" || s.kind === "close-device") add("device", s.handle);
  if ("actual" in s) {
    expression(s.actual);
    if (s.expected) expression(s.expected);
    if (s.row) expression(s.row);
    if (s.column) expression(s.column);
  }
  return refs;
}
