import type { BinaryOperator, Expression, PrintStatement, Program, SourceLocation, Statement, UnaryOperator } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { tokenize, type Token } from "./lexer.js";

type StatementParser = (parser: Parser, location: SourceLocation) => Statement | "block-delimiter";

const statementParsers = new Map<string, StatementParser>([
  ["BORDER_COLOR", (parser, location) => parser.parseBorderColor(location)],
  ["CONST", (parser, location) => parser.parseConst(location)],
  ["CLS", (parser, location) => parser.parseCls(location)],
  ["PRINT", (parser, location) => parser.parsePrint(location)],
  ["PRINT_AT", (parser, location) => parser.parsePrintAtStatement(location)],
  ["TEXT_COLOR", (parser, location) => parser.parseTextColor(location)],
  ["GOSUB", (parser, location) => parser.parseGosub(location)],
  ["GOTO", (parser, location) => parser.parseGoto(location)],
  ["RETURN", (parser, location) => parser.parseReturn(location)],
  ["IF", (parser, location) => parser.parseIf(location)]
]);

const binaryPrecedence = new Map<string, number>([
  ["OR", 1],
  ["AND", 2],
  ["=", 3],
  ["<>", 3],
  ["<", 3],
  ["<=", 3],
  [">", 3],
  [">=", 3],
  ["+", 4],
  ["-", 4],
  ["*", 5],
  ["/", 5]
]);

const comparisonOperators = new Set(["=", "<>", "<", "<=", ">", ">="]);

