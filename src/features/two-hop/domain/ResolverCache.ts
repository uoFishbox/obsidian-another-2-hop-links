import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import type { TwoHopResolveSnapshot } from "./ResolverDependencies";
import type { ResolverPerformanceSettings } from "./ResolverDependencies";

const MAX_RESOLVE_CACHE_SIZE = 64;

interface ResolverResolveSettings {
	includeTaggedNotes: boolean;
}

interface CachedResolveResult {
	enableProgressiveTwoHopBuild: boolean;
	maxOutgoingToProcess: number;
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
		performanceSettings: ResolverPerformanceSettings,
		resolveSettings: ResolverResolveSettings,
	): TwoHopResolveSnapshot | undefined {
		const cached = this.cache.get(filePath);
		if (!cached) {
			return undefined;
		}

		// パフォーマンス設定が変更されている場合はキャッシュ無効
		if (
			cached.enableProgressiveTwoHopBuild !==
				performanceSettings.enableProgressiveTwoHopBuild ||
			cached.maxOutgoingToProcess !== performanceSettings.maxOutgoingToProcess ||
			cached.includeTaggedNotes !== resolveSettings.includeTaggedNotes
		) {
			return undefined;
		}

		return cached.snapshot;
	}

	/**
	 * 結果をキャッシュに保存する
	 */
	set(
		filePath: string,
		performanceSettings: ResolverPerformanceSettings,
		resolveSettings: ResolverResolveSettings,
		snapshot: TwoHopResolveSnapshot,
	): void {
		this.cache.set(filePath, {
			enableProgressiveTwoHopBuild:
				performanceSettings.enableProgressiveTwoHopBuild,
			maxOutgoingToProcess: performanceSettings.maxOutgoingToProcess,
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
			context.affectedPaths && context.affectedPaths.length > 0
				? new Set(context.affectedPaths)
				: undefined;
		const affectedLookupKeySet =
			context.affectedLookupKeys && context.affectedLookupKeys.length > 0
				? new Set(context.affectedLookupKeys)
				: undefined;
		const affectedTagSet =
			context.affectedTags && context.affectedTags.length > 0
				? new Set(context.affectedTags)
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
