# Test Coverage Analysis — aljabr

## Codebase Overview

- **Language:** TypeScript (ES2023, strict mode)
- **Build Tool:** Vite 8
- **Test Framework:** None detected
- **Core library files:**
  - `src/union.ts` — variant factory (`union()`), `pred()`, `when()`, symbols, types
  - `src/match.ts` — pattern match engine (`match()`)
  - `src/main.ts` — Vite demo app (not a library target, skip for unit tests)

## Existing Test Setup

- No test files found.
- No `test` script in `package.json`.
- No testing devDependencies installed.
- No `vite.config.ts` exists (Vite running on defaults).

## Coverage Gaps

Everything. The two core library files have zero test coverage:

| File | Tested? | Risk |
|---|---|---|
| `src/union.ts` | No | High — `union()`, `pred()`, `when()` are the entire public API |
| `src/match.ts` | No | High — all runtime dispatch logic is untested |

## Recommended Packages

```bash
npm install --save-dev vitest
```

Vitest is the right choice: it's Vite-native (zero extra config for a Vite project), has the same API as Jest, and handles ESM + TypeScript out of the box.

No additional packages needed — no DOM or component testing required for this pure-logic library.

## Config Changes Required

### 1. `vite.config.ts` (new file)

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        typecheck: { enabled: true },
    },
});
```

### 2. `tsconfig.json` — extend `include` to cover test files

```json
"include": ["src"]
```
→ stays as-is; Vitest resolves TypeScript independently. However, `noUnusedLocals` / `noUnusedParameters` may fire in test files. Create `tsconfig.test.json` to relax:

```json
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "noUnusedLocals": false,
        "noUnusedParameters": false
    },
    "include": ["src/**/*.test.ts"]
}
```

### 3. `package.json` — add scripts

```json
"scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
}
```

---

## Proposed Plan

### Part 1: Setup

- Install `vitest`
- Create `vite.config.ts` with test config above
- Create `tsconfig.test.json`
- Add test scripts to `package.json`

### Part 2: `src/union.test.ts` — Unit tests for `union()`, `pred()`, `when()`

#### `union()` factory
- Creates callable factories for each variant key
- Returned values carry the correct `[tag]` via `getTag()`
- `[tag]` is non-enumerable (doesn't appear in `Object.keys()`)
- Function variants forward args to the payload factory
- Constant variants return a fresh copy each call (no shared reference)
- `impl` classes are mixed into variant instances (methods present)
- Multiple `impl` classes are all present on the instance

#### `pred()`
- Returns an object tagged with `[predTag]`
- `pred(fn).fn(val)` calls `fn` with `val`
- Boolean predicate: returns `true`/`false` correctly
- Type predicate: narrows at runtime (calls `fn`, truthy/falsy)

#### `when()`
- `when(__, handler)` — stores `pattern === __`
- `when(guard, handler)` — stores `pattern = {}`, `guard = fn`
- `when(pattern, handler)` — stores pattern, no guard
- `when(pattern, guard, handler)` — stores both
- All forms return an object tagged with `[whenTag]`

### Part 3: `src/match.test.ts` — Unit tests for `match()`

#### Function matchers (existing behavior)
- Dispatches to the correct variant's function handler
- Falls through to `[__]` fallback for unhandled variants
- Throws `Unhandled variant` if no handler and no `[__]`

#### Single `when()` arm as variant value
- Matches and calls handler when pattern + guard both pass
- Falls through to `[__]` when pattern doesn't match
- Falls through to `[__]` when guard fails
- Throws if no match and no `[__]` fallback

#### Array of `when()` arms
- First matching arm wins (order matters)
- `when(__, handler)` catch-all fires when no earlier arm matches
- Exact pattern match: `{ key: "Enter" }` matches only `"Enter"`
- `pred()` in pattern: runs predicate, matches/rejects correctly
- Arm-level guard: pattern matches but guard fails → continues to next arm
- Pattern + pred + guard: all three must pass together
- `when(guard, handler)` shorthand: guard-only arm matches/rejects
- **Exhaustiveness errors:**
  - Throws with plain message when no arms match and no guards/preds used
  - Throws with "catch-all required" hint when guarded/pred arms present and no `when(__)` catch-all

#### ExactMatchers exhaustiveness
- Providing all variant keys compiles and runs without `[__]`

#### FallbackMatchers
- Partial variant map + `[__]` fallback handles unspecified variants

---

Would you like to proceed with implementing this test plan?
