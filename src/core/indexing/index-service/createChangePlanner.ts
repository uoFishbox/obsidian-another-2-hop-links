import { getLinkpath } from "obsidian";
import { forEachLinkReferenceUnordered } from "../metadata/metadataExtractor";
import { resolveFileByPath } from "shared/obsidian/resolveFileByPath";
import {
	normalizeLinkToMarkdownPath,
	toCaseInsensitiveLookupKey,
} from "../link-resolution/linkResolution";
import type { CachedMetadataWithLinkReferences } from "types/domain";
import type { IMetadataCache, IVault } from "types/obsidian";
import type { IndexSnapshot } from "../types/IndexTypes";
import {
	HEAVY_YIELD_CHECK_INTERVAL,
	maybeYield,
	type YieldScheduler,
} from "../timeSlicing";

const EMPTY_SOURCE_LOOKUP_KEY_TO_RAW_LINK_PATHS: ReadonlyMap<
	string,
	string | readonly string[]
> = new Map();

export interface CreateEventEvaluationCache {
	sourceLookupKeyToRawLinkPaths: Map<
		string,
		ReadonlyMap<string, string | readonly string[]>
	>;
	resolvedDestinations: Map<string, Map<string, string | null>>;
}

export function createCreateEventEvaluationCache(): CreateEventEvaluationCache {
	return {
		sourceLookupKeyToRawLinkPaths: new Map(),
		resolvedDestinations: new Map(),
	};
}

export interface CreateChangePlanner {
	collectPathsForCreateEventAsync(
		snapshot: IndexSnapshot,
		newFilePath: string,
		pathsToUpdate: Set<string>,
		createEventEvaluationCache: CreateEventEvaluationCache,
		yieldScheduler: YieldScheduler,
		options?: { includeCreatedPath?: boolean },
	): Promise<void>;
	sourceHasLinkResolvingToCreatedFileAsync(
		snapshot: IndexSnapshot,
		sourcePath: string,
		newFilePath: string,
		candidateLookupKeys: Iterable<string>,
		createEventEvaluationCache: CreateEventEvaluationCache,
		yieldScheduler: YieldScheduler,
	): Promise<boolean>;
}

