import type { BinaryOperator, Expression, PrintStatement, Program, SourceLocation, Statement, UnaryOperator } from "./ast.js";
import { DiagnosticError } from "./diagnostics.js";
import { deviceSourceList, parseSourceDeviceName } from "./devices.js";
import { tokenize, type Token } from "./lexer.js";

type StatementParser = (parser: Parser, location: SourceLocation) => Statement | "block-delimiter";

const statementParsers = new Map<string, StatementParser>([
  ["BORDER_COLOR", (parser, location) => parser.parseBorderColor(location)],
  ["SCREEN_BORDER_COLOR", (parser, location) => parser.parseBorderColor(location)],
  ["SCREEN_BACKGROUND_COLOR", (parser, location) => parser.parseScreenBackgroundColor(location)],
  ["SCREEN_TEXT_COLOR", (parser, location) => parser.parseTextColor(location)],
  ["CELL_TEXT_COLOR", (parser, location) => parser.parseCellTextColor(location)],
  ["CELL_BACKGROUND_COLOR", (parser, location) => parser.parseCellBackgroundColor(location)],
  ["CONST", (parser, location) => parser.parseConst(location)],
  ["DATA", (parser, location) => parser.parseData(location)],
  ["DIM", (parser, location) => parser.parseDim(location)],
  ["END", (parser, location) => parser.parseEnd(location)],
  ["CLS", (parser, location) => parser.parseCls(location)],
  ["CLOSE_DEVICE", (parser, location) => parser.parseCloseDevice(location)],
  ["OPEN_DEVICE", (parser, location) => parser.parseOpenDevice(location)],
  ["PRINT", (parser, location) => parser.parsePrint(location)],
  ["PRINT_AT", (parser, location) => parser.parsePrintAtStatement(location)],
  ["PRINT_DEVICE", (parser, location) => parser.parsePrintDevice(location)],
  ["READ", (parser, location) => parser.parseRead(location)],
  ["TEXT_COLOR", (parser, location) => parser.parseTextColor(location)],
  ["GOSUB", (parser, location) => parser.parseGosub(location)],
  ["GOTO", (parser, location) => parser.parseGoto(location)],
  ["RETURN", (parser, location) => parser.parseReturn(location)],
  ["RESTORE", (parser, location) => parser.parseRestore(location)],
  ["RANDOMIZE", (parser, location) => parser.parseRandomize(location)],
  ["SUPPRESS_SCROLL_PROMPT", (parser, location) => parser.parseSuppressScrollPrompt(location)],
  ["ASSERT_TRUE", (parser, location) => parser.parseAssertUnary("assert-true", location)],
  ["ASSERT_FALSE", (parser, location) => parser.parseAssertUnary("assert-false", location)],
  ["ASSERT_EQ", (parser, location) => parser.parseAssertBinary("assert-eq", location)],
  ["ASSERT_NE", (parser, location) => parser.parseAssertBinary("assert-ne", location)],
  ["ASSERT_PRINT", (parser, location) => parser.parseAssertUnary("assert-print", location)],
  ["ASSERT_PRINTAT", (parser, location) => parser.parseAssertPrintAt(location)],
  ["ASSERT_SCREEN_BORDER_COLOR", (parser, location) => parser.parseAssertUnary("assert-screen-border-color", location)],
  ["ASSERT_SCREEN_BACKGROUND_COLOR", (parser, location) => parser.parseAssertUnary("assert-screen-background-color", location)],
  ["ASSERT_SCREEN_TEXT_COLOR", (parser, location) => parser.parseAssertUnary("assert-screen-text-color", location)],
  ["ASSERT_CELL_TEXT_COLOR", (parser, location) => parser.parseAssertUnary("assert-cell-text-color", location)],
  ["ASSERT_CELL_BACKGROUND_COLOR", (parser, location) => parser.parseAssertUnary("assert-cell-background-color", location)],
  ["LOCAL", (parser, location) => parser.parseLocal(location)],
  ["FUNCTION", (parser, location) => parser.parseFunction(location)],
  ["TEST", (parser, location) => parser.parseTest(location)],
  ["GLOBALS", (parser, location) => parser.parseGlobals(location)],
  ["FOR", (parser, location) => parser.parseFor(location)],
  ["WHILE", (parser, location) => parser.parseWhile(location)],
  ["REPEAT", (parser, location) => parser.parseRepeatUntil(location)],
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
  ["/", 5],
  ["MOD", 5],
  ["^", 7]
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

  parseDim(location: SourceLocation): Statement {
    const name = this.expectIdentifier("Expected array name after DIM.").text;
    const dimensions = this.parseArgumentList("Expected opening parenthesis after array name.");
    this.expectLineEnd();
    return { kind: "dim", name, dimensions, location };
  }

  parseData(location: SourceLocation): Statement {
    const values: Expression[] = [];
    if (this.isLineEnd()) {
      throw new DiagnosticError(this.current().location, "DATA requires at least one value.");
    }

    while (true) {
      values.push(this.parseExpression(() => this.matchPunctuation(",") || this.isLineEnd()));
      if (!this.matchPunctuation(",")) {
        break;
      }
      this.advance();
      if (this.isLineEnd()) {
        throw new DiagnosticError(this.current().location, "DATA requires a value after comma.");
      }
    }

    this.expectLineEnd();
    return { kind: "data", values, location };
  }

  parseRead(location: SourceLocation): Statement {
    const targets = this.parseIdentifierSequence("Expected variable name after READ.");
    this.expectLineEnd();
    return { kind: "read", targets, location };
  }

  parseRestore(location: SourceLocation): Statement {
    if (!this.isLineEnd()) {
      throw new DiagnosticError(this.current().location, "RESTORE does not support a target yet.");
    }
    this.expectLineEnd();
    return { kind: "restore", location };
  }

  parsePrint(location: SourceLocation): PrintStatement {
    const { items, trailingSemicolon } = this.parsePrintItems("PRINT");
    this.expectLineEnd();
    return { kind: "print", items, trailingSemicolon, location };
  }

  parseOpenDevice(location: SourceLocation): Statement {
    const handle = this.expectIdentifier("Expected device handle name after OPEN_DEVICE.").text;
    this.expectPunctuation(",", "Expected comma between OPEN_DEVICE handle and device name.");
    const device = this.expectIdentifier("Expected device name after OPEN_DEVICE comma.").text;
    const deviceKind = parseSourceDeviceName(device);
    if (!deviceKind) {
      throw new DiagnosticError(this.current().location, `Unsupported device "${device}". OPEN_DEVICE currently supports ${deviceSourceList}.`);
    }
    this.expectLineEnd();
    return { kind: "open-device", handle, device: deviceKind, location };
  }

  parsePrintDevice(location: SourceLocation): Statement {
    const handle = this.expectIdentifier("Expected device handle name after PRINT_DEVICE.").text;
    this.expectPunctuation(";", "Expected semicolon after PRINT_DEVICE handle.");
    const { items, trailingSemicolon } = this.parsePrintItems("PRINT_DEVICE");
    this.expectLineEnd();
    return { kind: "print-device", handle, items, trailingSemicolon, location };
  }

  parseCloseDevice(location: SourceLocation): Statement {
    const handle = this.expectIdentifier("Expected device handle name after CLOSE_DEVICE.").text;
    this.expectLineEnd();
    return { kind: "close-device", handle, location };
  }

  private parsePrintItems(commandName: "PRINT" | "PRINT_AT" | "PRINT_DEVICE"): Pick<PrintStatement, "items" | "trailingSemicolon"> {
    const items: Expression[] = [];
    let trailingSemicolon = false;

    if (this.isLineEnd()) {
      throw new DiagnosticError(this.current().location, `${commandName} requires at least one expression.`);
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

    return { items, trailingSemicolon };
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

  parseScreenBackgroundColor(location: SourceLocation): Statement {
    if (this.isLineEnd()) {
      throw new DiagnosticError(this.current().location, "SCREEN_BACKGROUND_COLOR requires a colour expression.");
    }
    const color = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "screen-background-color", color, location };
  }

  parseCellTextColor(location: SourceLocation): Statement {
    if (this.isLineEnd()) {
      throw new DiagnosticError(this.current().location, "CELL_TEXT_COLOR requires a colour expression.");
    }
    const color = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "cell-text-color", color, location };
  }

  parseCellBackgroundColor(location: SourceLocation): Statement {
    if (this.isLineEnd()) {
      throw new DiagnosticError(this.current().location, "CELL_BACKGROUND_COLOR requires a colour expression.");
    }
    const color = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "cell-background-color", color, location };
  }

  parseSuppressScrollPrompt(location: SourceLocation): Statement {
    this.expectLineEnd();
    return { kind: "suppress-scroll-prompt", location };
  }

  parsePrintAtStatement(location: SourceLocation): Statement {
    const at = this.parsePrintAt("PRINT_AT");
    const { items, trailingSemicolon } = this.parsePrintItems("PRINT_AT");
    this.expectLineEnd();
    return { kind: "print", items, trailingSemicolon, at, location };
  }

  parseAssignment(location: SourceLocation, name: string): Statement {
    this.expectPunctuation("=", "Expected = after variable name.");
    const expression = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "let", name, expression, location };
  }

  parseArrayAssignment(location: SourceLocation, name: string): Statement {
    const indices = this.parseArgumentList("Expected opening parenthesis after array name.");
    this.expectPunctuation("=", "Expected = after array element.");
    const expression = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "array-let", name, indices, expression, location };
  }

  parseCallOrArrayAssignment(location: SourceLocation, name: string): Statement {
    const args = this.parseArgumentList("Expected opening parenthesis after name.");
    if (this.matchPunctuation("=")) {
      this.advance();
      const expression = this.parseExpressionUntilLine();
      this.expectLineEnd();
      return { kind: "array-let", name, indices: args, expression, location };
    }
    this.expectLineEnd();
    return { kind: "function-call-statement", expression: { kind: "function-call", name, args, location }, location };
  }

  private parsePrintAt(commandName: "PRINT_AT"): NonNullable<Extract<Statement, { kind: "print" }>["at"]> {
    const location = this.current().location;
    if (this.matchPunctuation(",")) {
      throw new DiagnosticError(this.current().location, `${commandName} requires a row expression before the comma.`);
    }
    const row = this.parseExpression(() => this.matchPunctuation(",") || this.isLineEnd());
    this.expectPunctuation(",", `Expected comma between ${commandName} row and column.`);
    if (this.matchPunctuation(",") || this.matchPunctuation(";") || this.isLineEnd()) {
      throw new DiagnosticError(this.current().location, `${commandName} requires a column expression after the comma.`);
    }
    const column = this.parseExpression(() => this.matchPunctuation(",") || this.isLineEnd());
    this.expectPunctuation(",", `Expected comma after ${commandName} column.`);
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
    if (this.isLineEnd()) {
      this.expectLineEnd();
      return { kind: "return", location };
    }
    const expression = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "return", expression, location };
  }

  parseEnd(location: SourceLocation): Statement {
    this.expectLineEnd();
    return { kind: "end", location };
  }

  parseRandomize(location: SourceLocation): Statement {
    if (this.isLineEnd()) {
      this.expectLineEnd();
      return { kind: "randomize", location };
    }

    const seed = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "randomize", seed, location };
  }

  parseLocal(location: SourceLocation): Statement {
    const names = this.parseIdentifierSequence("Expected local variable name after LOCAL.");
    this.expectLineEnd();
    return { kind: "local", names, location };
  }

  parseFunction(location: SourceLocation): Statement {
    const name = this.expectIdentifier("Expected function name after FUNCTION.").text;
    const parameters = this.parseIdentifierList("Expected opening parenthesis after function name.");
    this.expectLineEnd();
    const body = this.parseBlock("end-function", location);
    this.expectEndFunction();
    this.expectLineEnd();
    return { kind: "function", name, parameters, body, location };
  }

  parseTest(location: SourceLocation): Statement {
    const name = this.expectIdentifier("Expected test name after TEST.").text;
    const parameters = this.parseIdentifierList("Expected empty parentheses after test name.");
    if (parameters.length > 0) {
      throw new DiagnosticError(location, "TEST blocks do not take parameters.");
    }
    this.expectLineEnd();
    const body = this.parseBlock("end-test", location);
    this.expectEndTest();
    this.expectLineEnd();
    return { kind: "test", name, body, location };
  }

  parseGlobals(location: SourceLocation): Statement {
    this.expectLineEnd();
    const body = this.parseBlock("end-globals", location);
    this.expectEndGlobals();
    this.expectLineEnd();
    return { kind: "globals", body, location };
  }

  parseAssertUnary(
    kind:
      | "assert-true"
      | "assert-false"
      | "assert-print"
      | "assert-screen-border-color"
      | "assert-screen-background-color"
      | "assert-screen-text-color"
      | "assert-cell-text-color"
      | "assert-cell-background-color",
    location: SourceLocation
  ): Statement {
    const actual = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind, actual, location };
  }

  parseAssertPrintAt(location: SourceLocation): Statement {
    const row = this.parseExpression(() => this.matchPunctuation(",") || this.isLineEnd());
    this.expectPunctuation(",", "ASSERT_PRINTAT requires a comma between row and column expressions.");
    const column = this.parseExpression(() => this.matchPunctuation(",") || this.isLineEnd());
    this.expectPunctuation(",", "ASSERT_PRINTAT requires a comma between column and expected text expressions.");
    const actual = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "assert-printat", row, column, actual, location };
  }

  parseAssertBinary(kind: "assert-eq" | "assert-ne", location: SourceLocation): Statement {
    const expected = this.parseExpression(() => this.matchPunctuation(",") || this.isLineEnd());
    this.expectPunctuation(",", `${kind === "assert-eq" ? "ASSERT_EQ" : "ASSERT_NE"} requires a comma between expected and actual expressions.`);
    const actual = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind, expected, actual, location };
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

  parseFor(location: SourceLocation): Statement {
    const variable = this.expectIdentifier("Expected loop variable after FOR.").text;
    this.expectPunctuation("=", "Expected = after FOR loop variable.");
    const start = this.parseExpression(() => this.matchKeyword("TO") || this.isLineEnd());
    this.expectKeyword("TO", "Expected TO in FOR statement.");
    const limit = this.parseExpression(() => this.matchKeyword("STEP") || this.isLineEnd());
    let step: Expression | undefined;

    if (this.matchKeyword("STEP")) {
      this.advance();
      step = this.parseExpressionUntilLine();
    }

    this.expectLineEnd();
    const body = this.parseBlock("next", location);
    this.expectKeyword("NEXT", "Expected NEXT.");
    const nextVariable = this.expectIdentifier("Expected loop variable after NEXT.").text;
    if (nextVariable.toLowerCase() !== variable.toLowerCase()) {
      throw new DiagnosticError(this.current().location, `NEXT ${nextVariable} does not match FOR ${variable}.`);
    }
    this.expectLineEnd();
    return step ? { kind: "for", variable, start, limit, step, body, location } : { kind: "for", variable, start, limit, body, location };
  }

  parseWhile(location: SourceLocation): Statement {
    const condition = this.parseExpressionUntilLine();
    this.expectLineEnd();
    const body = this.parseBlock("wend", location);
    this.expectKeyword("WEND", "Expected WEND.");
    this.expectLineEnd();
    return { kind: "while", condition, body, location };
  }

  parseRepeatUntil(location: SourceLocation): Statement {
    this.expectLineEnd();
    const body = this.parseBlock("until", location);
    this.expectKeyword("UNTIL", "Expected UNTIL.");
    const condition = this.parseExpressionUntilLine();
    this.expectLineEnd();
    return { kind: "repeat-until", body, condition, location };
  }

  private parseBlock(
    until: "eof" | "else-or-end-if" | "end-if" | "end-function" | "end-test" | "end-globals" | "next" | "wend" | "until",
    missingBlockLocation?: SourceLocation
  ): Statement[] {
    const statements: Statement[] = [];

    while (true) {
      this.skipNewlines();

      if (this.matchKind("eof")) {
        if (until === "eof") {
          return statements;
        }
        if (until === "next") {
          throw new DiagnosticError(missingBlockLocation ?? this.current().location, "Missing NEXT for FOR block.");
        }
        if (until === "wend") {
          throw new DiagnosticError(missingBlockLocation ?? this.current().location, "Missing WEND for WHILE block.");
        }
        if (until === "until") {
          throw new DiagnosticError(missingBlockLocation ?? this.current().location, "Missing UNTIL for REPEAT block.");
        }
        if (until === "end-function") {
          throw new DiagnosticError(missingBlockLocation ?? this.current().location, "Missing END FUNCTION for FUNCTION block.");
        }
        if (until === "end-test") {
          throw new DiagnosticError(missingBlockLocation ?? this.current().location, "Missing END TEST for TEST block.");
        }
        if (until === "end-globals") {
          throw new DiagnosticError(missingBlockLocation ?? this.current().location, "Missing END GLOBALS for GLOBALS block.");
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

      if (this.isEndFunction()) {
        if (until === "end-function") {
          return statements;
        }
        throw new DiagnosticError(this.current().location, "Unexpected END FUNCTION without matching FUNCTION.");
      }

      if (this.isEndTest()) {
        if (until === "end-test") {
          return statements;
        }
        throw new DiagnosticError(this.current().location, "Unexpected END TEST without matching TEST.");
      }

      if (this.isEndGlobals()) {
        if (until === "end-globals") {
          return statements;
        }
        throw new DiagnosticError(this.current().location, "Unexpected END GLOBALS without matching GLOBALS.");
      }

      if (this.matchKeyword("NEXT")) {
        if (until === "next") {
          return statements;
        }
        throw new DiagnosticError(this.current().location, "Unexpected NEXT without matching FOR.");
      }

      if (this.matchKeyword("WEND")) {
        if (until === "wend") {
          return statements;
        }
        throw new DiagnosticError(this.current().location, "Unexpected WEND without matching WHILE.");
      }

      if (this.matchKeyword("UNTIL")) {
        if (until === "until") {
          return statements;
        }
        throw new DiagnosticError(this.current().location, "Unexpected UNTIL without matching REPEAT.");
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

    if (token.kind === "identifier" && this.nextIsPunctuation("(")) {
      this.advance();
      return this.parseCallOrArrayAssignment(token.location, token.text);
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
      return { kind: "unary", operator: "-", operand: this.parseExpression(isTerminator, 7), location: token.location };
    }

    if (token.kind === "keyword" && token.text === "NOT") {
      this.advance();
      return { kind: "unary", operator: "NOT", operand: this.parseExpression(isTerminator, 7), location: token.location };
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

    if (token.kind === "keyword" && (token.text === "AND" || token.text === "OR" || token.text === "MOD")) {
      return token.text;
    }

    return undefined;
  }

  private parseFunctionCall(name: string, location: SourceLocation): Expression {
    const args = this.parseArgumentList("Expected opening parenthesis after function name.");
    return { kind: "function-call", name, args, location };
  }

  private parseArgumentList(openMessage: string): Expression[] {
    this.expectPunctuation("(", openMessage);
    const args: Expression[] = [];

    if (this.matchPunctuation(")")) {
      this.advance();
      return args;
    }

    while (true) {
      args.push(this.parseExpression(() => this.matchPunctuation(",") || this.matchPunctuation(")")));
      if (this.matchPunctuation(",")) {
        this.advance();
        continue;
      }
      this.expectPunctuation(")", "Expected closing parenthesis after function arguments.");
      return args;
    }
  }

  private parseIdentifierList(openMessage: string): string[] {
    this.expectPunctuation("(", openMessage);
    if (this.matchPunctuation(")")) {
      this.advance();
      return [];
    }
    const names = this.parseIdentifierSequence("Expected parameter name.");
    this.expectPunctuation(")", "Expected closing parenthesis after parameter list.");
    return names;
  }

  private parseIdentifierSequence(firstMessage: string): string[] {
    const names: string[] = [this.expectIdentifier(firstMessage).text];

    while (this.matchPunctuation(",")) {
      this.advance();
      names.push(this.expectIdentifier("Expected identifier after comma.").text);
    }

    return names;
  }

  private expectEndIf(): void {
    if (this.matchKeyword("ENDIF")) {
      this.advance();
      return;
    }

    this.expectKeyword("END", "Expected END IF.");
    this.expectKeyword("IF", "Expected IF after END.");
  }

  private expectEndFunction(): void {
    this.expectKeyword("END", "Expected END FUNCTION.");
    this.expectKeyword("FUNCTION", "Expected FUNCTION after END.");
  }

  private expectEndTest(): void {
    this.expectKeyword("END", "Expected END TEST.");
    this.expectKeyword("TEST", "Expected TEST after END.");
  }

  private expectEndGlobals(): void {
    this.expectKeyword("END", "Expected END GLOBALS.");
    this.expectKeyword("GLOBALS", "Expected GLOBALS after END.");
  }

  private isEndIf(): boolean {
    const next = this.tokens[this.index + 1];
    return this.matchKeyword("ENDIF") || (this.matchKeyword("END") && next?.kind === "keyword" && next.text === "IF");
  }

  private isEndFunction(): boolean {
    const next = this.tokens[this.index + 1];
    return this.matchKeyword("END") && next?.kind === "keyword" && next.text === "FUNCTION";
  }

  private isEndTest(): boolean {
    const next = this.tokens[this.index + 1];
    return this.matchKeyword("END") && next?.kind === "keyword" && next.text === "TEST";
  }

  private isEndGlobals(): boolean {
    const next = this.tokens[this.index + 1];
    return this.matchKeyword("END") && next?.kind === "keyword" && next.text === "GLOBALS";
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
