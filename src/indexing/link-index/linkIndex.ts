import {
	normalizeLinkToMarkdownPath,
	toCaseInsensitiveLookupKey,
} from "../link-resolution/linkResolution";
import type { IMetadataCache } from "obsidian-integration/hostContracts";

const RESOLVED_EDGE_PREFIX = "\x01";
const UNRESOLVED_EDGE_PREFIX = "\x02";

export type EdgeKey = string;

export interface SourceEdge {
	readonly key: EdgeKey;
	readonly count: number;
}

export interface LinkIndex {
	incoming: Map<EdgeKey, Map<string, number>>;
	outgoing: Map<string, readonly SourceEdge[]>;
}

export interface ReadonlyLinkIndex {
	readonly incoming: ReadonlyMap<EdgeKey, ReadonlyMap<string, number>>;
	readonly outgoing: ReadonlyMap<string, readonly SourceEdge[]>;
}

export type EdgeIdentity =
	| { readonly type: "resolved"; readonly path: string }
	| { readonly type: "unresolved"; readonly path: string };

export interface LinkIndexMutationSink {
	markChangedEdge(key: EdgeKey): void;
}

/** Creates the canonical two-direction link index. */
export function createEmptyLinkIndex(): LinkIndex {
	return {
		incoming: new Map(),
		outgoing: new Map(),
	};
}

/** Creates the identity used for a resolved destination path. */
export function resolvedEdgeKey(path: string): EdgeKey {
	return `${RESOLVED_EDGE_PREFIX}${path}`;
}

/** Creates the case-insensitive identity used for an unresolved lookup path. */
export function unresolvedEdgeKey(rawPath: string): EdgeKey {
	const lookupPath = normalizeLinkToMarkdownPath(rawPath);
	return `${UNRESOLVED_EDGE_PREFIX}${toCaseInsensitiveLookupKey(lookupPath)}`;
}

/** Decodes an internal edge identity for query materialization and notifications. */
export function decodeEdgeKey(key: EdgeKey): EdgeIdentity | undefined {
	if (key.startsWith(RESOLVED_EDGE_PREFIX)) {
		return { type: "resolved", path: key.slice(RESOLVED_EDGE_PREFIX.length) };
	}
	if (key.startsWith(UNRESOLVED_EDGE_PREFIX)) {
		return {
			type: "unresolved",
			path: key.slice(UNRESOLVED_EDGE_PREFIX.length),
		};
	}
	return undefined;
}

/** Returns the DOM/query lookup key represented by an internal edge identity. */
export function getLookupKeyForEdge(key: EdgeKey): string | undefined {
	const edge = decodeEdgeKey(key);
	return edge ? toCaseInsensitiveLookupKey(edge.path) : undefined;
}

/** Reads one canonical, sorted source row from Obsidian's completed link graph. */
export function readCurrentSourceRow(
	metadataCache: IMetadataCache,
	sourcePath: string,
): readonly SourceEdge[] {
	const row: SourceEdge[] = [];
	const resolved = metadataCache.resolvedLinks[sourcePath];
	if (resolved) {
		for (const [destinationPath, count] of Object.entries(resolved)) {
			if (!isPositiveCount(count)) continue;
			row.push({ key: resolvedEdgeKey(destinationPath), count });
		}
	}

	const unresolved = metadataCache.unresolvedLinks[sourcePath];
	if (unresolved) {
		const countsByKey = new Map<EdgeKey, number>();
		for (const [rawPath, count] of Object.entries(unresolved)) {
			if (!isPositiveCount(count)) continue;
			const key = unresolvedEdgeKey(rawPath);
			countsByKey.set(key, (countsByKey.get(key) ?? 0) + count);
		}
		for (const [key, count] of countsByKey) {
			row.push({ key, count });
		}
	}

	row.sort(compareSourceEdges);
	return row;
}

/** Collects the union of sources currently exposed by the host graph. */
export function collectHostSourcePaths(metadataCache: IMetadataCache): Set<string> {
	return new Set([
		...Object.keys(metadataCache.resolvedLinks),
		...Object.keys(metadataCache.unresolvedLinks),
	]);
}

/**
 * Reconciles one source row and updates its reverse edges in linear time.
 * Returns false when the host row is structurally identical.
 */
export function reconcileSourceRow(
	index: LinkIndex,
	sourcePath: string,
	nextRow: readonly SourceEdge[],
	sink: LinkIndexMutationSink,
): boolean {
	const previousRow = index.outgoing.get(sourcePath) ?? [];
	let previousIndex = 0;
	let nextIndex = 0;
	let changed = false;

	while (previousIndex < previousRow.length || nextIndex < nextRow.length) {
		const previous = previousRow[previousIndex];
		const next = nextRow[nextIndex];

		if (!next || (previous && previous.key < next.key)) {
			removeIncomingSource(index, previous.key, sourcePath);
			sink.markChangedEdge(previous.key);
			previousIndex++;
			changed = true;
			continue;
		}

		if (!previous || next.key < previous.key) {
			setIncomingSource(index, next.key, sourcePath, next.count);
			sink.markChangedEdge(next.key);
			nextIndex++;
			changed = true;
			continue;
		}

		if (previous.count !== next.count) {
			setIncomingSource(index, next.key, sourcePath, next.count);
			sink.markChangedEdge(next.key);
			changed = true;
		}
		previousIndex++;
		nextIndex++;
	}

	if (!changed) return false;
	if (nextRow.length === 0) {
		index.outgoing.delete(sourcePath);
	} else {
		index.outgoing.set(sourcePath, nextRow);
	}
	return true;
}

/** Marks every edge in a row, including presentation-only source changes. */
export function visitSourceRowKeys(
	row: readonly SourceEdge[] | undefined,
	visitor: (key: EdgeKey) => void,
): void {
	if (!row) return;
	for (const edge of row) {
		visitor(edge.key);
	}
}

function setIncomingSource(
	index: LinkIndex,
	key: EdgeKey,
	sourcePath: string,
	count: number,
): void {
	let sources = index.incoming.get(key);
	if (!sources) {
		sources = new Map();
		index.incoming.set(key, sources);
	}
	sources.set(sourcePath, count);
}

function removeIncomingSource(
	index: LinkIndex,
	key: EdgeKey,
	sourcePath: string,
): void {
	const sources = index.incoming.get(key);
	if (!sources) return;
	sources.delete(sourcePath);
	if (sources.size === 0) {
		index.incoming.delete(key);
	}
}

function compareSourceEdges(left: SourceEdge, right: SourceEdge): number {
	return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

function isPositiveCount(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}
