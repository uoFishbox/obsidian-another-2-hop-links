# AGENTS.md — Cosense-style card links (Obsidian plugin)

Compact guide for agents working in this repo.

## Quick commands

| Task                 | Command                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Dev (watch)          | `bun run dev`                                                                                                                     |
| Build (production)   | `bun run build`                                                                                                                   |
| Run all tests        | `bun run test`                                                                                                                    |
| Test (unit/node)     | `bun run test:unit`                                                                                                               |
| Test (dom-all)       | `bun run test:dom-all`                                                                                                            |
| Test (dom-unit)      | `bun run test:dom-unit`                                                                                                           |
| Test (dom-svelte)    | `bun run test:dom-svelte`                                                                                                         |
| Test (performance)   | `bun run test:perf`                                                                                                               |
| Test (watch)         | `bun run test:watch`                                                                                                              |
| Test (UI)            | `bun run test:ui`                                                                                                                 |
| Test (coverage)      | `bun run test:coverage`                                                                                                           |
| Type/Svelte check    | `bun run check`                                                                                                                   |
| Check circular deps  | `bun run check:circular`                                                                                                          |
| Run single test file | `bun run test -- src/cards/sorting/__tests__/sortService.test.ts`                                                                 |
| Version bump         | `npm version patch` (or `minor` / `major`) — updates `manifest.json`, `package.json`, `versions.json`, and git-adds the first two |

- Package scripts use `bun`, but CI (`release.yml`) uses `npm install` + `npm run build`.
- Built artifact is `main.js`. It is **gitignored** but uploaded to GitHub releases.
- `data.json` (plugin settings at runtime) is gitignored.
- `bks/` contains backup zip files — do not delete or modify.

## Build & bundle facts

- Entry: `src/main.ts` → `main.js` (CJS, es2018 target, minified in production).
- Bundler: `esbuild` via `esbuild.config.mjs`:
    - `esbuild-svelte` (css: `'injected'`, preprocess: `sveltePreprocess()`)
    - `esbuild-plugin-inline-worker` (inlines preview text processing workers)
- `obsidian`, `electron`, all `@codemirror/*`, `@lezer/*`, and Node builtins are **external** — never bundle them.
- Dev mode emits inline sourcemaps; production does not.
- `process.env.NODE_ENV` is injected as `"development"` or `"production"`.
- `vitest.config.js` is a compiled duplicate of `vitest.config.ts` — edit only the `.ts` file.

## TypeScript & Svelte quirks

- **Svelte 5** with runes. Reactive stores live in `.svelte.ts` files (e.g. `ApplicationStore.svelte.ts`).
- `tsconfig.json` sets `verbatimModuleSyntax: true` — type-only imports **must** use `import type`.
- `strict: true`, `isolatedModules: true`, `module: ESNext`, `moduleResolution: bundler`.
- Path alias: `"*": ["./src/*"]` in tsconfig (bare imports resolve to `src/`). Vitest also maps `@/` to `./src/`.
- Types automatically available: `obsidian-typings`, `@types/bun`, `vitest/globals`.
- `lib` includes `ES2021.WeakRef` — WeakRef is used in the codebase.

## Test setup

- Framework: **Vitest** + **jsdom** + `@testing-library/svelte`
- Setup: `src/testing/setupTests.ts` (polyfills `requestIdleCallback`, `matchMedia`, `ResizeObserver`, etc.)
- Pattern: `**/__tests__/**/*.test.ts`
- DOM/jsdom tests must use the `*.dom.test.ts` suffix (e.g. `CardPreview.dom.test.ts`). Pure unit tests use `*.test.ts`.
- `obsidian` is aliased to `src/testing/__mocks__/obsidianMocks.ts` during tests.
- Pool: `threads`. Coverage provider: `v8`.

## Repo layout

```
src/
  main.ts                    # Plugin entry (Obsidian Plugin class)
  appConstants.ts           # Shared constants
  cards/                    # Card models, lists, grids, interactions, and virtualization
  indexing/                 # Vault indexing and query state
  two-hop/                  # Two-hop resolution, display state, and UI
  preview/                  # Card preview pipeline, rendering, scheduling, and popovers
  search/                   # Search filtering and worker boundary
  settings/                 # Settings model, persistence, effects, and UI
  obsidian/                 # Obsidian integration, lifecycle, workspace, and custom-view hosts
  shared/                   # Feature-independent utilities and UI foundations
  types/                    # Cross-feature host and domain contracts
  testing/                  # Test setup, mocks, and architecture checks
```

- Custom views: `TwoHopLinksPage`, `PreCreationView`, `TagNotesView`.
- Full-text search runs on demand on the main thread with cooperative time slicing.

