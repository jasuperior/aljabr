# Parser Construction

Parsers are where algebraic types earn their keep. A parser needs to model a stream of tokens with distinct types and payloads, an AST with recursive structure, and error conditions at every step. All three of those things are naturally unions — and `match` over them is both exhaustive and readable.

This guide is in two acts. The first builds a complete expression parser from scratch using token and AST unions, recursive `match`, and a hand-rolled evaluator. The second shows how to decode an external representation of the same AST — JSON from an API or a config file — through the `aljabr/schema` pipeline, arriving at a fully typed domain value ready for evaluation.

---

## Act 1: Token unions and AST evaluation

### Modeling tokens

The first step in any parser is a lexer — a function that turns raw text into a flat list of tokens. Each token is a variant with specific data attached. Using a union for tokens is better than an enum + discriminant object: each variant carries only the fields it needs, and `match` forces you to handle every token kind.

```ts
import { union, Union } from "aljabr"

const Token = union({
  Number:  (value: number) => ({ value }),
  Plus:    {},
  Minus:   {},
  Star:    {},
  Slash:   {},
  LParen:  {},
  RParen:  {},
  EOF:     {},
})
type Token = Union<typeof Token>
```

Constant variants (`Plus`, `Minus`, etc.) need no data — they carry meaning through their tag alone. `EOF` signals the end of input explicitly rather than relying on array length checks.

### Lexing

The lexer walks the source string and emits tokens. Nothing surprising here — just character inspection and `Token.*` factory calls:

```ts
function lex(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < source.length) {
    const ch = source[i]

    if (/\s/.test(ch)) { i++; continue }

    if (/[0-9]/.test(ch)) {
      let num = ""
      while (i < source.length && /[0-9.]/.test(source[i])) num += source[i++]
      tokens.push(Token.Number(parseFloat(num)))
      continue
    }

    switch (ch) {
      case "+": tokens.push(Token.Plus());   break
      case "-": tokens.push(Token.Minus());  break
      case "*": tokens.push(Token.Star());   break
      case "/": tokens.push(Token.Slash());  break
      case "(": tokens.push(Token.LParen()); break
      case ")": tokens.push(Token.RParen()); break
      default:  throw new Error(`Unexpected character: '${ch}'`)
    }
    i++
  }

  tokens.push(Token.EOF())
  return tokens
}
```

### Modeling the AST

The AST has three node types: a literal number, a binary operation, and a grouped expression. `BinaryOp` holds an operator tag and its two operands — which are themselves `Expr` nodes. This is where the recursive structure lives.

```ts
const Op = union({
  Add: {},
  Sub: {},
  Mul: {},
  Div: {},
})
type Op = Union<typeof Op>

// Expr is recursive — TypeScript needs an explicit interface here
type Expr =
  | { readonly [tag]: "Literal"; value: number }
  | { readonly [tag]: "BinaryOp"; op: Op; left: Expr; right: Expr }
  | { readonly [tag]: "Group"; expr: Expr }

import { tag } from "aljabr"

const Expr = union({
  Literal:  (value: number) => ({ value }),
  BinaryOp: (op: Op, left: Expr, right: Expr) => ({ op, left, right }),
  Group:    (expr: Expr) => ({ expr }),
})
```

The `Expr` type alias is declared before the factory because TypeScript needs it for the recursive payload annotations. The factory `Expr` shadows the type in the value namespace — the same pattern used by the prelude's `Result`, `Option`, etc.

### Parsing

The parser consumes the token list and builds an AST. A recursive descent parser maps naturally to the AST structure: `parseExpr` calls `parseTerm`, which calls `parseFactor`, which can recurse back into `parseExpr` for grouped sub-expressions.

