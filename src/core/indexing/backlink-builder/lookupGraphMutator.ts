import { toCaseInsensitiveLookupKey } from "../link-resolution/linkResolution";
import type { BacklinkSourceMap } from "types/domain";
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
	await syncLookupIndexForSourceAsync(
		snapshot.unresolvedLinkLookupToSources,
		sourcePath,
		previousSummary?.unresolvedLookupKeys,
		nextSummary?.unresolvedLookupKeys,
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
	sourcePath: string,
	isNewSource: boolean,
	hadResolved: boolean,
	hasResolved: boolean,
	affectedLookupKeys: Set<string>,
	touchedLookupKeys: Set<string>,
): void {
	affectedLookupKeys.add(lookupKey);
	touchedLookupKeys.add(lookupKey);
	ensureLookupPathRegistered(snapshot, lookupPath, lookupKey);

	if (isNewSource) {
		let sources = snapshot.lookupKeyToSources.get(lookupKey);
		if (!sources) {
			sources = new Set<string>();
			snapshot.lookupKeyToSources.set(lookupKey, sources);
		}
		sources.add(sourcePath);
	}

	if (!hadResolved && hasResolved) {
		const resolvedSourceCount =
			(snapshot.lookupPathResolvedSourceCount.get(lookupPath) ?? 0) + 1;
		snapshot.lookupPathResolvedSourceCount.set(lookupPath, resolvedSourceCount);

		if (resolvedSourceCount === 1) {
			const directResolvedPathCount =
				(snapshot.lookupKeyDirectResolvedPathCount.get(lookupKey) ?? 0) + 1;
			snapshot.lookupKeyDirectResolvedPathCount.set(
				lookupKey,
				directResolvedPathCount,
			);
		}
	}
}

export function onRemoveSourceFromLookupPath(
	snapshot: IndexSnapshot,
	lookupPath: string,
	lookupKey: string,
	_sourcePath: string,
	hadResolved: boolean,
	isLookupPathEmptyAfter: boolean,
	affectedLookupKeys: Set<string>,
	touchedLookupKeys: Set<string>,
): void {
	affectedLookupKeys.add(lookupKey);
	touchedLookupKeys.add(lookupKey);

	if (hadResolved) {
		const nextResolvedSourceCount =
			(snapshot.lookupPathResolvedSourceCount.get(lookupPath) ?? 1) - 1;

		if (nextResolvedSourceCount <= 0) {
			snapshot.lookupPathResolvedSourceCount.delete(lookupPath);
			const nextDirectResolvedPathCount =
				(snapshot.lookupKeyDirectResolvedPathCount.get(lookupKey) ?? 1) - 1;
			if (nextDirectResolvedPathCount <= 0) {
				snapshot.lookupKeyDirectResolvedPathCount.delete(lookupKey);
			} else {
				snapshot.lookupKeyDirectResolvedPathCount.set(
					lookupKey,
					nextDirectResolvedPathCount,
				);
			}
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

export async function removeLookupPathAsync(
	snapshot: IndexSnapshot,
	lookupPath: string,
	sourceMap: BacklinkSourceMap,
	affectedLookupKeys: Set<string>,
	touchedLookupKeys: Set<string>,
	yieldScheduler: YieldScheduler,
): Promise<void> {
	const lookupKey = toCaseInsensitiveLookupKey(lookupPath);
	affectedLookupKeys.add(lookupKey);
	touchedLookupKeys.add(lookupKey);

	let sourceCount = 0;
	for (const sourcePath of sourceMap.keys()) {
		const sources = snapshot.lookupKeyToSources.get(lookupKey);
		sources?.delete(sourcePath);

		sourceCount++;
		const pendingYield = maybeYield(
			yieldScheduler,
			sourceCount,
			HEAVY_YIELD_CHECK_INTERVAL,
		);
		if (pendingYield) {
			await pendingYield;
		}
	}

	const resolvedSourceCount =
		snapshot.lookupPathResolvedSourceCount.get(lookupPath) ?? 0;
	if (resolvedSourceCount > 0) {
		snapshot.lookupPathResolvedSourceCount.delete(lookupPath);
		const nextDirectResolvedPathCount =
			(snapshot.lookupKeyDirectResolvedPathCount.get(lookupKey) ?? 1) - 1;
		if (nextDirectResolvedPathCount <= 0) {
			snapshot.lookupKeyDirectResolvedPathCount.delete(lookupKey);
		} else {
			snapshot.lookupKeyDirectResolvedPathCount.set(
				lookupKey,
				nextDirectResolvedPathCount,
			);
		}
	}

	removeLookupPathRegistration(snapshot, lookupPath, lookupKey);
}

export async function refreshUnresolvedLookupForKeyAsync(
	snapshot: IndexSnapshot,
	lookupKey: string,
	yieldScheduler: YieldScheduler,
): Promise<void> {
	const lookupPaths = snapshot.lookupKeyToLookupPaths.get(lookupKey);
	if (!lookupPaths || lookupPaths.size === 0) {
		snapshot.lookupKeyToSources.delete(lookupKey);
		snapshot.unresolvedLookupToSources.delete(lookupKey);
		return;
	}

	const sources = snapshot.lookupKeyToSources.get(lookupKey) ?? new Set<string>();
	sources.clear();

	await collectLookupKeySourcesAsync(snapshot, lookupPaths, sources, yieldScheduler);
	if (sources.size === 0) {
		snapshot.lookupKeyToSources.delete(lookupKey);
		snapshot.unresolvedLookupToSources.delete(lookupKey);
		return;
	}

	snapshot.lookupKeyToSources.set(lookupKey, sources);
	if ((snapshot.lookupKeyDirectResolvedPathCount.get(lookupKey) ?? 0) > 0) {
		snapshot.unresolvedLookupToSources.delete(lookupKey);
		return;
	}

	snapshot.unresolvedLookupToSources.set(lookupKey, sources);
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

async function collectLookupKeySourcesAsync(
	snapshot: IndexSnapshot,
	lookupPaths: ReadonlySet<string>,
	sources: Set<string>,
	yieldScheduler: YieldScheduler,
): Promise<void> {
	let sourceCount = 0;
	for (const lookupPath of lookupPaths) {
		const sourceMap = snapshot.backlinksMap.get(lookupPath);
		if (!sourceMap) {
			continue;
		}
		for (const sourcePath of sourceMap.keys()) {
			sources.add(sourcePath);

			sourceCount++;
			const pendingYield = maybeYield(
				yieldScheduler,
				sourceCount,
				HEAVY_YIELD_CHECK_INTERVAL,
			);
			if (pendingYield) {
				await pendingYield;
			}
		}
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
