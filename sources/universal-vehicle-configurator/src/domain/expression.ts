import type { BuyerContext, Expression, JsonValue } from "./catalog.types";

export interface ExpressionContext {
  selected: ReadonlySet<string>;
  price: Record<string, unknown>;
  specs: Record<string, JsonValue>;
  buyer: BuyerContext;
  product: Record<string, unknown>;
}

export type ExpressionTruth = true | false | "unknown";

export function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function isComparable(value: unknown): value is number | string {
  return typeof value === "number" || typeof value === "string";
}

export function evaluateExpression(expr: Expression | undefined, context: ExpressionContext): boolean {
  if (expr === undefined || expr === true) return true;
  if (expr === false) return false;
  if ("all" in expr) return expr.all.every((part) => evaluateExpression(part, context));
  if ("any" in expr) return expr.any.some((part) => evaluateExpression(part, context));
  if ("not" in expr) return !evaluateExpression(expr.not, context);
  if ("selected" in expr) return context.selected.has(expr.selected);

  const actual = getPath(context, expr.var);
  switch (expr.op) {
    case "eq":
      return actual === expr.value;
    case "ne":
      return actual !== expr.value;
    case "lt":
      return isComparable(actual) && isComparable(expr.value) && actual < expr.value;
    case "lte":
      return isComparable(actual) && isComparable(expr.value) && actual <= expr.value;
    case "gt":
      return isComparable(actual) && isComparable(expr.value) && actual > expr.value;
    case "gte":
      return isComparable(actual) && isComparable(expr.value) && actual >= expr.value;
    case "in":
      return Array.isArray(expr.value) && expr.value.some((value) => value === actual);
    case "truthy":
      return actual !== "unknown" && Boolean(actual);
    default: {
      const exhaustive: never = expr.op;
      throw new Error(`Unknown expression operator: ${String(exhaustive)}`);
    }
  }
}

function isUnknownBuyerValue(path: string, value: unknown): boolean {
  return path.startsWith("buyer.") && (value === undefined || value === null || value === "unknown");
}

export function evaluateExpressionTruth(
  expr: Expression | undefined,
  context: ExpressionContext,
): ExpressionTruth {
  if (expr === undefined || expr === true) return true;
  if (expr === false) return false;
  if ("selected" in expr) return context.selected.has(expr.selected);
  if ("var" in expr) {
    const actual = getPath(context, expr.var);
    if (isUnknownBuyerValue(expr.var, actual)) return "unknown";
    return evaluateExpression(expr, context);
  }
  if ("not" in expr) {
    const value = evaluateExpressionTruth(expr.not, context);
    return value === "unknown" ? value : !value;
  }
  if ("all" in expr) {
    const values = expr.all.map((part) => evaluateExpressionTruth(part, context));
    if (values.includes(false)) return false;
    return values.includes("unknown") ? "unknown" : true;
  }

  const values = expr.any.map((part) => evaluateExpressionTruth(part, context));
  if (values.includes(true)) return true;
  return values.includes("unknown") ? "unknown" : false;
}

export function explainExpression(expr: Expression | undefined, context: ExpressionContext): string | null {
  if (expr === undefined || expr === true) return null;
  if (expr === false) return "categorically unavailable";

  if ("all" in expr) {
    for (const part of expr.all) {
      if (!evaluateExpression(part, context)) return explainExpression(part, context);
    }
    return null;
  }

  if ("any" in expr) {
    const reasons = expr.any.map((part) => explainExpression(part, context) ?? "condition");
    return `none of the qualifying conditions hold: ${reasons.join(" / ")}`;
  }

  if ("not" in expr) {
    return `requires NOT(${explainExpression(expr.not, context) ?? "condition"})`;
  }

  if ("selected" in expr) return `requires option '${expr.selected}'`;

  return `requires ${expr.var} ${expr.op} ${JSON.stringify(expr.value)} (actual: ${JSON.stringify(
    getPath(context, expr.var),
  )})`;
}

export function collectSelectedOptionReferences(expr: Expression | undefined): string[] {
  const references = new Set<string>();

  const visit = (part: Expression | undefined): void => {
    if (part === undefined || typeof part === "boolean") return;
    if ("selected" in part) references.add(part.selected);
    else if ("all" in part) part.all.forEach(visit);
    else if ("any" in part) part.any.forEach(visit);
    else if ("not" in part) visit(part.not);
  };

  visit(expr);
  return [...references];
}

export function collectVariableReferences(expr: Expression | undefined): string[] {
  const references = new Set<string>();

  const visit = (part: Expression | undefined): void => {
    if (part === undefined || typeof part === "boolean") return;
    if ("var" in part) references.add(part.var);
    else if ("all" in part) part.all.forEach(visit);
    else if ("any" in part) part.any.forEach(visit);
    else if ("not" in part) visit(part.not);
  };

  visit(expr);
  return [...references];
}

export function missingBuyerContextPaths(expr: Expression | undefined, context: ExpressionContext): string[] {
  return collectVariableReferences(expr)
    .filter((path) => path.startsWith("buyer."))
    .filter((path) => {
      const value = getPath(context, path);
      return isUnknownBuyerValue(path, value);
    });
}
