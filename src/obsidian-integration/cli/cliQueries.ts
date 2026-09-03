import type { TFile } from "obsidian";
import { extractTags } from "indexing/metadata/metadataExtractor";
import { getLookupPathForLink } from "indexing/link-resolution/linkResolution";
import { runStreamingSearch } from "search/streamingSearch";
import { expandCliPageEmbeds } from "./cliPageEmbeds";
import {
	cliFailure,
	findCliFile,
	type CliContext,
	type CliFailure,
	type CliResult,
} from "./cliProtocol";

export type CliQueryAction =
	| "list1hopLinks"
	| "list2hopLinks"
	| "search1hopLinks"
	| "search2hopLinks";

/** Pagination shared by the plugin's graph inspection commands. */
export interface CliPaginationParams {
	limit: number;
	offset: number;
	sort: "title" | "updated" | "created";
}

/** Parsed parameters for inspecting a page and its graph neighborhood. */
export interface CliInspectPageParams extends CliPaginationParams {
	path: string;
}

/** Parsed parameters for the plugin's graph queries. */
export interface CliQueryParams extends CliInspectPageParams {
	query?: string;
	or?: boolean;
}

interface PageSummary {
	id: string;
	path: string;
	title: string;
	persistent: boolean;
	created?: string;
	updated?: string;
	tags?: string[];
	relation?: "outgoing" | "incoming" | "bidirectional";
	via?: string[];
	search?: { contentMatched: boolean; offset?: number; length?: number };
}

interface CliNeighborhood {
	file: TFile;
	links1hop: PageSummary[];
	links2hop: PageSummary[];
}

interface PageCollection {
	items: PageSummary[];
	count: number;
	pagination: {
		offset: number;
		limit: number;
		nextOffset: number | null;
	};
}

/** Reads a page and returns its one-hop and two-hop context without opening UI. */
export async function inspectCliPage(
	context: CliContext,
	params: CliInspectPageParams,
): Promise<CliResult> {
	const neighborhood = await collectCliNeighborhood(context, params.path);
	if (!neighborhood.ok) return neighborhood;
	const content = await context.host.app.vault.cachedRead(neighborhood.file);
	if (context.signal.aborted) return cliFailure("cancelled", "Plugin unloaded");
	const expanded = expandCliPageEmbeds(context.host.app, neighborhood.file, content);

	return {
		ok: true,
		path: params.path,
		page: {
			...summarize(context, neighborhood.file),
			content: expanded.content,
			embeds: expanded.embeds,
		},
		relatedPages: {
			oneHop: collectPageCollection(neighborhood.links1hop, params),
			twoHop: collectPageCollection(neighborhood.links2hop, params),
		},
	};
}

/** Searches unique graph targets using the existing resolver and streaming search. */
export async function runCliQuery(
	context: CliContext,
	action: CliQueryAction,
	params: CliQueryParams,
): Promise<CliResult> {
	const { signal } = context;
	const { app } = context.host;
	const isHop1 = action === "list1hopLinks" || action === "search1hopLinks";
	const neighborhood = await collectCliNeighborhood(context, params.path);
	if (!neighborhood.ok) return neighborhood;
	let pages = isHop1 ? neighborhood.links1hop : neighborhood.links2hop;

	if (params.query) {
		const matches = new Map<string, NonNullable<PageSummary["search"]>>();
		const offsets = new Map<string, { offset: number; length: number }>();
		await runStreamingSearch({
			vault: app.vault,
			files: app.vault.getFiles(),
			items: pages.map((page) => ({
				key: page.path,
				searchText: page.title,
				targetFilePath: page.persistent ? page.path : null,
			})),
			query: params.query,
			operator: params.or ? "or" : "and",
			scope: "title-and-content",
			isCancelled: () => signal.aborted,
			onUpdate: (update) => {
				for (const entry of update.addedContentMatches)
					offsets.set(entry.path, entry.match);
				for (const match of update.addedMatches)
					matches.set(match.key, {
						contentMatched: match.contentMatched,
						...offsets.get(match.key),
					});
			},
		});
		pages = pages
			.filter((page) => matches.has(page.path))
			.map((page) => ({ ...page, search: matches.get(page.path) }));
	}
	if (signal.aborted) return cliFailure("cancelled", "Plugin unloaded");
	const collection = collectPageCollection(pages, params);
	const key = isHop1 ? "links1hop" : "links2hop";
	return {
		ok: true,
		[key]: collection.items,
		count: collection.count,
		pagination: collection.pagination,
		path: params.path,
		...(params.query ? { searchQuery: params.query } : {}),
	};
}

