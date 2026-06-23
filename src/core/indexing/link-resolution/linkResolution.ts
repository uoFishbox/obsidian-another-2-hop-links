import { getLinkpath, normalizePath } from "obsidian";
import type { TFile } from "obsidian";
import type { LinkReference, LinkResolution } from "types/domain";
import type { TwoHopIndexedLink } from "types";
import type { IMetadataCache, IVault } from "types/obsidian";
import { LINK_NORMALIZATION_CACHE_MAX_ENTRIES } from "appConstants";
import {
	createBoundedGenerationalCache,
	type BoundedGenerationalCache,
} from "utils/boundedGenerationalCache";
import { hasSourceDependentRawLinkPath } from "./sourceDependentLinks";

// 拡張子チェック用正規表現（モジュールスコープで一度だけコンパイル）
const HAS_EXTENSION_RE = /\.[a-z0-9]+$/i;
// 高頻度で同じリンク文字列・パスが渡るため、正規化結果を使い回す。
// 無制限 Map だと削除済みファイルや過去のリンク文字列が old generation に
// 残留し major GC / retained heap に悪影響が出るため、上限付き2世代キャッシュ
// で保持量を制限する。正規化は安価なので LRU の per-call delete/set ではなく
// 世代到達時の一括切り替えで追い出す。
const CASE_INSENSITIVE_LOOKUP_KEY_CACHE: BoundedGenerationalCache<string, string> =
	createBoundedGenerationalCache(
		"caseInsensitiveLookupKey",
		LINK_NORMALIZATION_CACHE_MAX_ENTRIES,
	);
const RAW_LINKPATH_TO_MARKDOWN_PATH_CACHE: BoundedGenerationalCache<string, string> =
	createBoundedGenerationalCache(
		"rawLinkpathToMarkdownPath",
		LINK_NORMALIZATION_CACHE_MAX_ENTRIES,
	);
const LINK_TEXT_TO_MARKDOWN_PATH_CACHE: BoundedGenerationalCache<string, string> =
	createBoundedGenerationalCache(
		"linkTextToMarkdownPath",
		LINK_NORMALIZATION_CACHE_MAX_ENTRIES,
	);

/** Names of the bounded normalization caches, for stats grouping. */
export type LinkNormalizationCacheName =
	| "caseInsensitiveLookupKey"
	| "rawLinkpathToMarkdownPath"
	| "linkTextToMarkdownPath";

export interface LinkNormalizationCacheStats {
	name: LinkNormalizationCacheName;
	maxEntries: number;
	currentSize: number;
	previousSize: number;
	hits: number;
	misses: number;
	promotions: number;
	generations: number;
	clears: number;
}

const NORMALIZATION_CACHES = [
	CASE_INSENSITIVE_LOOKUP_KEY_CACHE,
	RAW_LINKPATH_TO_MARKDOWN_PATH_CACHE,
	LINK_TEXT_TO_MARKDOWN_PATH_CACHE,
] as const;

/**
 * Returns current stats for every normalization cache, for debug measurement.
 */
export function getLinkNormalizationCacheStats(): LinkNormalizationCacheStats[] {
	return NORMALIZATION_CACHES.map(
		(cache) => cache.getStats() as LinkNormalizationCacheStats,
	);
}

/**
 * Clears all link normalization caches. Intended for benchmarks to separate
 * cold-cache from warm-cache runs; not needed during normal operation because
 * the bounded generational caches self-trim.
 */
export function clearLinkNormalizationCaches(): void {
	for (const cache of NORMALIZATION_CACHES) {
		cache.clear();
	}
}

export interface ResolvedLinkInfo {
	destinationPath: string;
	rawLookupKey: string;
	isUnresolved: boolean;
	isAmbiguous: boolean;
	isSourceDependent: boolean;
}

export interface LinkResolutionAmbiguityDetector {
	isAmbiguous(rawLinkPath: string): boolean;
}

export interface MutableLinkResolutionAmbiguityDetector extends LinkResolutionAmbiguityDetector {
	addPath(path: string): void;
	removePath(path: string): void;
	renamePath(oldPath: string, newPath: string): void;
}

