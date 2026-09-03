import type {
	App,
	CachedMetadata,
	CliData,
	CliFlags,
	CliHandler,
	TFile,
} from "obsidian";
import { vi } from "vitest";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { PluginHost } from "obsidian-integration/pluginHost";
import type { TwoHopLinkResult } from "two-hop/model";

/** In-memory Obsidian boundary exercising the registered handlers and actual CLI services. */
export function createCliTestVault(initial: Record<string, string> = {}) {
	const contents = new Map(Object.entries(initial));
	const files = new Map(
		Object.keys(initial).map((path) => {
			const extension = path.slice(path.lastIndexOf(".") + 1);
			return [path, createMockTFile(path, extension)] as const;
		}),
	);
	const metadata = new Map<string, CachedMetadata>();
	const handlers = new Map<string, { flags: CliFlags | null; handler: CliHandler }>();
	const cleanups: (() => void)[] = [];
	const read = vi.fn(async (file: TFile) => contents.get(file.path) ?? "");
	const process = vi.fn(
		async (file: TFile, transform: (content: string) => string) => {
			const after = transform(contents.get(file.path) ?? "");
			contents.set(file.path, after);
			return after;
		},
	);
	const app = {
		vault: {
			getAbstractFileByPath: (path: string) => files.get(path) ?? null,
			getMarkdownFiles: () =>
				[...files.values()].filter((file) => file.extension === "md"),
			getFiles: () => [...files.values()],
			read,
			cachedRead: read,
			process,
		},
		metadataCache: {
			getFileCache: (file: TFile) => metadata.get(file.path) ?? null,
			getFirstLinkpathDest: (link: string) =>
				files.get(link) ?? files.get(`${link}.md`) ?? null,
		},
		fileManager: {
			generateMarkdownLink: (
				file: TFile,
				_source: string,
				anchor = "",
				alias?: string,
			) => `[[${file.basename}${anchor}${alias ? `|${alias}` : ""}]]`,
		},
		workspace: { getLeaf: vi.fn() },
	} as unknown as App;
	const getTwoHopLinkResult = vi.fn(
		async (file: TFile): Promise<TwoHopLinkResult> => ({
			originFile: file,
			branches: [],
			backlinks: [...files.values()]
				.filter((source) => source.path !== file.path)
				.map((sourceFile) => ({
					sourceFile,
					path: file.path,
					rawText: file.path,
					isUnresolved: false,
				})),
			taggedNotes: [],
		}),
	);
	const host = {
		app,
		manifest: { id: "test-plugin", version: "1.0.0" },
		indexingService: {
			awaitIdle: async () => undefined,
			isReady: () => true,
			getUniqueBacklinkSourcesForLink: (path: string) =>
				[...files.values()].map((sourceFile) => ({
					sourceFile,
					path,
					rawText: path,
					isUnresolved: false,
				})),
		},
		getTwoHopLinkResult,
		register: (callback: () => void) => cleanups.push(callback),
		registerCliHandler: (
			command: string,
			_description: string,
			flags: CliFlags | null,
			handler: CliHandler,
		) => handlers.set(command, { flags, handler }),
	} as unknown as PluginHost;
	return {
		host,
		files,
		contents,
		metadata,
		handlers,
		read,
		process,
		getTwoHopLinkResult,
		destroy: () => cleanups.forEach((cleanup) => cleanup()),
		async call(
			action: string,
			params: CliData = {},
		): Promise<Record<string, unknown>> {
			const command = action ? `test-plugin:${action}` : "test-plugin";
			const output = await handlers.get(command)!.handler(params);
			return JSON.parse(output) as Record<string, unknown>;
		},
	};
}