```ts
function parse(tokens: Token[]): Expr {
  let pos = 0

  function peek(): Token { return tokens[pos] }
  function consume(): Token { return tokens[pos++] }

  function parseExpr(): Expr {
    let left = parseTerm()

    while (true) {
      const t = peek()
      const op = match(t, {
        Plus:  () => Op.Add(),
        Minus: () => Op.Sub(),
        [__]:  () => null,
      })
      if (!op) break
      consume()
      left = Expr.BinaryOp(op, left, parseTerm())
    }

    return left
  }

  function parseTerm(): Expr {
    let left = parseFactor()

    while (true) {
      const t = peek()
      const op = match(t, {
        Star:  () => Op.Mul(),
        Slash: () => Op.Div(),
        [__]:  () => null,
      })
      if (!op) break
      consume()
      left = Expr.BinaryOp(op, left, parseFactor())
    }

    return left
  }

  function parseFactor(): Expr {
    const t = consume()

    return match(t, {
      Number: ({ value }) => Expr.Literal(value),
      LParen: () => {
        const expr = parseExpr()
        consume()  // consume RParen
        return Expr.Group(expr)
      },
      Minus: () => {
        const operand = parseFactor()
        return Expr.BinaryOp(Op.Sub(), Expr.Literal(0), operand)
      },
      [__]: () => { throw new Error(`Unexpected token: ${getTag(t)}`) },
    })
  }

  return parseExpr()
}
```

The `match` calls in the while-loop are doing real work: they convert a `Token` into an `Op | null` without a cast and without a string comparison. Adding a new token kind means a compile error in every `match` that doesn't handle it.

### Evaluating the AST

The evaluator walks the AST with a recursive `match`. Structural recursion on `Expr` is natural here: `BinaryOp` evaluates both sides, then dispatches on the operator.

```ts
import { match, __ } from "aljabr"

function evaluate(expr: Expr): number {
  return match(expr, {
    Literal:  ({ value }) => value,
    Group:    ({ expr }) => evaluate(expr),
    BinaryOp: ({ op, left, right }) => {
      const l = evaluate(left)
      const r = evaluate(right)
      return match(op, {
        Add: () => l + r,
        Sub: () => l - r,
        Mul: () => l * r,
        Div: () => l / r,
      })
    },
  })
}
```

Putting it together:

```ts
function calc(source: string): number {
  return evaluate(parse(lex(source)))
}

calc("2 + 3 * 4")     // 14
calc("(2 + 3) * 4")   // 20
calc("10 / 2 - 1")    // 4
```

Each stage — lex, parse, evaluate — is a pure function from one typed representation to another. The AST is the boundary between parsing and evaluation, and its union type ensures every possible shape is handled at both ends.

### Adding a transformation pass

Because the AST is a union, you can add a transformation pass without touching the evaluator. Here's a constant-folding pass that simplifies `BinaryOp` nodes where both sides are already `Literal`:

```ts
function fold(expr: Expr): Expr {
  return match(expr, {
    Literal:  (e) => e,
    Group:    ({ expr }) => fold(expr),
    BinaryOp: ({ op, left, right }) => {
      const l = fold(left)
      const r = fold(right)

      // Both sides are literals — evaluate immediately
      if (l[tag] === "Literal" && r[tag] === "Literal") {
        return Expr.Literal(evaluate(Expr.BinaryOp(op, l, r)))
      }

      return Expr.BinaryOp(op, l, r)
    },
  })
}
```

This is the key payoff of modeling the AST as a union: transformation passes are just `match`-based recursion. They compose — you can chain `fold(expr)` before `evaluate(expr)` without either knowing about the other.

---

## Act 2: Decoding an external AST

Act 1 assumed you were parsing text input. In practice, ASTs also arrive from the outside world — API responses that describe expressions, config files with rule trees, serialized query graphs. This is where `aljabr/schema` takes over.

The challenge: the wire format speaks JSON. Your domain speaks `Expr`. The schema module decodes one into the other, accumulating every error, and hands you a `Validation<Expr, DecodeError>`.

### What the wire format looks like

Suppose expressions are serialized as a tagged JSON structure:

```json
{ "type": "BinaryOp", "op": "Add",
  "left":  { "type": "Literal", "value": 2 },
  "right": { "type": "BinaryOp", "op": "Mul",
             "left":  { "type": "Literal", "value": 3 },
             "right": { "type": "Literal", "value": 4 } } }
```

### Defining the schema

`Schema.variant` maps the wire discriminant (`"type"`) to aljabr variant constructors. For the `Op` field inside `BinaryOp`, a `Schema.union` of literals handles the mapping:

