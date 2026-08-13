export interface SourceLocation {
  readonly filename: string;
  readonly line: number;
}

export interface Program {
  readonly statements: readonly Statement[];
}

export type Statement = LabelStatement | PrintStatement | GotoStatement | IfStatement;

export interface LabelStatement {
  readonly kind: "label";
  readonly name: string;
  readonly location: SourceLocation;
}

export interface PrintStatement {
  readonly kind: "print";
  readonly literal: string;
  readonly location: SourceLocation;
}

export interface GotoStatement {
  readonly kind: "goto";
  readonly label: string;
  readonly location: SourceLocation;
}

export interface IfStatement {
  readonly kind: "if";
  readonly condition: string;
  readonly thenBranch: readonly Statement[];
  readonly elseBranch: readonly Statement[];
  readonly location: SourceLocation;
}
