import { getLinkpath, type TFile } from "obsidian";

import type { CachedMetadataWithLinkReferences, LinkReference } from "indexing/model";
import type { IMetadataCache } from "obsidian-integration/hostContracts";
import type { OrderedBacklinkRef } from "../indexState";
import {
	resolveLinkFromRawLinkPath,
	type LinkResolutionAmbiguityDetector,
	type ResolvedLinkInfo,
} from "../link-resolution/linkResolution";
import type { YieldScheduler, YieldStepGenerator } from "../timeSlicing";

export interface ResolvedLinkMemo {
	globalResolvedMemo: Map<string, ResolvedLinkInfo>;
	localResolvedMemo: Map<string, ResolvedLinkInfo>;
}

export interface ResolvedBacklinkRef {
	linkReference: LinkReference;
	resolved: ResolvedLinkInfo;
	offset: number;
	rawLinkPath: string;
}

export function createResolvedLinkMemo(): ResolvedLinkMemo {
	return {
		globalResolvedMemo: new Map<string, ResolvedLinkInfo>(),
		localResolvedMemo: new Map<string, ResolvedLinkInfo>(),
	};
}

function clearFileLocalResolvedMemo(resolvedMemo: ResolvedLinkMemo): void {
	resolvedMemo.localResolvedMemo.clear();
}

function getMemoizedResolvedLinkInfo(
	resolvedMemo: ResolvedLinkMemo,
	rawLinkPath: string,
): ResolvedLinkInfo | undefined {
	return (
		resolvedMemo.localResolvedMemo.get(rawLinkPath) ??
		resolvedMemo.globalResolvedMemo.get(rawLinkPath)
	);
}

function setMemoizedResolvedLinkInfo(
	resolvedMemo: ResolvedLinkMemo,
	rawLinkPath: string,
	resolved: ResolvedLinkInfo,
): void {
	if (resolved.isAmbiguous) {
		resolvedMemo.localResolvedMemo.set(rawLinkPath, resolved);
		return;
	}

	resolvedMemo.globalResolvedMemo.set(rawLinkPath, resolved);
}

function resolveLinkReferenceForSourceRaw(
	metadataCache: IMetadataCache,
	sourcePath: string,
	link: LinkReference,
	rawLinkPath: string,
	resolvedMemo: ResolvedLinkMemo,
	ambiguityDetector: LinkResolutionAmbiguityDetector,
): ResolvedLinkInfo {
	let resolved = getMemoizedResolvedLinkInfo(resolvedMemo, rawLinkPath);
	if (!resolved) {
		resolved = resolveLinkFromRawLinkPath(
			metadataCache,
			rawLinkPath,
			sourcePath,
			ambiguityDetector,
		);
		setMemoizedResolvedLinkInfo(resolvedMemo, rawLinkPath, resolved);
	}

	return resolved;
}

export function createOrderedBacklinkRef(
	link: LinkReference,
	resolved: ResolvedLinkInfo,
): OrderedBacklinkRef {
	return {
		destinationPath: resolved.destinationPath,
		rawLookupKey: resolved.rawLookupKey,
		isUnresolved: resolved.isUnresolved,
		rawText: link.link,
	};
}

function getLinkReferenceOffset(link: LinkReference): number {
	return "position" in link ? (link.position?.start.offset ?? -1) : -1;
}

function* visitReferencesChunked(
	metadataCache: IMetadataCache,
	sourcePath: string,
	references: readonly LinkReference[] | undefined,
	resolvedMemo: ResolvedLinkMemo,
	ambiguityDetector: LinkResolutionAmbiguityDetector,
	yieldScheduler: YieldScheduler,
	visit: (
		linkReference: LinkReference,
		resolved: ResolvedLinkInfo,
		offset: number,
		rawLinkPath: string,
	) => void,
	cadence: number,
	referenceCount: number,
): Generator<Promise<void>, number, void> {
	if (!references) {
		return referenceCount;
	}

	for (let i = 0; i < references.length; i++) {
		const linkReference = references[i];
		const rawLinkPath = getLinkpath(linkReference.link);
		const resolved = resolveLinkReferenceForSourceRaw(
			metadataCache,
			sourcePath,
			linkReference,
			rawLinkPath,
			resolvedMemo,
			ambiguityDetector,
		);

		visit(
			linkReference,
			resolved,
			getLinkReferenceOffset(linkReference),
			rawLinkPath,
		);

		referenceCount++;

		const pendingYield = yieldScheduler.checkpoint(referenceCount, cadence);
		if (pendingYield) {
			yield pendingYield;
		}
	}

	return referenceCount;
}

export function* visitResolvedBacklinkRefsUnorderedChunked(
	metadataCache: IMetadataCache,
	sourceFile: TFile,
	cache: CachedMetadataWithLinkReferences | null,
	ambiguityDetector: LinkResolutionAmbiguityDetector,
	resolvedMemo: ResolvedLinkMemo,
	yieldScheduler: YieldScheduler,
	visit: (
		linkReference: LinkReference,
		resolved: ResolvedLinkInfo,
		offset: number,
		rawLinkPath: string,
	) => void,
	cadence: number,
): YieldStepGenerator {
	clearFileLocalResolvedMemo(resolvedMemo);

	if (!cache) {
		return;
	}

	let referenceCount = 0;
	const sourcePath = sourceFile.path;

	referenceCount = yield* visitReferencesChunked(
		metadataCache,
		sourcePath,
		cache.links,
		resolvedMemo,
		ambiguityDetector,
		yieldScheduler,
		visit,
		cadence,
		referenceCount,
	);
	referenceCount = yield* visitReferencesChunked(
		metadataCache,
		sourcePath,
		cache.embeds,
		resolvedMemo,
		ambiguityDetector,
		yieldScheduler,
		visit,
		cadence,
		referenceCount,
	);
	yield* visitReferencesChunked(
		metadataCache,
		sourcePath,
		cache.frontmatterLinks,
		resolvedMemo,
		ambiguityDetector,
		yieldScheduler,
		visit,
		cadence,
		referenceCount,
	);
}

export async function visitResolvedBacklinkRefsUnorderedAsync(
	metadataCache: IMetadataCache,
	sourceFile: TFile,
	cache: CachedMetadataWithLinkReferences | null,
	ambiguityDetector: LinkResolutionAmbiguityDetector,
	resolvedMemo: ResolvedLinkMemo,
	yieldScheduler: YieldScheduler,
	visit: (
		linkReference: LinkReference,
		resolved: ResolvedLinkInfo,
		offset: number,
		rawLinkPath: string,
	) => void,
	cadence: number,
): Promise<void> {
	for (const step of visitResolvedBacklinkRefsUnorderedChunked(
		metadataCache,
		sourceFile,
		cache,
		ambiguityDetector,
		resolvedMemo,
		yieldScheduler,
		visit,
		cadence,
	)) {
		await step;
	}
}
