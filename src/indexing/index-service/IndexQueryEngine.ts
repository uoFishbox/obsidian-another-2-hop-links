import { getLinkpath, type TFile } from "obsidian";
import type {
	IndexedLink,
	IndexedLinkQueryResult,
	LinkReference,
} from "indexing/model";
import { collectLinkReferences } from "indexing/metadata/metadataExtractor";
import { resolveFileByPath } from "obsidian-integration/files/resolveFileByPath";
import type { IMetadataCache, IVault } from "obsidian-integration/hostContracts";
import type { ReadonlyIndexState } from "../indexState";
import {
	decodeEdgeKey,
	resolvedEdgeKey,
	unresolvedEdgeKey,
	type EdgeKey,
} from "../link-index/linkIndex";

interface IncomingView {
	readonly key: EdgeKey;
	readonly sources: ReadonlyMap<string, number>;
}

/** Materializes presentation data lazily from the canonical two-map index. */
export class IndexQueryEngine {
	private readonly cachedIndexedLinks = new Map<EdgeKey, IndexedLinkQueryResult>();
	private readonly cachedUniqueIndexedLinks = new Map<
		EdgeKey,
		Map<string, IndexedLinkQueryResult>
	>();

	public constructor(
		private readonly vault: IVault,
		private readonly metadataCache: IMetadataCache,
	) {}

	public getBacklinksForLink(
		snapshot: ReadonlyIndexState,
		linkPath: string,
	): IndexedLinkQueryResult {
		const incoming = this.getIncomingView(snapshot, linkPath);
		if (!incoming) return EMPTY_INDEXED_LINKS;
		const cached = this.cachedIndexedLinks.get(incoming.key);
		if (cached) return cached;

		const links = freezeIndexedLinks(this.collectIncomingIndexedLinks(incoming));
		this.cachedIndexedLinks.set(incoming.key, links);
		return links;
	}

	public getUniqueBacklinkSourcesForLink(
		snapshot: ReadonlyIndexState,
		linkPath: string,
		excludePath?: string,
		limit?: number,
	): IndexedLinkQueryResult {
		const incoming = this.getIncomingView(snapshot, linkPath);
		if (!incoming) return EMPTY_INDEXED_LINKS;
		const excludeKey = excludePath ?? "";
		const limitKey = typeof limit === "number" && limit > 0 ? String(limit) : "all";
		const cacheKey = `${excludeKey}\u0000${limitKey}`;
		let cacheForEdge = this.cachedUniqueIndexedLinks.get(incoming.key);
		if (!cacheForEdge) {
			cacheForEdge = new Map();
			this.cachedUniqueIndexedLinks.set(incoming.key, cacheForEdge);
		}
		const cached = cacheForEdge.get(cacheKey);
		if (cached) return cached;

		const links = freezeIndexedLinks(
			this.collectIncomingIndexedLinks(incoming, { excludePath, limit }),
		);
		cacheForEdge.set(cacheKey, links);
		return links;
	}

	public getBacklinkCountForLink(
		snapshot: ReadonlyIndexState,
		linkPath: string,
	): number {
		return this.getIncomingView(snapshot, linkPath)?.sources.size ?? 0;
	}

	public hasAtLeastUniqueBacklinkSources(
		snapshot: ReadonlyIndexState,
		linkPath: string,
		minCount: number,
		options?: {
			excludePath?: string;
			requireExistingSourceFile?: boolean;
		},
	): boolean {
		if (minCount <= 0) return true;
		const incoming = this.getIncomingView(snapshot, linkPath);
		if (!incoming) return false;

		let count = 0;
		for (const sourcePath of incoming.sources.keys()) {
			if (options?.excludePath === sourcePath) continue;
			if (
				options?.requireExistingSourceFile &&
				!resolveFileByPath(this.vault, sourcePath)
			) {
				continue;
			}
			count++;
			if (count >= minCount) return true;
		}
		return false;
	}