interface LinkResolutionAmbiguityIndex {
	fileNameCounts: Map<string, number>;
	baseNameCounts: Map<string, number>;
}

function incrementCachedCount(cache: Map<string, number>, key: string): void {
	cache.set(key, (cache.get(key) ?? 0) + 1);
}

function decrementCachedCount(cache: Map<string, number>, key: string): void {
	const current = cache.get(key);
	if (current === undefined) {
		return;
	}

	if (current <= 1) {
		cache.delete(key);
		return;
	}

	cache.set(key, current - 1);
}

function getPathBasename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

function getFileNameFromPath(path: string): string {
	const normalizedPath = normalizePath(path);
	return getPathBasename(normalizedPath);
}

function getBaseNameFromFileName(fileName: string): string {
	const dotIndex = fileName.lastIndexOf(".");
	if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
		return fileName;
	}

	return fileName.slice(0, dotIndex);
}

function isExplicitVaultPath(rawLinkPath: string): boolean {
	return rawLinkPath.includes("/") || rawLinkPath.includes("\\");
}

class MutableLinkResolutionAmbiguityDetectorImpl implements MutableLinkResolutionAmbiguityDetector {
	private readonly fileNameCounts = new Map<string, number>();
	private readonly baseNameCounts = new Map<string, number>();

	constructor(paths: Iterable<string>) {
		for (const path of paths) {
			this.addPath(path);
		}
	}

	public isAmbiguous(rawLinkPath: string): boolean {
		return computeIsAmbiguousRawLinkPath(rawLinkPath, {
			fileNameCounts: this.fileNameCounts,
			baseNameCounts: this.baseNameCounts,
		});
	}

	public addPath(path: string): void {
		const fileName = getFileNameFromPath(path);
		const baseName = getBaseNameFromFileName(fileName);
		incrementCachedCount(this.fileNameCounts, toCaseInsensitiveLookupKey(fileName));
		incrementCachedCount(this.baseNameCounts, toCaseInsensitiveLookupKey(baseName));
	}

	public removePath(path: string): void {
		const fileName = getFileNameFromPath(path);
		const baseName = getBaseNameFromFileName(fileName);
		decrementCachedCount(this.fileNameCounts, toCaseInsensitiveLookupKey(fileName));
		decrementCachedCount(this.baseNameCounts, toCaseInsensitiveLookupKey(baseName));
	}

	public renamePath(oldPath: string, newPath: string): void {
		this.removePath(oldPath);
		this.addPath(newPath);
	}
}

function computeIsAmbiguousRawLinkPath(
	rawLinkPath: string,
	index: LinkResolutionAmbiguityIndex,
): boolean {
	if (hasSourceDependentRawLinkPath(rawLinkPath)) {
		return true;
	}

	if (isExplicitVaultPath(rawLinkPath)) {
		return false;
	}

	const normalizedFileName = getPathBasename(normalizePath(rawLinkPath));
	if (normalizedFileName.length === 0) {
		return true;
	}

	const lookupKey = toCaseInsensitiveLookupKey(normalizedFileName);
	if (HAS_EXTENSION_RE.test(normalizedFileName)) {
		return (index.fileNameCounts.get(lookupKey) ?? 0) > 1;
	}

	return (index.baseNameCounts.get(lookupKey) ?? 0) > 1;
}

function* filePaths(files: readonly TFile[]): Iterable<string> {
	for (const file of files) {
		yield file.path;
	}
}

export function createLinkResolutionAmbiguityDetector(
	vault: IVault,
): MutableLinkResolutionAmbiguityDetector {
	return new MutableLinkResolutionAmbiguityDetectorImpl(filePaths(vault.getFiles()));
}

export function toCaseInsensitiveLookupKey(path: string): string {
	const cached = CASE_INSENSITIVE_LOOKUP_KEY_CACHE.get(path);
	if (cached !== undefined) {
		return cached;
	}

	// TFile.pathはすでに正規化済み。バックスラッシュがなければnormalizePath不要
	const normalized = path.indexOf("\\") === -1 ? path : normalizePath(path);
	const lookupKey = normalized.toLowerCase();
	CASE_INSENSITIVE_LOOKUP_KEY_CACHE.set(path, lookupKey);
	return lookupKey;
}

