export interface SourceLocation {
  readonly filename: string;
  readonly line: number;
  readonly column?: number;
}

export interface Program {
  readonly statements: readonly Statement[];
}

export type Statement = ConstStatement | LabelStatement | PrintStatement | LetStatement | GotoStatement | IfStatement;

export interface LabelStatement {
  readonly kind: "label";
  readonly name: string;
  readonly location: SourceLocation;
}

export interface ConstStatement {
  readonly kind: "const";
  readonly name: string;
  readonly expression: Expression;
  readonly location: SourceLocation;
}

export interface PrintStatement {
  readonly kind: "print";
  readonly items: readonly Expression[];
  readonly trailingSemicolon: boolean;
  readonly at?: PrintAtPosition;
  readonly location: SourceLocation;
}

export interface PrintAtPosition {
  readonly row: Expression;
  readonly column: Expression;
  readonly location: SourceLocation;
}

export interface LetStatement {
  readonly kind: "let";
  readonly name: string;
  readonly expression: Expression;
  readonly location: SourceLocation;
}

export interface GotoStatement {
  readonly kind: "goto";
  readonly label: string;
  readonly location: SourceLocation;
}

export interface IfStatement {
  readonly kind: "if";
  readonly condition: Expression;
  readonly thenBranch: readonly Statement[];
  readonly elseBranch: readonly Statement[];
  readonly location: SourceLocation;
}

export type Expression =
  | NumberLiteralExpression
  | StringLiteralExpression
  | BooleanLiteralExpression
  | IdentifierExpression
  | ParenthesizedExpression
  | UnaryExpression
  | BinaryExpression;

export interface NumberLiteralExpression {
  readonly kind: "number";
  readonly value: number;
  readonly raw: string;
  readonly location: SourceLocation;
}

export interface StringLiteralExpression {
  readonly kind: "string";
  readonly value: string;
  readonly location: SourceLocation;
}

export interface BooleanLiteralExpression {
  readonly kind: "boolean";
  readonly value: boolean;
  readonly location: SourceLocation;
}

export interface IdentifierExpression {
  readonly kind: "identifier";
  readonly name: string;
  readonly location: SourceLocation;
}

export interface ParenthesizedExpression {
  readonly kind: "parenthesized";
  readonly expression: Expression;
  readonly location: SourceLocation;
}

export interface UnaryExpression {
  readonly kind: "unary";
  readonly operator: UnaryOperator;
  readonly operand: Expression;
  readonly location: SourceLocation;
}

export interface BinaryExpression {
  readonly kind: "binary";
  readonly operator: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
  readonly location: SourceLocation;
}

export type UnaryOperator = "-" | "NOT";
export type BinaryOperator = "+" | "-" | "*" | "/" | "=" | "<>" | "<" | "<=" | ">" | ">=" | "AND" | "OR";
