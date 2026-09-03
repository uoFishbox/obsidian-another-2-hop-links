import { TFile } from "obsidian";
import type { App } from "obsidian";
import { z } from "zod";
import type { PluginHost } from "obsidian-integration/pluginHost";

/** Services and cancellation owned by one plugin CLI registration. */
export interface CliContext {
	readonly host: Pick<PluginHost, "app" | "indexingService" | "getTwoHopLinkResult">;
	readonly signal: AbortSignal;
}

export type CliErrorCode =
	| "invalid-params"
	| "not-found"
	| "conflict"
	| "not-ready"
	| "cancelled"
	| "io-error";

/** JSON failures are values because the host handler only returns a string. */
export interface CliFailure {
	ok: false;
	error: { code: CliErrorCode; message: string };
	details?: Record<string, unknown>;
}

export type CliResult<T extends object = Record<string, unknown>> =
	| ({ ok: true } & T)
	| CliFailure;

/** Constructs the common CLI error envelope. */
export function cliFailure(code: CliErrorCode, message: string): CliFailure {
	return { ok: false, error: { code, message } };
}

// Exact vault-relative paths keep CLI writes independent of the active editor.
const vaultPath = z
	.string()
	.min(1)
	.max(1024)
	.refine(
		(path) =>
			!/[\\\x00-\x1f:*?"<>|#\[\]]/.test(path) &&
			path
				.split("/")
				.every(
					(part) =>
						part.length > 0 &&
						part !== "." &&
						part !== ".." &&
						!part.startsWith(".") &&
						!/[. ]$/.test(part),
				),
		"Use an exact vault-relative path with / separators and no hidden or parent directories",
	);
export const notePath = vaultPath.refine(
	(path) => path.endsWith(".md"),
	"path must end in .md",
);
export const cliBoolean = z
	.enum(["true", "false"])
	.optional()
	.transform((value) => value === "true");
const integer = z
	.string()
	.regex(/^\d+$/)
	.transform(Number)
	.pipe(z.number().int().safe());
export const paginationShape = {
	limit: integer.pipe(z.number().min(1).max(1000)).optional().default(100),
	offset: integer.pipe(z.number().min(0)).optional().default(0),
	sort: z.enum(["title", "updated", "created"]).optional().default("title"),
};
export const searchShape = {
	query: z.string().trim().min(1).max(2000),
	or: cliBoolean,
};

/** Looks up a file by exact path; never falls back to the active file or basename. */
export function findCliFile(app: App, path: string): CliResult<{ file: TFile }> {
	const file = app.vault.getAbstractFileByPath(path);
	return file instanceof TFile
		? { ok: true, file }
		: cliFailure("not-found", `File not found: ${path}`);
}
