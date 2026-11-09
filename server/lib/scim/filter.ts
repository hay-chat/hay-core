import { ScimError } from "./errors";

/**
 * SCIM filters (RFC 7644 section 3.4.2.2) compiled to a parameterized SQL
 * condition. Attribute names are looked up in a whitelist, so nothing the
 * client sends is ever placed in the statement: values are bound parameters.
 */

const MAX_FILTER_LENGTH = 1000;
const MAX_NODES = 25;
const MAX_DEPTH = 8;

type Comparison = "eq" | "ne" | "co" | "sw" | "ew" | "gt" | "ge" | "lt" | "le";
const COMPARISONS: readonly string[] = ["eq", "ne", "co", "sw", "ew", "gt", "ge", "lt", "le"];

type Node =
  | { kind: "and" | "or"; left: Node; right: Node }
  | { kind: "not"; operand: Node }
  | { kind: "present"; attribute: string }
  | { kind: "compare"; attribute: string; op: Comparison; value: string | boolean | null };

type Token =
  | { type: "word"; text: string }
  | { type: "string"; text: string }
  | { type: "open" }
  | { type: "close" };

export interface FilterColumn {
  /** SQL expression for the attribute. Fixed by the caller, never from the request. */
  sql: string;
  type: "string" | "boolean";
}

function invalid(detail: string): ScimError {
  return new ScimError(400, detail, "invalidFilter");
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) {
      index += 1;
    } else if (char === "(") {
      tokens.push({ type: "open" });
      index += 1;
    } else if (char === ")") {
      tokens.push({ type: "close" });
      index += 1;
    } else if (char === '"') {
      let text = "";
      index += 1;
      let closed = false;
      while (index < input.length) {
        const next = input[index];
        if (next === "\\" && index + 1 < input.length) {
          text += input[index + 1];
          index += 2;
        } else if (next === '"') {
          closed = true;
          index += 1;
          break;
        } else {
          text += next;
          index += 1;
        }
      }
      if (!closed) throw invalid("Unterminated string in filter");
      tokens.push({ type: "string", text });
    } else {
      const start = index;
      while (index < input.length && !/[\s()"]/.test(input[index])) index += 1;
      tokens.push({ type: "word", text: input.slice(start, index) });
    }
  }
  return tokens;
}

class Parser {
  private position = 0;
  private nodes = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.parseOr(0);
    if (this.position < this.tokens.length) throw invalid("Unexpected text after the filter");
    return node;
  }

  private count(): void {
    this.nodes += 1;
    if (this.nodes > MAX_NODES) throw invalid("Filter is too complex");
  }

  private peekWord(): string | null {
    const token = this.tokens[this.position];
    return token?.type === "word" ? token.text.toLowerCase() : null;
  }

  private parseOr(depth: number): Node {
    let left = this.parseAnd(depth);
    while (this.peekWord() === "or") {
      this.position += 1;
      this.count();
      left = { kind: "or", left, right: this.parseAnd(depth) };
    }
    return left;
  }

  private parseAnd(depth: number): Node {
    let left = this.parseUnary(depth);
    while (this.peekWord() === "and") {
      this.position += 1;
      this.count();
      left = { kind: "and", left, right: this.parseUnary(depth) };
    }
    return left;
  }

  private expectClose(): void {
    if (this.tokens[this.position]?.type !== "close") throw invalid("Missing closing bracket");
    this.position += 1;
  }

  private parseUnary(depth: number): Node {
    if (depth > MAX_DEPTH) throw invalid("Filter is nested too deeply");
    const token = this.tokens[this.position];
    if (!token) throw invalid("The filter ended early");
    if (token.type === "open") {
      this.position += 1;
      const inner = this.parseOr(depth + 1);
      this.expectClose();
      return inner;
    }
    if (token.type === "word" && token.text.toLowerCase() === "not") {
      this.position += 1;
      if (this.tokens[this.position]?.type !== "open") throw invalid("Expected ( after not");
      this.position += 1;
      const operand = this.parseOr(depth + 1);
      this.expectClose();
      this.count();
      return { kind: "not", operand };
    }
    if (token.type !== "word") throw invalid("Expected an attribute name");
    this.position += 1;
    this.count();
    const attribute = token.text;
    const op = this.peekWord();
    if (op === "pr") {
      this.position += 1;
      return { kind: "present", attribute };
    }
    if (!op || !COMPARISONS.includes(op)) throw invalid(`Unsupported operator after ${attribute}`);
    this.position += 1;
    const valueToken = this.tokens[this.position];
    if (!valueToken || valueToken.type === "open" || valueToken.type === "close") {
      throw invalid(`Missing value after ${op}`);
    }
    this.position += 1;
    let value: string | boolean | null = valueToken.text;
    if (valueToken.type === "word") {
      if (valueToken.text === "true") value = true;
      else if (valueToken.text === "false") value = false;
      else if (valueToken.text === "null") value = null;
    }
    return { kind: "compare", attribute, op: op as Comparison, value };
  }
}