```ts
import { Schema, decode } from "aljabr/schema"
import { match } from "aljabr"

// Op is a string discriminant on the wire
const OpSchema = Schema.union(
  Schema.literal("Add"),
  Schema.literal("Sub"),
  Schema.literal("Mul"),
  Schema.literal("Div"),
)

// Expr is recursive — define as a function to allow forward references
function ExprSchema(): ReturnType<typeof Schema.variant<typeof Expr>> {
  return Schema.variant(Expr, {
    Literal:  Schema.object({ value: Schema.number() }),
    BinaryOp: Schema.object({
      op:    OpSchema,
      left:  Schema.lazy(ExprSchema),
      right: Schema.lazy(ExprSchema),
    }),
    Group: Schema.object({
      expr: Schema.lazy(ExprSchema),
    }),
  })
}
```

`Schema.lazy` handles the recursive reference — it defers schema construction until decode time, breaking the circular dependency.

### Decoding and matching on errors

```ts
const raw = await fetch("/api/expressions/42").then(r => r.json())
const result = decode(ExprSchema(), raw)

match(result, {
  Valid:       ({ value: expr }) => {
    const answer = evaluate(expr)
    renderResult(answer)
  },
  Invalid:     ({ errors }) => {
    errors.forEach(err =>
      match(err, {
        TypeMismatch:         ({ path, expected, got }) =>
          console.error(`[${path.join(".")}] expected ${expected}, got ${got}`),
        MissingField:         ({ path, field }) =>
          console.error(`[${path.join(".")}] missing required field: ${field}`),
        InvalidLiteral:       ({ path, expected, got }) =>
          console.error(`[${path.join(".")}] invalid literal at ${path}: expected ${expected}, got ${got}`),
        UnrecognizedVariant:  ({ path, tag }) =>
          console.error(`[${path.join(".")}] unknown variant tag: ${tag}`),
        Custom:               ({ path, message }) =>
          console.error(`[${path.join(".")}] ${message}`),
      })
    )
  },
  Unvalidated: () => {},
})
```

`DecodeError` is itself an aljabr union — every error kind is a variant you can `match` over. The `path` array on every error tells you exactly where in the input the problem occurred, which maps directly to error highlighting in an editor or a structured API error response.

### The full pipeline

Decode → evaluate is now a two-step pipeline, each step typed and total:

```ts
async function evalFromApi(id: string): Promise<Result<number, string>> {
  const raw = await fetch(`/api/expressions/${id}`).then(r => r.json())
  const decoded = decode(ExprSchema(), raw)

  return match(decoded, {
    Valid:       ({ value: expr }) => Result.Accept(evaluate(expr)),
    Invalid:     ({ errors }) => Result.Reject(
      errors.map(formatDecodeError).join("; ")
    ),
    Unvalidated: () => Result.Reject("unexpected: unvalidated"),
  })
}
```

The domain boundary is explicit: raw JSON enters, `Validation<Expr, DecodeError>` comes out of decode, `Result<number, string>` comes out of evaluate. No `unknown` leaks past the schema layer.

### Schema variants are matchable

Because schema nodes are themselves aljabr variants, you can walk the schema structure to derive other artifacts — a JSON Schema, a documentation generator, a migration tool. The same recursive `match` pattern from Act 1 applies here:

```ts
import { type AnySchema } from "aljabr/schema"

function describeSchema(schema: AnySchema, indent = 0): string {
  const pad = " ".repeat(indent * 2)
  return match(schema, {
    NumberSchema:  () => `${pad}number`,
    StringSchema:  () => `${pad}string`,
    LiteralSchema: ({ value }) => `${pad}literal(${JSON.stringify(value)})`,
    ObjectSchema:  ({ fields }) =>
      `${pad}object {\n${
        Object.entries(fields as Record<string, AnySchema>)
          .map(([k, v]) => `${pad}  ${k}: ${describeSchema(v, indent + 1).trim()}`)
          .join("\n")
      }\n${pad}}`,
    ArraySchema:   ({ element }) =>
      `${pad}array<${describeSchema(element as AnySchema, indent).trim()}>`,
    [__]: () => `${pad}...`,
  })
}
```

The schema is a first-class value you can inspect, transform, and serialize — not just a validator you call once and discard.

---

## See also

- [Union Branching](./union-branching.md) — Result/Validation patterns for handling decode errors downstream
- [Reactive UI](./reactive-ui.md) — flowing decoded values through Ref and AsyncDerived
- [Working with External Data](../schema.md) — full `aljabr/schema` mechanics reference
- [API Reference: schema](../../api/schema.md)
