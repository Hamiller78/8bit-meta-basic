export interface SourceLocation {
  readonly filename: string;
  readonly line: number;
  readonly column?: number;
}

export interface Program {
  readonly statements: readonly Statement[];
}

export type Statement =
  | ConstStatement
  | DimStatement
  | LabelStatement
  | ClsStatement
  | BorderColorStatement
  | TextColorStatement
  | ScreenBackgroundColorStatement
  | CellTextColorStatement
  | CellBackgroundColorStatement
  | PrintStatement
  | LetStatement
  | ArrayLetStatement
  | GotoStatement
  | GosubStatement
  | ReturnStatement
  | ForStatement
  | IfStatement;

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

export interface DimStatement {
  readonly kind: "dim";
  readonly name: string;
  readonly dimensions: readonly Expression[];
  readonly location: SourceLocation;
}

export interface PrintStatement {
  readonly kind: "print";
  readonly items: readonly Expression[];
  readonly trailingSemicolon: boolean;
  readonly at?: PrintAtPosition;
  readonly location: SourceLocation;
}

export interface ClsStatement {
  readonly kind: "cls";
  readonly color?: Expression;
  readonly location: SourceLocation;
}

export interface BorderColorStatement {
  readonly kind: "border-color";
  readonly color: Expression;
  readonly location: SourceLocation;
}

export interface TextColorStatement {
  readonly kind: "text-color";
  readonly color: Expression;
  readonly location: SourceLocation;
}

export interface ScreenBackgroundColorStatement {
  readonly kind: "screen-background-color";
  readonly color: Expression;
  readonly location: SourceLocation;
}

export interface CellTextColorStatement {
  readonly kind: "cell-text-color";
  readonly color: Expression;
  readonly location: SourceLocation;
}

export interface CellBackgroundColorStatement {
  readonly kind: "cell-background-color";
  readonly color: Expression;
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

export interface ArrayLetStatement {
  readonly kind: "array-let";
  readonly name: string;
  readonly indices: readonly Expression[];
  readonly expression: Expression;
  readonly location: SourceLocation;
}

export interface GotoStatement {
  readonly kind: "goto";
  readonly label: string;
  readonly location: SourceLocation;
}

export interface GosubStatement {
  readonly kind: "gosub";
  readonly label: string;
  readonly location: SourceLocation;
}

export interface ReturnStatement {
  readonly kind: "return";
  readonly location: SourceLocation;
}

export interface ForStatement {
  readonly kind: "for";
  readonly variable: string;
  readonly start: Expression;
  readonly limit: Expression;
  readonly step?: Expression;
  readonly body: readonly Statement[];
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
  | ColorLiteralExpression
  | IdentifierExpression
  | ArrayAccessExpression
  | FunctionCallExpression
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

export interface ColorLiteralExpression {
  readonly kind: "color";
  readonly color: "BLACK" | "BLUE" | "RED" | "MAGENTA" | "GREEN" | "CYAN" | "YELLOW" | "WHITE";
  readonly location: SourceLocation;
}

export interface IdentifierExpression {
  readonly kind: "identifier";
  readonly name: string;
  readonly location: SourceLocation;
}

export interface ArrayAccessExpression {
  readonly kind: "array-access";
  readonly name: string;
  readonly indices: readonly Expression[];
  readonly location: SourceLocation;
}

export interface FunctionCallExpression {
  readonly kind: "function-call";
  readonly name: string;
  readonly args: readonly Expression[];
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