export interface CompiledFilter {
  sql: string;
  params: Array<string | boolean>;
}

/** Strips a schema URN prefix (`urn:...:User:userName`) and lower-cases the name. */
function normalizeAttribute(attribute: string): string {
  const colon = attribute.lastIndexOf(":");
  return (colon === -1 ? attribute : attribute.slice(colon + 1)).toLowerCase();
}

/** `firstParameter` is the number of the first `$n` placeholder this filter may use. */
export function compileFilter(
  filter: string,
  columns: Record<string, FilterColumn>,
  firstParameter: number,
): CompiledFilter {
  if (filter.length > MAX_FILTER_LENGTH) throw invalid("Filter is too long");
  const lookup = new Map(
    Object.entries(columns).map(([name, column]) => [name.toLowerCase(), column]),
  );
  const params: Array<string | boolean> = [];

  const column = (attribute: string): FilterColumn => {
    const found = lookup.get(normalizeAttribute(attribute));
    if (!found) throw invalid(`Filtering on ${attribute} is not supported`);
    return found;
  };
  const bind = (value: string | boolean): string => {
    params.push(value);
    return `$${firstParameter + params.length - 1}`;
  };

  const compile = (node: Node): string => {
    switch (node.kind) {
      case "and":
        return `(${compile(node.left)} AND ${compile(node.right)})`;
      case "or":
        return `(${compile(node.left)} OR ${compile(node.right)})`;
      case "not":
        return `(NOT ${compile(node.operand)})`;
      case "present": {
        const target = column(node.attribute);
        return target.type === "boolean"
          ? `(${target.sql} IS NOT NULL)`
          : `(${target.sql} IS NOT NULL AND ${target.sql} <> '')`;
      }
      case "compare": {
        const target = column(node.attribute);
        if (node.value === null) {
          if (node.op === "eq") return `(${target.sql} IS NULL)`;
          if (node.op === "ne") return `(${target.sql} IS NOT NULL)`;
          throw invalid("null only works with eq and ne");
        }
        if (target.type === "boolean") {
          if (typeof node.value !== "boolean" || (node.op !== "eq" && node.op !== "ne")) {
            throw invalid(`${node.attribute} takes true or false with eq or ne`);
          }
          return `(${target.sql} ${node.op === "eq" ? "=" : "<>"} ${bind(node.value)}::boolean)`;
        }
        const left = `lower(${target.sql})`;
        const right = `lower(${bind(String(node.value))}::text)`;
        switch (node.op) {
          case "eq":
            return `(${left} = ${right})`;
          case "ne":
            return `(${target.sql} IS NULL OR ${left} <> ${right})`;
          case "co":
            return `(strpos(${left}, ${right}) > 0)`;
          case "sw":
            return `(left(${left}, length(${right})) = ${right})`;
          case "ew":
            return `(right(${left}, length(${right})) = ${right})`;
          case "gt":
            return `(${left} > ${right})`;
          case "ge":
            return `(${left} >= ${right})`;
          case "lt":
            return `(${left} < ${right})`;
          case "le":
            return `(${left} <= ${right})`;
        }
      }
    }
  };

  return { sql: compile(new Parser(tokenize(filter)).parse()), params };
}
