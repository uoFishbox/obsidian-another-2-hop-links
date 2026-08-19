import { FileSystemAdapter, Platform, type App, type Pos } from "obsidian";
import { z } from "zod";
import { getSearchQueryTerms } from "./searchQueryTerms";
import type {
	SearchWorkerItemSnapshot,
	SearchWorkerMatchedItem,
} from "./searchWorkerTypes";

type ExecFile = typeof import("child_process").execFile;

const RIPGREP_COMMAND_LINE_BUDGET_CHARS = 24_000;
const RIPGREP_SEARCH_CONCURRENCY = 3;
const EMPTY_CONTENT_PREVIEW_BY_PATH: ReadonlyMap<string, string> = new Map();
const RIPGREP_FIXED_ARGS = [
	"--json",
	"--line-number",
	"--fixed-strings",
	"--ignore-case",
	"--path-separator=/",
	"--max-count",
	"1",
	"--",
] as const;
function getUtf8ByteLengthForCodePoint(codePoint: number): number {
	if (codePoint <= 0x7f) return 1;
	if (codePoint <= 0x7ff) return 2;
	if (codePoint <= 0xffff) return 3;
	return 4;
}

function forEachLine(text: string, visitor: (line: string) => void): void {
	let start = 0;

	for (let index = 0; index < text.length; index += 1) {
		const charCode = text.charCodeAt(index);
		if (charCode !== 10) continue;

		const end =
			index > start && text.charCodeAt(index - 1) === 13 ? index - 1 : index;

		if (end > start) {
			visitor(text.slice(start, end));
		}

		start = index + 1;
	}

	if (start < text.length) {
		visitor(text.slice(start));
	}
}

export function collectUniqueTargetFilePaths(
	items: readonly SearchWorkerItemSnapshot[],
): string[] {
	const seen = new Set<string>();
	const paths: string[] = [];

	for (const item of items) {
		const path = item.targetFilePath;
		if (!path || seen.has(path)) continue;

		seen.add(path);
		paths.push(path);
	}

	return paths;
}

export interface RipgrepContentSearchResult {
	matchesByTerm: Map<string, Set<string>>;
	previewByPath: Map<string, string>;
	positionByPath: Map<string, Pos>;
}

export interface RipgrepContentSearchOptions {
	signal?: AbortSignal;
	concurrency?: number;
}

function createAbortError(): DOMException | Error {
	if (typeof DOMException !== "undefined") {
		return new DOMException("ripgrep content search aborted", "AbortError");
	}

	const error = new Error("ripgrep content search aborted");
	error.name = "AbortError";
	return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw createAbortError();
	}
}

function isAbortError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		(error as { name?: unknown }).name === "AbortError"
	);
}

function getExecFile(): ExecFile | null {
	if (!Platform.isDesktopApp) {
		return null;
	}

	try {
		const req = (0, eval)("require") as (id: string) => unknown;
		const childProcess = req("child_process") as typeof import("child_process");
		return childProcess.execFile;
	} catch {
		return null;
	}
}

function getVaultBasePath(app: App): string | null {
	if (!Platform.isDesktopApp) {
		return null;
	}

	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		return null;
	}

	return adapter.getBasePath();
}

function execFileText(
	execFile: ExecFile,
	command: string,
	args: string[],
	cwd: string,
	signal?: AbortSignal,
): Promise<string> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(createAbortError());
			return;
		}

		let settled = false;
		let child: ReturnType<ExecFile> | null = null;
		const cleanup = (): void => {
			signal?.removeEventListener("abort", onAbort);
		};
		const settleResolve = (value: string): void => {
			if (settled) {
				return;
			}

			settled = true;
			cleanup();
			resolve(value);
		};
		const settleReject = (error: unknown): void => {
			if (settled) {
				return;
			}

			settled = true;
			cleanup();
			reject(error);
		};
		const onAbort = (): void => {
			child?.kill();
			settleReject(createAbortError());
		};

		signal?.addEventListener("abort", onAbort, { once: true });
		child = execFile(
			command,
			args,
			{
				cwd,
				windowsHide: true,
				timeout: 15_000,
				maxBuffer: 32 * 1024 * 1024,
			},
			(error, stdout) => {
				if (error) {
					if (signal?.aborted || isAbortError(error)) {
						settleReject(createAbortError());
						return;
					}

					const maybeCode = (error as { code?: unknown }).code;
					if (maybeCode === 1) {
						settleResolve("");
						return;
					}

					settleReject(error);
					return;
				}

				settleResolve(String(stdout));
			},
		);
	});
}

