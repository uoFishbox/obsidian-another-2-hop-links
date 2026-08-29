import {
	dataUpdateCollectionSize,
	toDataUpdateSet,
	type DataUpdateContext,
} from "indexing/index-service/IndexEvents";
import type { TwoHopResolveSnapshot } from "./ResolverDependencies";

const MAX_RESOLVE_CACHE_SIZE = 64;

interface ResolverResolveSettings {
	includeTaggedNotes: boolean;
}

interface CachedResolveResult {
	includeTaggedNotes: boolean;
	snapshot: TwoHopResolveSnapshot;
}

/**
 * TwoHopLinkResolver の結果キャッシュを管理するクラス
 * - キャッシュの保存・取得
 * - データ更新に基づくキャッシュの無効化
 */
export class ResolverCache {
	private readonly cache = new Map<string, CachedResolveResult>();

	constructor(private readonly maxCacheSize: number = MAX_RESOLVE_CACHE_SIZE) {}

	getSnapshot(
		filePath: string,
		resolveSettings: ResolverResolveSettings,
	): TwoHopResolveSnapshot | undefined {
		const cached = this.cache.get(filePath);
		if (!cached) {
			return undefined;
		}

		if (cached.includeTaggedNotes !== resolveSettings.includeTaggedNotes) {
			return undefined;
		}

		return cached.snapshot;
	}

	/**
	 * 結果をキャッシュに保存する
	 */
	set(
		filePath: string,
		resolveSettings: ResolverResolveSettings,
		snapshot: TwoHopResolveSnapshot,
	): void {
		this.cache.set(filePath, {
			includeTaggedNotes: resolveSettings.includeTaggedNotes,
			snapshot,
		});

		// キャッシュサイズ制限を超えた場合、最も古いエントリを削除
		if (this.cache.size > this.maxCacheSize) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey) {
				this.cache.delete(oldestKey);
			}
		}
	}

	/**
	 * データ更新に基づいてキャッシュを無効化する
	 */
	invalidate(context?: DataUpdateContext): void {
		if (!context || context.affectsAll) {
			this.cache.clear();
			return;
		}

		const affectedPathSet =
			dataUpdateCollectionSize(context.affectedPaths) > 0
				? toDataUpdateSet(context.affectedPaths)
				: undefined;
		const affectedLookupKeySet =
			dataUpdateCollectionSize(context.affectedLookupKeys) > 0
				? toDataUpdateSet(context.affectedLookupKeys)
				: undefined;
		const affectedTagSet =
			dataUpdateCollectionSize(context.affectedTags) > 0
				? toDataUpdateSet(context.affectedTags)
				: undefined;

		if (!affectedPathSet && !affectedLookupKeySet && !affectedTagSet) {
			this.cache.clear();
			return;
		}

		for (const [filePath, cached] of this.cache.entries()) {
			const dependencies = cached.snapshot.dependencies;
			if (
				this.intersects(
					dependencies.relevantLookupKeys,
					affectedLookupKeySet,
				) ||
				this.intersects(dependencies.relevantPaths, affectedPathSet) ||
				this.intersects(dependencies.relevantTags, affectedTagSet)
			) {
				this.cache.delete(filePath);
			}
		}
	}

	/**
	 * すべてのキャッシュをクリアする
	 */
	clear(): void {
		this.cache.clear();
	}

	private intersects(
		cachedValues: ReadonlySet<string>,
		affectedValues: ReadonlySet<string> | undefined,
	): boolean {
		if (!affectedValues || cachedValues.size === 0 || affectedValues.size === 0) {
			return false;
		}
		// 小さい方のセットをイテレートして効率化
		let smaller = cachedValues;
		let larger = affectedValues;
		if (affectedValues.size < cachedValues.size) {
			smaller = affectedValues;
			larger = cachedValues;
		}
		for (const value of smaller) {
			if (larger.has(value)) {
				return true;
			}
		}
		return false;
	}
}