export function parseSource(source: string, filename: string): Program {
  return new Parser(tokenize(source, filename)).parseProgram();
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parseProgram(): Program {
    return { statements: this.parseBlock("eof") };
  }

  parseConst(location: SourceLocation): Statement {
    const name = this.expectIdentifier("Expected constant name after CONST.").text;
    this.expectPunctuation("=", "Expected = after constant name.");
    const expression = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "const", name, expression, location };
  }

  parsePrint(location: SourceLocation): PrintStatement {
    const items: Expression[] = [];
    let trailingSemicolon = false;

    if (this.isLineEnd()) {
      throw new DiagnosticError(this.current().location, "PRINT requires at least one expression.");
    }

    while (!this.isLineEnd()) {
      items.push(this.parseExpression(() => this.isLineEnd() || this.matchPunctuation(";")));
      if (this.matchPunctuation(";")) {
        this.advance();
        trailingSemicolon = true;
        if (this.isLineEnd()) {
          break;
        }
        continue;
      }

      trailingSemicolon = false;
      break;
    }

    this.expectLineEnd();
    return { kind: "print", items, trailingSemicolon, location };
  }

  parseCls(location: SourceLocation): Statement {
    if (this.isLineEnd()) {
      this.expectLineEnd();
      return { kind: "cls", location };
    }

    const color = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "cls", color, location };
  }

  parseBorderColor(location: SourceLocation): Statement {
    if (this.isLineEnd()) {
      throw new DiagnosticError(this.current().location, "BORDER_COLOR requires a colour expression.");
    }
    const color = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "border-color", color, location };
  }

  parseTextColor(location: SourceLocation): Statement {
    if (this.isLineEnd()) {
      throw new DiagnosticError(this.current().location, "TEXT_COLOR requires a colour expression.");
    }
    const color = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "text-color", color, location };
  }

  parsePrintAtStatement(location: SourceLocation): Statement {
    const at = this.parsePrintAt("PRINT_AT");
    const print = this.parsePrint(location);
    return { ...print, at, location };
  }

  parseAssignment(location: SourceLocation, name: string): Statement {
    this.expectPunctuation("=", "Expected = after variable name.");
    const expression = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "let", name, expression, location };
  }

  private parsePrintAt(commandName: "PRINT_AT"): NonNullable<Extract<Statement, { kind: "print" }>["at"]> {
    const location = this.current().location;
    if (this.matchPunctuation(",")) {
      throw new DiagnosticError(this.current().location, `${commandName} requires a row expression before the comma.`);
    }
    const row = this.parseExpression(() => this.matchPunctuation(",") || this.isLineEnd());
    this.expectPunctuation(",", `Expected comma between ${commandName} row and column.`);
    if (this.matchPunctuation(";")) {
      throw new DiagnosticError(this.current().location, `${commandName} requires a column expression after the comma.`);
    }
    const column = this.parseExpression(() => this.matchPunctuation(";") || this.isLineEnd());
    this.expectPunctuation(";", `Expected semicolon after ${commandName} column.`);
    return { row, column, location };
  }

  parseGoto(location: SourceLocation): Statement {
    const label = this.expectIdentifier("Expected label name after GOTO.").text;
    this.expectLineEnd();
    return { kind: "goto", label, location };
  }

  parseGosub(location: SourceLocation): Statement {
    const label = this.expectIdentifier("Expected label name after GOSUB.").text;
    this.expectLineEnd();
    return { kind: "gosub", label, location };
  }

  parseReturn(location: SourceLocation): Statement {
    this.expectLineEnd();
    return { kind: "return", location };
  }

  parseIf(location: SourceLocation): Statement {
    const condition = this.parseExpression(() => this.matchKeyword("THEN"));
    this.expectKeyword("THEN", "Expected THEN after IF condition.");
    this.expectLineEnd();

    const thenBranch = this.parseBlock("else-or-end-if", location);
    let elseBranch: Statement[] = [];

    if (this.matchKeyword("ELSE")) {
      this.advance();
      this.expectLineEnd();
      elseBranch = this.parseBlock("end-if", location);
    }

    this.expectEndIf();
    this.expectLineEnd();
    return { kind: "if", condition, thenBranch, elseBranch, location };
  }

  private parseBlock(until: "eof" | "else-or-end-if" | "end-if", missingBlockLocation?: SourceLocation): Statement[] {
    const statements: Statement[] = [];

    while (true) {
      this.skipNewlines();

      if (this.matchKind("eof")) {
        if (until === "eof") {
          return statements;
        }
        throw new DiagnosticError(missingBlockLocation ?? this.current().location, "Missing END IF for IF block.");
      }

      if (this.matchKeyword("ELSE")) {
        if (until === "else-or-end-if") {
          return statements;
        }
        throw new DiagnosticError(this.current().location, "Unexpected ELSE without matching IF.");
      }

      if (this.isEndIf()) {
        if (until === "else-or-end-if" || until === "end-if") {
          return statements;
        }
        throw new DiagnosticError(this.current().location, "Unexpected END IF without matching IF.");
      }

      const statement = this.parseStatement();
      statements.push(statement);
    }
  }

  private parseStatement(): Statement {
    const token = this.current();

    if (token.kind === "identifier" && this.nextIsPunctuation(":")) {
      this.advance();
      this.advance();
      this.expectLineEnd();
      return { kind: "label", name: token.text, location: token.location };
    }

    if (token.kind === "identifier" && this.nextIsPunctuation("=")) {
      this.advance();
      return this.parseAssignment(token.location, token.text);
    }

    if (token.kind === "keyword") {
      const parser = statementParsers.get(token.text);
      if (parser) {
        this.advance();
        const statement = parser(this, token.location);
        if (statement === "block-delimiter") {
          throw new DiagnosticError(token.location, `Unexpected ${token.text}.`);
        }
        return statement;
      }
    }

    throw new DiagnosticError(token.location, `Unsupported or invalid syntax near ${describeToken(token)}.`);
  }

  private parseExpressionUntilLine(): Expression {
    const expression = this.parseExpression(() => this.isLineEnd());
    return expression;
  }

  private parseExpression(isTerminator: () => boolean, minimumPrecedence = 1): Expression {
    if (isTerminator()) {
      throw new DiagnosticError(this.current().location, "Missing expression operand.");
    }

    let left = this.parsePrefix(isTerminator);

    while (!isTerminator()) {
      const operator = this.currentBinaryOperator();
      if (!operator) {
        break;
      }

      const precedence = binaryPrecedence.get(operator);
      if (precedence === undefined || precedence < minimumPrecedence) {
        break;
      }

      const operatorToken = this.current();
      if (comparisonOperators.has(operator) && left.kind === "binary" && comparisonOperators.has(left.operator)) {
        throw new DiagnosticError(
          operatorToken.location,
          "Comparison chaining is not supported; write this as separate comparisons joined with AND, for example a < b AND b < c."
        );
      }

      this.advance();
      const right = this.parseExpression(isTerminator, precedence + 1);
      left = { kind: "binary", operator: operator as BinaryOperator, left, right, location: operatorToken.location };
    }

    return left;
  }

  private parsePrefix(isTerminator: () => boolean): Expression {
    const token = this.current();

    if (token.kind === "operator" && token.text === "-") {
      this.advance();
      return { kind: "unary", operator: "-", operand: this.parseExpression(isTerminator, 6), location: token.location };
    }

    if (token.kind === "keyword" && token.text === "NOT") {
      this.advance();
      return { kind: "unary", operator: "NOT", operand: this.parseExpression(isTerminator, 6), location: token.location };
    }

    return this.parsePrimary(isTerminator);
  }

  private parsePrimary(isTerminator: () => boolean): Expression {
    const token = this.current();

    if (token.kind === "number") {
      this.advance();
      return { kind: "number", value: token.value, raw: token.text, location: token.location };
    }

    if (token.kind === "string") {
      this.advance();
      return { kind: "string", value: token.value, location: token.location };
    }

    if (token.kind === "identifier") {
      this.advance();
      if (this.matchPunctuation("(")) {
        return this.parseFunctionCall(token.text, token.location);
      }
      return { kind: "identifier", name: token.text, location: token.location };
    }

    if (token.kind === "keyword" && (token.text === "TRUE" || token.text === "FALSE")) {
      this.advance();
      return { kind: "boolean", value: token.text === "TRUE", location: token.location };
    }

    if (this.matchPunctuation("(")) {
      const location = token.location;
      this.advance();
      const expression = this.parseExpression(() => this.matchPunctuation(")"));
      this.expectPunctuation(")", "Expected closing parenthesis.");
      return { kind: "parenthesized", expression, location };
    }

    if (isTerminator()) {
      throw new DiagnosticError(token.location, "Missing expression operand.");
    }

    throw new DiagnosticError(token.location, `Expected expression operand, found ${describeToken(token)}.`);
  }

  private currentBinaryOperator(): string | undefined {
    const token = this.current();

    if (token.kind === "operator") {
      return token.text;
    }

    if (token.kind === "punctuation" && token.text === "=") {
      return token.text;
    }

    if (token.kind === "keyword" && (token.text === "AND" || token.text === "OR")) {
      return token.text;
    }

    return undefined;
  }

  private parseFunctionCall(name: string, location: SourceLocation): Expression {
    this.expectPunctuation("(", "Expected opening parenthesis after function name.");
    const args: Expression[] = [];

    if (this.matchPunctuation(")")) {
      this.advance();
      return { kind: "function-call", name, args, location };
    }

    while (true) {
      args.push(this.parseExpression(() => this.matchPunctuation(",") || this.matchPunctuation(")")));
      if (this.matchPunctuation(",")) {
        this.advance();
        continue;
      }
      this.expectPunctuation(")", "Expected closing parenthesis after function arguments.");
      return { kind: "function-call", name, args, location };
    }
  }

  private expectEndIf(): void {
    if (this.matchKeyword("ENDIF")) {
      this.advance();
      return;
    }

    this.expectKeyword("END", "Expected END IF.");
    this.expectKeyword("IF", "Expected IF after END.");
  }

  private isEndIf(): boolean {
    const next = this.tokens[this.index + 1];
    return this.matchKeyword("ENDIF") || (this.matchKeyword("END") && next?.kind === "keyword" && next.text === "IF");
  }

  private expectIdentifier(message: string): Extract<Token, { kind: "identifier" }> {
    const token = this.current();
    if (token.kind !== "identifier") {
      throw new DiagnosticError(token.location, message);
    }
    this.advance();
    return token;
  }

  private expectKeyword(text: string, message: string): void {
    if (!this.matchKeyword(text)) {
      throw new DiagnosticError(this.current().location, message);
    }
    this.advance();
  }

  private expectPunctuation(text: "(" | ")" | ":" | "," | ";" | "=", message: string): void {
    if (!this.matchPunctuation(text)) {
      throw new DiagnosticError(this.current().location, message);
    }
    this.advance();
  }

  private expectLineEnd(): void {
    if (!this.isLineEnd()) {
      throw new DiagnosticError(this.current().location, `Expected end of line, found ${describeToken(this.current())}.`);
    }
    if (this.matchKind("newline")) {
      this.advance();
    }
  }

  private skipNewlines(): void {
    while (this.matchKind("newline")) {
      this.advance();
    }
  }

  private isLineEnd(): boolean {
    return this.matchKind("newline") || this.matchKind("eof");
  }

  private matchKeyword(text: string): boolean {
    const token = this.current();
    return token.kind === "keyword" && token.text === text;
  }

  private matchPunctuation(text: "(" | ")" | ":" | "," | ";" | "="): boolean {
    const token = this.current();
    return token.kind === "punctuation" && token.text === text;
  }

  private nextIsPunctuation(text: "(" | ")" | ":" | "," | ";" | "="): boolean {
    const token = this.tokens[this.index + 1];
    return token?.kind === "punctuation" && token.text === text;
  }

  private matchKind(kind: Token["kind"]): boolean {
    return this.current().kind === kind;
  }

  private current(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1];
  }

  private advance(): void {
    if (!this.matchKind("eof")) {
      this.index += 1;
    }
  }
}

function describeToken(token: Token): string {
  switch (token.kind) {
    case "eof":
      return "end of file";
    case "newline":
      return "end of line";
    case "keyword":
    case "identifier":
    case "number":
    case "string":
    case "operator":
    case "punctuation":
      return `"${token.text}"`;
  }
}