async function collectCliNeighborhood(
	context: CliContext,
	path: string,
): Promise<({ ok: true } & CliNeighborhood) | CliFailure> {
	const { host, signal } = context;
	const { app } = host;
	const found = findCliFile(app, path);
	if (!found.ok) return found;
	await host.indexingService.awaitIdle();
	if (signal.aborted) return cliFailure("cancelled", "Plugin unloaded");
	if (!host.indexingService.isReady())
		return cliFailure(
			"not-ready",
			"Link index is still initializing; retry shortly",
		);
	const graph = await host.getTwoHopLinkResult(found.file, undefined, {
		includeTaggedNotes: false,
		signal,
	});
	const direct = new Map<string, PageSummary>();
	for (const branch of graph.branches) {
		const targetPath = branch.hop1.path ?? getLookupPathForLink(branch.hop1);
		if (targetPath === found.file.path) continue;
		const target = findCliFile(app, targetPath);
		direct.set(targetPath, {
			...(target.ok
				? summarize(context, target.file)
				: {
						id: targetPath,
						path: targetPath,
						title: branch.hop1.rawText,
						persistent: false,
					}),
			relation: "outgoing",
		});
	}
	for (const backlink of graph.backlinks) {
		const file = backlink.sourceFile;
		if (file.path === found.file.path) continue;
		const previous = direct.get(file.path);
		direct.set(file.path, {
			...summarize(context, file),
			relation:
				previous?.relation === "outgoing" ||
				previous?.relation === "bidirectional"
					? "bidirectional"
					: "incoming",
		});
	}
	const indirect = new Map<string, PageSummary>();
	for (const branch of graph.branches) {
		const via = branch.hop1.path ?? getLookupPathForLink(branch.hop1);
		for (const link of branch.hop2) {
			const file = link.sourceFile;
			if (file.path === found.file.path || direct.has(file.path)) continue;
			let page = indirect.get(file.path);
			if (!page) {
				page = { ...summarize(context, file), via: [] };
				indirect.set(file.path, page);
			}
			if (!page.via!.includes(via)) page.via!.push(via);
		}
	}
	return {
		ok: true,
		file: found.file,
		links1hop: [...direct.values()],
		links2hop: [...indirect.values()],
	};
}

function collectPageCollection(
	pages: readonly PageSummary[],
	params: CliPaginationParams,
): PageCollection {
	const sortedPages = [...pages].sort((a, b) => {
		if (params.sort !== "title") {
			const byDate = (b[params.sort] ?? "").localeCompare(a[params.sort] ?? "");
			if (byDate) return byDate;
		}
		return a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
	});
	const count = sortedPages.length;
	const items = sortedPages.slice(params.offset, params.offset + params.limit);
	return {
		items,
		count,
		pagination: {
			offset: params.offset,
			limit: params.limit,
			nextOffset:
				params.offset + items.length < count
					? params.offset + items.length
					: null,
		},
	};
}

function summarize(context: CliContext, file: TFile): PageSummary {
	return {
		id: file.path,
		path: file.path,
		title: file.basename,
		persistent: true,
		created: new Date(file.stat.ctime).toISOString(),
		updated: new Date(file.stat.mtime).toISOString(),
		tags: extractTags(context.host.app.metadataCache.getFileCache(file)).map(
			(tag) => tag.tag,
		),
	};
}
