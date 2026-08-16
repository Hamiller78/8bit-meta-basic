import type { Expression } from "../ast.js";
import { canonicalFunctionName, type BuiltinFunctionName } from "../functions.js";
import type { ExpressionRenderOptions } from "./target.js";

export type FunctionCallExpression = Extract<Expression, { kind: "function-call" }>;
export type TargetFunctionRenderer = (expression: FunctionCallExpression, options: ExpressionRenderOptions) => string;

export function createFunctionRenderer(renderers: ReadonlyMap<BuiltinFunctionName, TargetFunctionRenderer>) {
  return (expression: FunctionCallExpression, options: ExpressionRenderOptions): string | undefined => {
    const name = canonicalFunctionName(expression.name);
    if (!name) {
      return undefined;
    }

    return renderers.get(name)?.(expression, options);
  };
}