## Code style

- EditorConfig: **tabs**, indent size 4, LF line endings, UTF-8.

## Shadow DOM styles

- Styles inside Shadow DOM are **not** defined in `styles.css`.
- Shadow DOM card render styles are defined in `src/cards/components/cardRenderShadowStyles.ts` (exported as `CARD_RENDER_SHADOW_CSS`).
- The Shadow DOM surface is created by `ensureCardRenderShadowSurface()` in `src/cards/components/cardRenderShadowSurface.ts`, which:
    - Calls `host.attachShadow({ mode: "open" })`
    - Injects `CARD_RENDER_SHADOW_CSS` into a `<style>` element inside the shadow root
    - Registers the shadow root for MathJax style syncing
- Shadow DOM is used for rendering card link surfaces (virtual lists, virtual grids, view-plan flow lists) to isolate styles from the host document.

## Shadow DOM hover popovers

- Implementation lives in `src/preview/popover/shadow-hover/`. See that directory's `README.md` for architecture, mechanisms, and invariants.

## Release workflow

1. Update `minAppVersion` in `manifest.json` if needed.
2. Run `npm version patch/minor/major`. This reads `npm_package_version` env var and runs `version-bump.mjs` to sync `manifest.json` and `versions.json`.
3. Push the resulting tag.
4. CI (`.github/workflows/release.yml`) builds on Node 20 and creates a **draft** release attaching `main.js` + `manifest.json`.

> **Note**: `version-bump.mjs` reads `minAppVersion` from `manifest.json` to populate `versions.json`. If `minAppVersion` is missing, `versions.json` entries will be `undefined`.

## Common gotchas

- **Lifecycle**: The plugin mounts Svelte components into MarkdownViews via `MarkdownRenderChild`. Cleanup happens through `onunload()` of those children, not just Svelte `unmount`. Check `ComponentController.ts` before changing mount/unmount logic.
- **Patching**: The plugin monkey-patches Obsidian internals (Canvas, MarkdownView, Property, Workspace, GlobalSearch, Bookmark, PagePreview). Changes to patchers can have broad side effects.
- **Store caching**: `ComponentController` maintains an LRU of `ApplicationStore` instances keyed by `leafId:filePath`. Any change to store lifetime or keying must respect ref-counting and trimming logic.
- **Search**: Full-text matching must remain unique-file based, cancellable, and cooperatively time-sliced. Do not reintroduce a resident full-content index without profiling evidence.
- **Styles**: `styles.css` is shipped with the plugin; it uses CSS custom properties prefixed with `--ccl-`.
- **Shadow hover state**: See `src/preview/popover/shadow-hover/README.md` for the invariants (pure reducers, no parallel lifecycle/interaction fields).

## Command Output

Protect context usage. **Any command with unknown or potentially large output must be byte-capped.**

Default pattern:

```bash
COMMAND 2>&1 | head -c 8000
```

Test pattern:

```bash
COMMAND 2>&1 | tail -c 8000
```

When running tests (especially DOM tests), set a generous timeout. Tests involving jsdom, Svelte rendering, or worker communication can take longer than the default. (e.g. 300s)

# TypeScript Coding Style Document

The goal is to maintain code that can be safely edited by humans, the TypeScript compiler, linters, tests, and LLM agents. Prioritize securing boundaries with types, implementing with small functions, and maintaining a state verifiable by tools over beautiful abstractions.

---

## Core Philosophy

- TypeScript is both an implementation language and a verifiable specification.
- Types are not just for show; they represent public APIs, configurations, domain constraints, and boundary conditions.
- Prefer functions, modules, and file scopes over class hierarchies.
- Keep the public surface small and confine private helpers to the same file.
- Prioritize straightforward control flow, early returns, and explicit branching over exceptional abstractions.
- Emphasize locality, naming, testing, and type checking to ensure LLMs can edit code safely.

---

## File Structure

As a rule, assign a cohesive unit of change to each file. A file may contain
the types, constants, helpers, and implementation that normally change
together; splitting every concept into its own file is not a goal.

Create a new file only when at least one of the following is true:

- It owns behavior that is independently changed or tested.
- It is consumed by multiple production modules.
- It forms a clear public API, external boundary, or framework-context identity.
- It separates IO from pure logic or otherwise gives dependencies a useful direction.
- It isolates a meaningful change axis from the original file.

Co-locate types with the implementation that owns them. Do not mechanically
create `types.ts`, `*Types.ts`, `*Context.ts`, or one-function wrappers. A
barrel is a public façade only when its consumer fan-out makes that boundary
intentional; otherwise import the concrete module directly.