export function normalizeLinkToMarkdownPath(linkText: string): string {
	const cached = LINK_TEXT_TO_MARKDOWN_PATH_CACHE.get(linkText);
	if (cached !== undefined) {
		return cached;
	}

	const rawPath = getLinkpath(linkText);
	const markdownPath = normalizeRawLinkpathToMarkdownPath(rawPath);
	LINK_TEXT_TO_MARKDOWN_PATH_CACHE.set(linkText, markdownPath);
	return markdownPath;
}

export function stripLinkAnchor(linkText: string): string {
	const anchorIndex = linkText.indexOf("#");
	return anchorIndex >= 0 ? linkText.slice(0, anchorIndex) : linkText;
}

export function normalizeHrefToLookupPath(href: string): string {
	return normalizeLinkToMarkdownPath(stripLinkAnchor(href));
}

export function normalizeRawLinkpathToMarkdownPath(rawPath: string): string {
	const cached = RAW_LINKPATH_TO_MARKDOWN_PATH_CACHE.get(rawPath);
	if (cached !== undefined) {
		return cached;
	}

	const normalized = normalizePath(rawPath);
	const hasExtension = HAS_EXTENSION_RE.test(normalized);
	const markdownPath = hasExtension ? normalized : `${normalized}.md`;
	RAW_LINKPATH_TO_MARKDOWN_PATH_CACHE.set(rawPath, markdownPath);
	return markdownPath;
}

export function getLookupPathForLink(link: TwoHopIndexedLink): string {
	if (link.lookupPath) {
		return link.lookupPath;
	}
	if (link.path) {
		return link.path;
	}
	return normalizeLinkToMarkdownPath(link.rawText);
}

function createResolvedLinkInfo(
	rawLinkPath: string,
	destinationPath: string,
	rawLookupKey: string,
	isUnresolved: boolean,
	isAmbiguous: boolean,
): ResolvedLinkInfo {
	return {
		destinationPath,
		rawLookupKey,
		isUnresolved,
		isAmbiguous,
		isSourceDependent: hasSourceDependentRawLinkPath(rawLinkPath),
	};
}

export function resolveLinkDestination(
	metadataCache: IMetadataCache,
	link: LinkReference,
	sourcePath: string,
): LinkResolution {
	const rawLinkPath = getLinkpath(link.link);
	const dest = metadataCache.getFirstLinkpathDest(rawLinkPath, sourcePath);
	if (dest) {
		return {
			file: dest,
			lookupPath: dest.path,
			isUnresolved: false,
		};
	}

	return {
		file: null,
		lookupPath: normalizeRawLinkpathToMarkdownPath(rawLinkPath),
		isUnresolved: true,
	};
}

export function resolveLinkFromRawLinkPath(
	metadataCache: IMetadataCache,
	rawLinkPath: string,
	sourcePath: string,
	ambiguityDetector: LinkResolutionAmbiguityDetector,
): ResolvedLinkInfo {
	// Run-scoped reuse belongs to backlinkReferenceSequence. Keeping this
	// function stateless avoids retaining link history across index updates.
	const dest = metadataCache.getFirstLinkpathDest(rawLinkPath, sourcePath);
	const rawLookupPath = normalizeRawLinkpathToMarkdownPath(rawLinkPath);
	const rawLookupKey = toCaseInsensitiveLookupKey(rawLookupPath);
	const isAmbiguous = ambiguityDetector.isAmbiguous(rawLinkPath);

	if (dest) {
		const destinationPath = dest.path;
		return createResolvedLinkInfo(
			rawLinkPath,
			destinationPath,
			rawLookupKey,
			false,
			isAmbiguous,
		);
	}

	return createResolvedLinkInfo(
		rawLinkPath,
		rawLookupPath,
		rawLookupKey,
		true,
		isAmbiguous,
	);
}
