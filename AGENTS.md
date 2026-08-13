# Meta-BASIC Agent Instructions

## Project purpose

Meta-BASIC is a small, modern source language that transpiles into readable BASIC for classic home computers. Its first targets are the ZX Spectrum and Atari 8-bit family. Commodore BASIC V2 and other dialects may follow.

The project should preserve the character of each target machine. It is not intended to hide every hardware difference behind one universal API. Shared language features should cover program structure and genuinely portable operations; machine-specific capabilities may later be exposed through explicit target namespaces or libraries.

Generated BASIC is a development artifact, not merely an opaque intermediate file. Prefer output that a human familiar with the target dialect can read, compare with the source, load in an emulator, and debug.

## Working principles

- Keep the compiler core independent of VS Code. A future extension will call the same library and CLI.
- Prefer a small functional core: parse source into immutable data, transform it, then render a target dialect.
- Keep filesystem access, argument handling, and process exit behavior in a thin CLI shell.
- Use explicit TypeScript types and discriminated unions for syntax-tree nodes.
- Add tests for observable language behavior before broadening the syntax.
- Produce actionable diagnostics containing the source filename and line number. Add columns when useful.
- Reject unsupported or ambiguous syntax. Do not silently emit questionable BASIC.
- Preserve existing repository content and conventions. Do not replace files created by the user unless required for this milestone.
- Do not commit, push, publish packages, create releases, or change repository settings unless the user explicitly asks.

## Runtime and tooling

- Target Node.js 24 LTS or later.
- Use TypeScript in strict mode.
- Use ECMAScript modules.
- Use npm unless the repository already establishes another package manager.
- Use `tsx` for direct development execution.
- Use Vitest for automated tests.
- Compile distributable JavaScript with `tsc` and run it with Node.
- Avoid production dependencies for the first milestone. A handwritten parser is sufficient for the deliberately tiny grammar.

If the repository already contains compatible tooling, adapt to it rather than replacing it.

## Current milestone: first vertical slice

Implement a command-line transpiler that reads one Meta-BASIC source file and emits readable ZX Spectrum BASIC.

The purpose of this milestone is to prove the complete path:

1. Read a source file.
2. Parse a minimal structured language.
3. Build a typed syntax tree.
4. Lower structured control flow to labels and jumps.
5. Assign BASIC line numbers.
6. Render Spectrum BASIC.
7. Report useful errors.

### Required source syntax

Support only the following constructs initially:

```basic
start:
    print "WARNING"

    if confirmed then
        print "ATTACK CONFIRMED"
    else
        print "AWAITING SECOND SOURCE"
    end if

    goto start
```

Required constructs:

- Blank lines
- Labels written as `name:`
- `print "literal"`
- `goto label`
- Multiline `if expression then ... else ... end if`
- Nested `if` statements
- Comments beginning with an apostrophe; a comment continues to the end of the source line

Keywords are case-insensitive. Preserve string contents exactly. Identifiers may contain ASCII letters, digits, and underscores, but must begin with a letter or underscore.

For this milestone, treat an `if` condition as a nonempty target-language expression. Preserve its text after trimming surrounding whitespace. Do not attempt to implement a complete expression grammar yet. String literals inside conditions do not need to be supported unless doing so is trivial and tested.

An `else` block is optional. Every opened `if` must have a matching `end if`.

### Spectrum output semantics

- Generate line numbers beginning at 10 in increments of 10.
- Render keywords in uppercase.
- Render a source label as a readable `REM` line and resolve jumps to that line number.
- Reject duplicate labels.
- Reject references to undefined labels.
- Lower multiline `IF/ELSE` into Spectrum-compatible `IF ... THEN GO TO`, unconditional `GO TO`, and generated internal labels.
- Generated internal labels must never collide with user labels.
- Do not depend on a native Spectrum `ELSE` construct.
- Keep one BASIC statement per generated line for this milestone.
- Prefer deterministic output: identical input and options must produce byte-for-byte identical BASIC.

The exact lowering strategy is an implementation decision, but the visible behavior must be covered by golden-output tests.

### CLI

Support this development command:

```text
npm run dev -- examples/warning.mbas --target spectrum
```

Default to writing generated BASIC to standard output. Also support:

```text
--output path/to/program.bas
```

Accept `-o` as its short form. Return a nonzero exit code for invalid arguments, file errors, syntax errors, or generation errors. Write diagnostics to standard error.

Only `spectrum` is a valid target in this milestone. Do not accept a target and silently substitute another.

### Suggested structure

Use this structure unless existing repository conventions suggest a better equivalent:

```text
src/
  ast.ts
  diagnostics.ts
  lexer.ts
  parser.ts
  lowering.ts
  line-numbering.ts
  compiler.ts
  cli.ts
  targets/
    spectrum.ts
test/
  parser.test.ts
  spectrum.test.ts
examples/
  warning.mbas
```

Keep target-independent parsing and lowering separate from Spectrum rendering. It must be possible to add an Atari backend later without putting target checks throughout the parser.

This is a suggested separation, not a requirement to create empty or one-function files. Prefer cohesive modules over ceremonial architecture.

### Required tests

At minimum, test:

- A label, `PRINT`, and backward `GOTO`
- Forward label resolution
- Multiline `IF/ELSE`
- `IF` without `ELSE`
- Nested `IF`
- Case-insensitive keywords
- Preservation of string-literal contents
- Duplicate-label diagnostic
- Undefined-label diagnostic
- Missing `END IF` diagnostic
- Unexpected `ELSE` diagnostic
- Deterministic line numbering and exact Spectrum output
- CLI output to stdout
- CLI output to a file
- CLI nonzero exit code for invalid source

Prefer focused unit tests plus a small number of CLI integration tests. Do not pursue exhaustive expression tests because expressions are not parsed in this milestone.

### Package scripts

Provide equivalent scripts for:

```text
npm run dev -- <arguments>
npm run build
npm test
npm run test:watch
npm start -- <arguments>
```

`npm start` must execute the compiled JavaScript, not `tsx`.

### Documentation

Add or update the README with:

- The project’s purpose
- Its experimental status
- Node.js 24 LTS prerequisite
- Installation and build commands
- The supported milestone syntax
- One source-to-Spectrum example
- An explicit limitations section

Do not claim support for machines or constructs that are only planned.

## Explicitly out of scope for this milestone

Do not implement any of the following unless the user expands the task:

- Atari, Commodore, CPC, or other backends
- Variables declarations, local variables, procedures, or functions
- Constants or compile-time expressions
- Multiple source files, imports, or linking
- A complete expression parser or type system
- Optimization or minification
- BASIC tokenization or TAP generation
- Calling `bas2tap`
- Assembly routines, PRG packaging, or native runtime libraries
- Source maps
- A VS Code extension, syntax highlighting, or language server
- A parser-generator framework
- CI workflows, npm publication, or releases

Record attractive future ideas in a short roadmap section rather than implementing them.

## Definition of done

The milestone is complete when all of the following hold:

- `npm install` succeeds on Node.js 24 LTS.
- `npm test` passes.
- `npm run build` completes without TypeScript errors.
- `npm run dev -- examples/warning.mbas --target spectrum` prints valid, readable numbered Spectrum BASIC.
- `npm start -- examples/warning.mbas --target spectrum` produces the same output after building.
- Diagnostics for malformed source identify the filename and source line.
- The README accurately describes the implemented behavior and limitations.
- The final report lists changed files, verification commands, and any remaining limitations.

Once these conditions hold, stop. Do not proceed into the next milestone automatically.