Use file size as a review signal, not a hard formatter rule: files over 450
lines require a change-axis review, files over 600 lines are refactor
candidates with an explicit rationale, and files under 50 lines with one
production consumer are co-location candidates unless they form an explicit
boundary.

```txt
src/
  index.ts
  cli.ts
  config.ts
  runner.ts
  parseArgs.ts
  types.ts
```

Minimize what is exposed outside the file.

```ts
// Good
export function createRunner(options: RunnerOptions) {
	// ...
}

function resolveCommand(input: string): string | null {
	// private helper
}
```

Do not export unused helpers unnecessarily.

---

## Function First

Prefer functions over classes.

```ts
// Good
export function createClient(options: ClientOptions): Client {
	const cache = new Map<string, string>();

	async function get(key: string): Promise<string | null> {
		return cache.get(key) ?? null;
	}

	return { get };
}
```

Classes should only be used when there is a clear reason, such as:

- The external library's API requires a class.
- An Error subclass is required.
- There is a clear advantage to holding state and behavior as an instance.
- It aligns with Web or Node.js standard types.

---

## Public API Design

Always explicitly define types in the public API.

```ts
export interface BuildOptions {
	root?: string;
	mode?: "development" | "production";
	watch?: boolean;
}

export interface BuildResult {
	outputFiles: string[];
	warnings: string[];
}

export async function buildProject(options: BuildOptions): Promise<BuildResult> {
	// ...
}
```

Use union literals in configuration objects to restrict allowable values via types.

```ts
type BuildMode = "development" | "production";
type OutputTarget = "node" | "browser" | "neutral";
```

Do not settle for `string`.

```ts
// Bad
type BuildOptions = {
	mode: string;
};
```

---

## Type Rules

### Use `type` or `interface` intentionally

- Use `interface` for the public API of object shapes.
- Use `type` for unions, branded types, and mapped types.

```ts
export interface Config {
	root: string;
	mode: "dev" | "prod";
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

### Avoid `any`

`any` is prohibited in principle. Use `unknown` if necessary and narrow down at the boundaries.

```ts
function parseJson(input: string): unknown {
	return JSON.parse(input);
}

function isConfig(value: unknown): value is Config {
	if (typeof value !== "object" || value === null) return false;
	return "root" in value;
}
```

### Prefer discriminated union

Avoid representing states as combinations of booleans.

```ts
// Good
type LoadState =
	| { type: "idle" }
	| { type: "loading" }
	| { type: "success"; data: string }
	| { type: "failure"; error: Error };

// Bad
type LoadState = {
	loading: boolean;
	data?: string;
	error?: Error;
};
```

---

## Error Handling

Return expected failures within the application as values rather than throwing exceptions.

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

function readConfigFile(path: string): Result<Config, ConfigError> {
	// ...
}
```

Limit the places where exceptions are acceptable:

- CLI entry points
- Process boundaries
- Boundaries capturing failures from external libraries
- Truly unrecoverable invariant violations

```ts
async function main() {
	const result = await runCli(process.argv.slice(2));

	if (!result.ok) {
		console.error(result.error.message);
		process.exit(1);
	}
}
```

Avoid throwing `Error` easily in internal logic.

---

## Control Flow

Use early returns to keep nesting shallow.

```ts
function resolveEntry(input: string | undefined): string | null {
	if (!input) return null;
	if (input.startsWith(".")) return path.resolve(input);
	return input;
}
```

Guard against out-of-scope cases early.

```ts
for (const file of files) {
	if (!file.endsWith(".ts")) continue;
	if (file.endsWith(".test.ts")) continue;

	results.push(file);
}
```

Do not obscure control flow with complex abstractions.

---

## Mutability

In principle, keep externally visible state immutable. However, mutable arrays, `Map`s, and `Set`s are allowed in local processes, parsers, transformers, caches, and compiler-like operations.

```ts
function collectFiles(entries: string[]): string[] {
	const results: string[] = [];

	for (const entry of entries) {
		if (!entry.endsWith(".ts")) continue;
		results.push(entry);
	}

	return results;
}
```

Local mutation for the sake of readability and performance is acceptable. Avoid mutating shared state.

---

## Async and IO

Push IO to the boundaries. Separate pure transformation logic from side effects.

```ts
export async function loadConfig(path: string): Promise<Result<Config, ConfigError>> {
	const content = await readFile(path, "utf-8");
	return parseConfig(content);
}

export function parseConfig(content: string): Result<Config, ConfigError> {
	// pure
}
```

To make testing easier, do not embed operations like `readFile` or `process.cwd()` deep within functions. Pass them as arguments or options if necessary.

---

## Naming

Keep names descriptive of their role without making them excessively short.