	public isUnresolvedWithSingleBacklink(
		snapshot: ReadonlyIndexState,
		lookupPath: string,
	): boolean {
		if ((snapshot.incoming.get(resolvedEdgeKey(lookupPath))?.size ?? 0) > 0) {
			return false;
		}
		return snapshot.incoming.get(unresolvedEdgeKey(lookupPath))?.size === 1;
	}

	public isUnresolvedWithSingleBacklinkBatch(
		snapshot: ReadonlyIndexState,
		lookupPaths: string[],
	): Map<string, boolean> {
		const result = new Map<string, boolean>();
		for (const path of lookupPaths) {
			result.set(path, this.isUnresolvedWithSingleBacklink(snapshot, path));
		}
		return result;
	}

	public invalidate(keys?: Iterable<EdgeKey>): void {
		if (!keys) {
			this.cachedIndexedLinks.clear();
			this.cachedUniqueIndexedLinks.clear();
			return;
		}
		for (const key of keys) {
			this.cachedIndexedLinks.delete(key);
			this.cachedUniqueIndexedLinks.delete(key);
		}
	}

	private getIncomingView(
		snapshot: ReadonlyIndexState,
		linkPath: string,
	): IncomingView | undefined {
		const resolvedKey = resolvedEdgeKey(linkPath);
		const resolvedSources = snapshot.incoming.get(resolvedKey);
		if (resolvedSources?.size) {
			return { key: resolvedKey, sources: resolvedSources };
		}

		const unresolvedKey = unresolvedEdgeKey(linkPath);
		const unresolvedSources = snapshot.incoming.get(unresolvedKey);
		return unresolvedSources?.size
			? { key: unresolvedKey, sources: unresolvedSources }
			: undefined;
	}

	private collectIncomingIndexedLinks(
		incoming: IncomingView,
		options?: { readonly excludePath?: string; readonly limit?: number },
	): IndexedLink[] {
		const links: IndexedLink[] = [];
		const limit =
			typeof options?.limit === "number" && options.limit > 0
				? options.limit
				: undefined;

		for (const [sourcePath, count] of incoming.sources) {
			if (sourcePath === options?.excludePath) continue;
			const sourceFile = resolveFileByPath(this.vault, sourcePath);
			if (!sourceFile) continue;
			links.push(this.materializeIndexedLink(incoming.key, sourceFile, count));
			if (limit !== undefined && links.length >= limit) break;
		}
		return links;
	}

	private materializeIndexedLink(
		key: EdgeKey,
		sourceFile: TFile,
		count: number,
	): IndexedLink {
		const edge = decodeEdgeKey(key)!;
		const reference = this.findRepresentativeReference(key, sourceFile);
		return {
			rawText: reference?.link ?? edge.path,
			path: edge.path,
			lookupPath: edge.path,
			isUnresolved: edge.type === "unresolved",
			sourceFile,
			position:
				reference && "position" in reference ? reference.position : undefined,
			backlinkCount: count,
			key: reference && "key" in reference ? reference.key : undefined,
		};
	}

	private findRepresentativeReference(
		key: EdgeKey,
		sourceFile: TFile,
	): LinkReference | undefined {
		const references = collectLinkReferences(
			this.metadataCache.getFileCache(sourceFile),
		);
		const edge = decodeEdgeKey(key);
		if (!edge) return undefined;

		for (const reference of references) {
			const rawPath = getLinkpath(reference.link);
			const destination = this.metadataCache.getFirstLinkpathDest(
				rawPath,
				sourceFile.path,
			);
			if (edge.type === "resolved") {
				if (destination?.path === edge.path) return reference;
				continue;
			}
			if (!destination && unresolvedEdgeKey(rawPath) === key) return reference;
		}
		return undefined;
	}
}

const EMPTY_INDEXED_LINKS: IndexedLinkQueryResult = Object.freeze([]);

function freezeIndexedLinks(links: IndexedLink[]): IndexedLinkQueryResult {
	for (const link of links) Object.freeze(link);
	return Object.freeze(links);
}