function normalizeRipgrepPath(path: string): string {
	return path.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function byteOffsetToStringIndex(text: string, byteOffset: number): number {
	if (byteOffset <= 0) {
		return 0;
	}

	let bytes = 0;
	for (let index = 0; index < text.length; index += 1) {
		const codePoint = text.codePointAt(index) ?? 0;
		const nextBytes = bytes + getUtf8ByteLengthForCodePoint(codePoint);
		if (nextBytes > byteOffset) {
			return index;
		}

		bytes = nextBytes;
		if (codePoint > 0xffff) {
			index += 1;
		}
	}

	return text.length;
}

function buildRipgrepMatchPosition(match: {
	lineNumber: number;
	lineText: string;
	submatchStart: number;
	submatchEnd: number;
}): Pos {
	const line = Math.max(0, match.lineNumber - 1);
	const startCol = byteOffsetToStringIndex(match.lineText, match.submatchStart);
	const endCol = Math.max(
		startCol + 1,
		byteOffsetToStringIndex(match.lineText, match.submatchEnd),
	);

	return {
		start: {
			line,
			col: startCol,
			offset: -1,
		},
		end: {
			line,
			col: endCol,
			offset: -1,
		},
	};
}

const ripgrepMatchSchema = z.object({
	type: z.literal("match"),
	data: z.object({
		path: z.object({ text: z.string() }),
		lines: z.object({ text: z.string() }),
		line_number: z.number(),
		submatches: z.array(
			z.object({
				start: z.number(),
				end: z.number(),
			}),
		),
	}),
});

function parseRipgrepJsonMatches(stdout: string): {
	paths: Set<string>;
	previewByPath: Map<string, string>;
	positionByPath: Map<string, Pos>;
} {
	const paths = new Set<string>();
	const previewByPath = new Map<string, string>();
	const positionByPath = new Map<string, Pos>();

	forEachLine(stdout, (line) => {
		if (!line.trim()) {
			return;
		}

		let obj: unknown;
		try {
			obj = JSON.parse(line);
		} catch {
			return;
		}

		const result = ripgrepMatchSchema.safeParse(obj);
		if (!result.success) {
			return;
		}

		const match = result.data;
		const rawPath = match.data.path.text;
		const path = normalizeRipgrepPath(rawPath);
		paths.add(path);

		if (!previewByPath.has(path)) {
			previewByPath.set(path, match.data.lines.text.trim());
		}

		const firstSubmatch = match.data.submatches[0];
		if (firstSubmatch && !positionByPath.has(path)) {
			positionByPath.set(
				path,
				buildRipgrepMatchPosition({
					lineNumber: match.data.line_number,
					lineText: match.data.lines.text,
					submatchStart: firstSubmatch.start,
					submatchEnd: firstSubmatch.end,
				}),
			);
		}
	});
	return { paths, previewByPath, positionByPath };
}

function estimateCommandLineArgChars(arg: string): number {
	// Windows CreateProcess has a 32767-character command-line limit.
	// Node quotes/escapes arguments internally, so use a conservative estimate.
	return arg.length * 2 + 3;
}

function chunkRipgrepTargetPaths(
	command: string,
	baseArgs: readonly string[],
	targetFilePaths: string[],
): string[][] {
	const fixedArgLength = [command, ...baseArgs].reduce(
		(total, arg) => total + estimateCommandLineArgChars(arg) + 1,
		0,
	);
	const chunks: string[][] = [];
	let currentChunk: string[] = [];
	let currentLength = fixedArgLength;

	for (const path of targetFilePaths) {
		const pathLength = estimateCommandLineArgChars(path) + 1;
		if (
			currentChunk.length > 0 &&
			currentLength + pathLength > RIPGREP_COMMAND_LINE_BUDGET_CHARS
		) {
			chunks.push(currentChunk);
			currentChunk = [];
			currentLength = fixedArgLength;
		}

		currentChunk.push(path);
		currentLength += pathLength;
	}

	if (currentChunk.length > 0) {
		chunks.push(currentChunk);
	}

	return chunks;
}

async function runLimited<T>(
	items: readonly T[],
	concurrency: number,
	signal: AbortSignal | undefined,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	const limit = Math.max(1, Math.floor(concurrency));
	let nextIndex = 0;

	const runNext = async (): Promise<void> => {
		while (nextIndex < items.length) {
			throwIfAborted(signal);
			const item = items[nextIndex];
			nextIndex += 1;
			await worker(item);
		}
	};

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
}

export async function searchRipgrepContentByTerm(
	app: App,
	query: string,
	ripgrepExecutablePath?: string,
	targetFilePaths: string[] = [],
	options: RipgrepContentSearchOptions = {},
): Promise<RipgrepContentSearchResult> {
	const execFile = getExecFile();
	const vaultBasePath = getVaultBasePath(app);
	if (!execFile || !vaultBasePath) {
		throw new Error("ripgrep content search is available only on desktop.");
	}

	const terms = getSearchQueryTerms(query);
	const { signal, concurrency = RIPGREP_SEARCH_CONCURRENCY } = options;
	throwIfAborted(signal);

	const rg = ripgrepExecutablePath?.trim() || "rg";
	const matchesByTerm = new Map<string, Set<string>>();
	const previewByPath = new Map<string, string>();
	const positionByPath = new Map<string, Pos>();
	const uniqueTargetFilePaths: string[] = [];
	{
		const seen = new Set<string>();
		for (const path of targetFilePaths) {
			if (!seen.has(path)) {
				seen.add(path);
				uniqueTargetFilePaths.push(path);
			}
		}
	}

	if (uniqueTargetFilePaths.length === 0) {
		for (const term of terms) {
			matchesByTerm.set(term, new Set());
		}

		return { matchesByTerm, previewByPath, positionByPath };
	}

	const ripgrepTasks: {
		baseArgs: string[];
		filePathChunk: string[];
		matchedPaths: Set<string>;
	}[] = [];
	for (const term of terms) {
		const matchedPaths = new Set<string>();
		matchesByTerm.set(term, matchedPaths);
		const baseArgs = [...RIPGREP_FIXED_ARGS, term];
		for (const filePathChunk of chunkRipgrepTargetPaths(
			rg,
			baseArgs,
			uniqueTargetFilePaths,
		)) {
			ripgrepTasks.push({
				baseArgs,
				filePathChunk,
				matchedPaths,
			});
		}
	}

	await runLimited(
		ripgrepTasks,
		concurrency,
		signal,
		async ({ baseArgs, filePathChunk, matchedPaths }) => {
			const stdout = await execFileText(
				execFile,
				rg,
				[...baseArgs, ...filePathChunk],
				vaultBasePath,
				signal,
			);

			throwIfAborted(signal);
			const parsed = parseRipgrepJsonMatches(stdout);
			for (const path of parsed.paths) {
				matchedPaths.add(path);
			}
			for (const [path, preview] of parsed.previewByPath) {
				if (!path.endsWith(".md") && !previewByPath.has(path)) {
					previewByPath.set(path, preview);
				}
			}
			for (const [path, position] of parsed.positionByPath) {
				if (!positionByPath.has(path)) {
					positionByPath.set(path, position);
				}
			}
		},
	);

	return { matchesByTerm, previewByPath, positionByPath };
}

export function filterSearchDatasetWithRipgrepMatches(
	items: readonly SearchWorkerItemSnapshot[],
	query: string,
	contentMatchesByTerm: ReadonlyMap<string, ReadonlySet<string>>,
	contentPreviewByPath: ReadonlyMap<string, string> = EMPTY_CONTENT_PREVIEW_BY_PATH,
): SearchWorkerMatchedItem[] {
	const queryTerms = getSearchQueryTerms(query);
	if (queryTerms.length === 0) {
		const matchedItems = new Array<SearchWorkerMatchedItem>(items.length);
		for (let index = 0; index < items.length; index += 1) {
			matchedItems[index] = {
				key: items[index].key,
				contentMatched: false,
			};
		}
		return matchedItems;
	}

	const matchedItems: SearchWorkerMatchedItem[] = [];

	for (const item of items) {
		let contentMatched = false;
		let matched = true;

		for (const term of queryTerms) {
			const termTitleMatched = item.searchText.includes(term);
			const termContentMatched =
				!!item.targetFilePath &&
				(contentMatchesByTerm.get(term)?.has(item.targetFilePath) ?? false);

			if (!termTitleMatched && !termContentMatched) {
				matched = false;
				break;
			}

			contentMatched =
				contentMatched || (!termTitleMatched && termContentMatched);
		}

		if (matched) {
			const contentPreview =
				contentMatched && item.targetFilePath
					? contentPreviewByPath.get(item.targetFilePath)
					: undefined;
			const matchedItem: SearchWorkerMatchedItem = {
				key: item.key,
				contentMatched,
			};
			if (contentPreview) {
				matchedItem.contentPreview = contentPreview;
			}
			matchedItems.push(matchedItem);
		}
	}

	return matchedItems;
}