export function createCreateChangePlanner(
	vault: IVault,
	metadataCache: IMetadataCache,
): CreateChangePlanner {
	async function collectPathsForCreateEventAsync(
		snapshot: IndexSnapshot,
		newFilePath: string,
		pathsToUpdate: Set<string>,
		createEventEvaluationCache: CreateEventEvaluationCache,
		yieldScheduler: YieldScheduler,
		options: { includeCreatedPath?: boolean } = {},
	): Promise<void> {
		if (options.includeCreatedPath ?? true) {
			pathsToUpdate.add(newFilePath);
		}

		const candidates = generateCandidateLookupPaths(newFilePath);

		let evaluatedSources: Set<string> | undefined;
		let sourceCount = 0;
		for (const candidate of candidates) {
			const sources = snapshot.linkLookupToSources.get(candidate);
			if (!sources) {
				continue;
			}
			for (const sourcePath of sources) {
				if (!pathsToUpdate.has(sourcePath)) {
					const sourceSummary = snapshot.sourceSummaries.get(sourcePath);
					if (sourceSummary?.unresolvedLookupKeys.has(candidate)) {
						pathsToUpdate.add(sourcePath);
					} else if (!evaluatedSources?.has(sourcePath)) {
						(evaluatedSources ??= new Set<string>()).add(sourcePath);

						if (
							await sourceHasLinkResolvingToCreatedFileAsync(
								snapshot,
								sourcePath,
								newFilePath,
								candidates,
								createEventEvaluationCache,
								yieldScheduler,
							)
						) {
							pathsToUpdate.add(sourcePath);
						}
					}
				}

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

	async function sourceHasLinkResolvingToCreatedFileAsync(
		snapshot: IndexSnapshot,
		sourcePath: string,
		newFilePath: string,
		candidateLookupKeys: Iterable<string>,
		createEventEvaluationCache: CreateEventEvaluationCache,
		yieldScheduler: YieldScheduler,
	): Promise<boolean> {
		const normalizedNewFilePathKey = toCaseInsensitiveLookupKey(newFilePath);
		const lookupKeyToRawLinkPaths = getSourceLookupKeyToRawLinkPathsForCreateEvent(
			snapshot,
			sourcePath,
			createEventEvaluationCache,
		);
		if (lookupKeyToRawLinkPaths.size === 0) {
			return false;
		}

		let rawLinkPathCount = 0;
		let found = false;
		for (const lookupKey of candidateLookupKeys) {
			const rawLinkPaths = lookupKeyToRawLinkPaths.get(lookupKey);
			if (!rawLinkPaths) {
				continue;
			}

			if (typeof rawLinkPaths === "string") {
				found = rawLinkPathResolvesToCreatedFile(
					sourcePath,
					rawLinkPaths,
					normalizedNewFilePathKey,
					createEventEvaluationCache,
				);
			} else {
				for (const rawLinkPath of rawLinkPaths) {
					if (
						rawLinkPathResolvesToCreatedFile(
							sourcePath,
							rawLinkPath,
							normalizedNewFilePathKey,
							createEventEvaluationCache,
						)
					) {
						found = true;
						break;
					}
				}
			}

			if (found) return true;

			rawLinkPathCount++;
			const pendingYield = maybeYield(yieldScheduler, rawLinkPathCount, 16);
			if (pendingYield) {
				await pendingYield;
			}
		}

		return false;
	}

	function rawLinkPathResolvesToCreatedFile(
		sourcePath: string,
		rawLinkPath: string,
		normalizedNewFilePathKey: string,
		createEventEvaluationCache: CreateEventEvaluationCache,
	): boolean {
		const resolvedPath = getResolvedDestinationPathForCreateEvent(
			sourcePath,
			rawLinkPath,
			createEventEvaluationCache,
		);
		return (
			resolvedPath !== null &&
			toCaseInsensitiveLookupKey(resolvedPath) === normalizedNewFilePathKey
		);
	}

	function getSourceLookupKeyToRawLinkPathsForCreateEvent(
		snapshot: IndexSnapshot,
		sourcePath: string,
		createEventEvaluationCache: CreateEventEvaluationCache,
	): ReadonlyMap<string, string | readonly string[]> {
		const cached =
			createEventEvaluationCache.sourceLookupKeyToRawLinkPaths.get(sourcePath);
		if (cached) {
			return cached;
		}

		const summary = snapshot.sourceSummaries.get(sourcePath);
		if (summary) {
			createEventEvaluationCache.sourceLookupKeyToRawLinkPaths.set(
				sourcePath,
				summary.lookupKeyToRawLinkPaths,
			);
			return summary.lookupKeyToRawLinkPaths;
		}

		const sourceFile = resolveFileByPath(vault, sourcePath);
		if (!sourceFile) {
			createEventEvaluationCache.sourceLookupKeyToRawLinkPaths.set(
				sourcePath,
				EMPTY_SOURCE_LOOKUP_KEY_TO_RAW_LINK_PATHS,
			);
			return EMPTY_SOURCE_LOOKUP_KEY_TO_RAW_LINK_PATHS;
		}

		const cache = metadataCache.getFileCache(
			sourceFile,
		) as CachedMetadataWithLinkReferences | null;
		const lookupKeyToRawLinkPaths = new Map<string, string | string[]>();
		forEachLinkReferenceUnordered(cache, (linkReference) => {
			const lookupKey = toCaseInsensitiveLookupKey(
				normalizeLinkToMarkdownPath(linkReference.link),
			);
			const rawLinkPath = getLinkpath(linkReference.link);
			const existing = lookupKeyToRawLinkPaths.get(lookupKey);
			if (existing === undefined) {
				lookupKeyToRawLinkPaths.set(lookupKey, rawLinkPath);
				return;
			}

			if (typeof existing === "string") {
				if (existing === rawLinkPath) return;
				lookupKeyToRawLinkPaths.set(lookupKey, [existing, rawLinkPath]);
				return;
			}

			if (!existing.includes(rawLinkPath)) {
				existing.push(rawLinkPath);
			}
		});
		createEventEvaluationCache.sourceLookupKeyToRawLinkPaths.set(
			sourcePath,
			lookupKeyToRawLinkPaths,
		);
		return lookupKeyToRawLinkPaths;
	}

	function getResolvedDestinationPathForCreateEvent(
		sourcePath: string,
		rawLinkPath: string,
		createEventEvaluationCache: CreateEventEvaluationCache,
	): string | null {
		const sourceDirectory = getParentDirectoryPath(sourcePath);
		let resolvedByRawLinkPath =
			createEventEvaluationCache.resolvedDestinations.get(sourceDirectory);
		if (!resolvedByRawLinkPath) {
			resolvedByRawLinkPath = new Map<string, string | null>();
			createEventEvaluationCache.resolvedDestinations.set(
				sourceDirectory,
				resolvedByRawLinkPath,
			);
		}
		if (resolvedByRawLinkPath.has(rawLinkPath)) {
			return resolvedByRawLinkPath.get(rawLinkPath)!;
		}

		const dest = metadataCache.getFirstLinkpathDest(rawLinkPath, sourcePath);
		const resolvedPath = dest?.path ?? null;
		resolvedByRawLinkPath.set(rawLinkPath, resolvedPath);
		return resolvedPath;
	}

	return {
		collectPathsForCreateEventAsync,
		sourceHasLinkResolvingToCreatedFileAsync,
	};
}

function generateCandidateLookupPaths(filePath: string): string[] {
	const normalized = toCaseInsensitiveLookupKey(filePath);
	const candidates: string[] = [];

	let searchFrom = 0;
	while (true) {
		const suffix = normalized.slice(searchFrom);
		candidates.push(suffix);

		const nextSlash = normalized.indexOf("/", searchFrom);
		if (nextSlash === -1) {
			break;
		}
		searchFrom = nextSlash + 1;
	}

	return candidates;
}

function getParentDirectoryPath(path: string): string {
	const lastSlashIndex = path.lastIndexOf("/");
	if (lastSlashIndex === -1) {
		return "";
	}

	return path.slice(0, lastSlashIndex);
}