```ts
// Good
resolveConfigPath;
collectDeclarationFiles;
createLanguageServer;
parseCommandLineArgs;

// Bad
doIt;
handle;
processData;
manager;
```

Avoid ambiguous names like `manager`, `helper`, `util`, or `common`. If the responsibility cannot be explained by the name, split the design.

---

## Comments and JSDoc

Write JSDoc for public APIs. Avoid writing comments for internal implementations that are obvious from reading the code.

```ts
export interface PluginOptions {
	/**
	 * Project root directory.
	 * @default process.cwd()
	 */
	root?: string;

	/**
	 * Enable file watching.
	 * @default false
	 */
	watch?: boolean;
}
```

Write comments explaining "why" you are doing something, not "what" you are doing.

```ts
// Good
// MoonBit emits declaration files into target/js by default.
// Keep this lookup local so plugin users do not need to configure it manually.

// Bad
// Loop through files.
```

---

## Testing

Write unit tests for pure functions. Write integration tests for CLI, LSP, plugins, and filesystem integrations.

```ts
import { expect, test } from "vitest";
import { parseConfig } from "./config";

test("parseConfig returns config for valid input", () => {
	const result = parseConfig(`{"root":"."}`);

	expect(result.ok).toBe(true);
});
```

Make test names readable as specifications.

```ts
test("returns null when config file does not exist", async () => {
	// ...
});
```

---

## LLM Editing Rules

LLM agents must adhere to the following rules.

### Before editing

- Read existing type definitions.
- If modifying a public API, search for caller references as well.
- Follow existing testing, linting, and formatting guidelines.
- Verify if an existing function with the same responsibility already exists.

### While editing

- Minimize the scope of changes.
- Align with the existing design.
- Do not add unnecessary abstractions.
- Do not introduce new classes; express logic using functions first.
- Do not use `any`.
- Do not introduce new exceptions; represent failures using Result, null, or empty arrays.
- Add types and JSDoc to public APIs.

### After editing

Run the following.

```sh
bun run check
```

---

## Preferred Patterns

### Factory function with private helpers

```ts
export interface RunnerOptions {
	root?: string;
}

export interface Runner {
	run(input: string): Promise<Result<string, RunnerError>>;
}

export function createRunner(options: RunnerOptions = {}): Runner {
	const root = options.root ?? process.cwd();

	async function run(input: string): Promise<Result<string, RunnerError>> {
		const resolved = resolveInput(root, input);
		if (!resolved.ok) return resolved;

		return execute(resolved.value);
	}

	return { run };
}

function resolveInput(root: string, input: string): Result<string, RunnerError> {
	if (!input) {
		return { ok: false, error: { type: "missing-input" } };
	}

	return { ok: true, value: path.resolve(root, input) };
}
```

### Discriminated error type

```ts
export type RunnerError =
	| { type: "missing-input" }
	| { type: "file-not-found"; path: string }
	| { type: "command-failed"; command: string; exitCode: number };
```

### Exhaustive switch

```ts
function formatError(error: RunnerError): string {
	switch (error.type) {
		case "missing-input":
			return "Missing input";
		case "file-not-found":
			return `File not found: ${error.path}`;
		case "command-failed":
			return `Command failed: ${error.command}`;
		default: {
			const _exhaustive: never = error;
			return _exhaustive;
		}
	}
}
```

---

## Anti-patterns

Avoid these.

```ts
// Bad: vague option values
type Options = {
	mode: string;
};
```

```ts
// Bad: unnecessary class
class ConfigLoader {
	async load() {}
}
```

```ts
// Bad: boolean state explosion
type State = {
	isLoading: boolean;
	isError: boolean;
	data?: string;
};
```

```ts
// Bad: hidden failure
function loadConfig(): Config {
	throw new Error("config not found");
}
```

```ts
// Bad: any
function handle(input: any): any {
	return input.value;
}
```

```ts
// Bad: over-abstracted helper
function processData(data: unknown) {
	// unclear responsibility
}
```

---

## Review Checklist

Review the following when examining a pull request or an LLM patch:

- Does `bun run check` pass?
- Are the types sound under the assumption of `strict` mode?
- Has `any` been introduced?
- Are public API types explicitly defined?
- Are failures represented as values?
- Have classes or massive abstractions been added unnecessarily?
- Is the control flow kept shallow via early returns?
- Are IO and pure logic separated?
- Are tests readable as specifications?
- Does the code maintain locality that makes it easy for an LLM to edit next?

---

## Final Instruction for Agents

When writing code, first secure the boundaries with types, then implement using small functions. If in doubt, prefer file-scoped private helpers and explicit union types over adding abstractions. Code that is safe for LLMs is also safe for humans.

Always respond to users in Japanese.
