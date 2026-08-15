import { toCaseInsensitiveLookupKey } from "../link-resolution/linkResolution";
import type { IndexSnapshot, SourceSummary } from "../types/IndexTypes";
import {
	HEAVY_YIELD_CHECK_INTERVAL,
	maybeYield,
	type YieldScheduler,
} from "../timeSlicing";

export interface LookupKeyCollection {
	readonly size: number;
	has(lookupKey: string): boolean;
	keys(): Iterable<string>;
}

export async function collectCacheInvalidationPathsAsync(
	snapshot: IndexSnapshot,
	affectedLookupPaths: Set<string>,
	affectedLookupKeys: Set<string>,
	yieldScheduler: YieldScheduler,
): Promise<Iterable<string>> {
	if (affectedLookupKeys.size === 0) {
		return affectedLookupPaths;
	}

	const pathsToInvalidate = new Set<string>(affectedLookupPaths);
	let pathCount = 0;

	for (const lookupKey of affectedLookupKeys) {
		const siblingLookupPaths = snapshot.lookupKeyToLookupPaths.get(lookupKey);
		if (!siblingLookupPaths) {
			continue;
		}
		for (const lookupPath of siblingLookupPaths) {
			pathsToInvalidate.add(lookupPath);

			pathCount++;
			const pendingYield = maybeYield(
				yieldScheduler,
				pathCount,
				HEAVY_YIELD_CHECK_INTERVAL,
			);
			if (pendingYield) {
				await pendingYield;
			}
		}
	}
	return pathsToInvalidate;
}

export async function replaceSourceSummaryAsync(
	snapshot: IndexSnapshot,
	sourcePath: string,
	nextSummary: SourceSummary | undefined,
	yieldScheduler: YieldScheduler,
): Promise<void> {
	const previousSummary = snapshot.sourceSummaries.get(sourcePath);

	await syncLookupIndexForSourceAsync(
		snapshot.linkLookupToSources,
		sourcePath,
		previousSummary?.firstRefIndexByLookupKey,
		nextSummary?.firstRefIndexByLookupKey,
		yieldScheduler,
	);

	if (
		nextSummary &&
		(nextSummary.destinations.size > 0 ||
			nextSummary.firstRefIndexByLookupKey.size > 0 ||
			nextSummary.unresolvedLookupKeys.size > 0)
	) {
		snapshot.sourceSummaries.set(sourcePath, nextSummary);
		return;
	}

	snapshot.sourceSummaries.delete(sourcePath);
}

export function onAddEdge(
	snapshot: IndexSnapshot,
	lookupPath: string,
	lookupKey: string,
	hadResolved: boolean,
	hasResolved: boolean,
	affectedLookupKeys: Set<string>,
): void {
	affectedLookupKeys.add(lookupKey);
	ensureLookupPathRegistered(snapshot, lookupPath, lookupKey);

	if (!hadResolved && hasResolved) {
		const resolvedSourceCount =
			(snapshot.lookupPathResolvedSourceCount.get(lookupPath) ?? 0) + 1;
		snapshot.lookupPathResolvedSourceCount.set(lookupPath, resolvedSourceCount);
	}
}

export function onRemoveSourceFromLookupPath(
	snapshot: IndexSnapshot,
	lookupPath: string,
	lookupKey: string,
	hadResolved: boolean,
	isLookupPathEmptyAfter: boolean,
	affectedLookupKeys: Set<string>,
): void {
	affectedLookupKeys.add(lookupKey);

	if (hadResolved) {
		const nextResolvedSourceCount =
			(snapshot.lookupPathResolvedSourceCount.get(lookupPath) ?? 1) - 1;

		if (nextResolvedSourceCount <= 0) {
			snapshot.lookupPathResolvedSourceCount.delete(lookupPath);
		} else {
			snapshot.lookupPathResolvedSourceCount.set(
				lookupPath,
				nextResolvedSourceCount,
			);
		}
	}

	if (isLookupPathEmptyAfter) {
		removeLookupPathRegistration(snapshot, lookupPath, lookupKey);
	}
}

export function removeLookupPath(
	snapshot: IndexSnapshot,
	lookupPath: string,
	affectedLookupKeys: Set<string>,
): void {
	const lookupKey = toCaseInsensitiveLookupKey(lookupPath);
	affectedLookupKeys.add(lookupKey);
	snapshot.lookupPathResolvedSourceCount.delete(lookupPath);
	removeLookupPathRegistration(snapshot, lookupPath, lookupKey);
}

function ensureLookupPathRegistered(
	snapshot: IndexSnapshot,
	lookupPath: string,
	lookupKey: string,
): void {
	let lookupPaths = snapshot.lookupKeyToLookupPaths.get(lookupKey);
	if (!lookupPaths) {
		lookupPaths = new Set<string>();
		snapshot.lookupKeyToLookupPaths.set(lookupKey, lookupPaths);
	}
	lookupPaths.add(lookupPath);
}

function removeLookupPathRegistration(
	snapshot: IndexSnapshot,
	lookupPath: string,
	lookupKey: string,
): void {
	const lookupPaths = snapshot.lookupKeyToLookupPaths.get(lookupKey);
	if (!lookupPaths) {
		return;
	}
	lookupPaths.delete(lookupPath);
	if (lookupPaths.size === 0) {
		snapshot.lookupKeyToLookupPaths.delete(lookupKey);
	}
}

async function syncLookupIndexForSourceAsync(
	index: Map<string, Set<string>>,
	sourcePath: string,
	previousKeys: LookupKeyCollection | undefined,
	nextKeys: LookupKeyCollection | undefined,
	yieldScheduler: YieldScheduler,
): Promise<void> {
	if (previousKeys) {
		let previousKeyCount = 0;
		for (const lookupKey of previousKeys.keys()) {
			if (nextKeys?.has(lookupKey)) {
				continue;
			}
			const sources = index.get(lookupKey);
			if (!sources) {
				continue;
			}
			sources.delete(sourcePath);
			if (sources.size === 0) {
				index.delete(lookupKey);
			}

			previousKeyCount++;
			const pendingYield = maybeYield(
				yieldScheduler,
				previousKeyCount,
				HEAVY_YIELD_CHECK_INTERVAL,
			);
			if (pendingYield) {
				await pendingYield;
			}
		}
	}

	if (!nextKeys) {
		return;
	}

	let nextKeyCount = 0;
	for (const lookupKey of nextKeys.keys()) {
		if (previousKeys?.has(lookupKey)) {
			continue;
		}
		let sources = index.get(lookupKey);
		if (!sources) {
			sources = new Set<string>();
			index.set(lookupKey, sources);
		}
		sources.add(sourcePath);

		nextKeyCount++;
		const pendingYield = maybeYield(
			yieldScheduler,
			nextKeyCount,
			HEAVY_YIELD_CHECK_INTERVAL,
		);
		if (pendingYield) {
			await pendingYield;
		}
	}
}
