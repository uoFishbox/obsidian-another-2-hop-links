import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import type { TwoHopLinkResult } from "types/domain";
import { freezeTwoHopLinkResult } from "./immutableTwoHopLinkResult";

const MAX_RESOLVE_CACHE_SIZE = 64;

interface ResolverPerformanceSettings {
	enableProgressiveTwoHopBuild: boolean;
	maxOutgoingToProcess: number;
	maxHop2PerBranch: number;
}

interface ResolverResolveSettings {
	includeTaggedNotes: boolean;
}

export interface CachedResolveResult {
	indexVersionAtBuild: number;
	enableProgressiveTwoHopBuild: boolean;
	maxOutgoingToProcess: number;
	maxHop2PerBranch: number;
	includeTaggedNotes: boolean;
	dependencyPaths: ReadonlySet<string>;
	dependencyLookupKeys: ReadonlySet<string>;
	dependencyTags: ReadonlySet<string>;
	result: TwoHopLinkResult;
}

/**
 * TwoHopLinkResolver の結果キャッシュを管理するクラス
 * - キャッシュの保存・取得
 * - データ更新に基づくキャッシュの無効化
 */
export class ResolverCache {
	private readonly cache = new Map<string, CachedResolveResult>();

	constructor(private readonly maxCacheSize: number = MAX_RESOLVE_CACHE_SIZE) {}

	/**
	 * キャッシュから結果を取得する
	 * @returns キャッシュが有効な場合は結果、無効な場合は undefined
	 */
	get(
		filePath: string,
		performanceSettings: ResolverPerformanceSettings,
		resolveSettings: ResolverResolveSettings,
	): TwoHopLinkResult | undefined {
		const cached = this.cache.get(filePath);
		if (!cached) {
			return undefined;
		}

		// パフォーマンス設定が変更されている場合はキャッシュ無効
		if (
			cached.enableProgressiveTwoHopBuild !==
				performanceSettings.enableProgressiveTwoHopBuild ||
			cached.maxOutgoingToProcess !== performanceSettings.maxOutgoingToProcess ||
			cached.maxHop2PerBranch !== performanceSettings.maxHop2PerBranch ||
			cached.includeTaggedNotes !== resolveSettings.includeTaggedNotes
		) {
			return undefined;
		}

		return cached.result;
	}

	/**
	 * 結果をキャッシュに保存する
	 */
	set(
		filePath: string,
		indexVersion: number,
		performanceSettings: ResolverPerformanceSettings,
		resolveSettings: ResolverResolveSettings,
		dependencies: {
			dependencyPaths: Set<string>;
			dependencyLookupKeys: Set<string>;
			dependencyTags: Set<string>;
		},
		result: TwoHopLinkResult,
	): void {
		this.cache.set(filePath, {
			indexVersionAtBuild: indexVersion,
			enableProgressiveTwoHopBuild:
				performanceSettings.enableProgressiveTwoHopBuild,
			maxOutgoingToProcess: performanceSettings.maxOutgoingToProcess,
			maxHop2PerBranch: performanceSettings.maxHop2PerBranch,
			includeTaggedNotes: resolveSettings.includeTaggedNotes,
			dependencyPaths: new Set(dependencies.dependencyPaths),
			dependencyLookupKeys: new Set(dependencies.dependencyLookupKeys),
			dependencyTags: new Set(dependencies.dependencyTags),
			result: freezeTwoHopLinkResult(result),
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
			if (
				this.intersects(cached.dependencyLookupKeys, affectedLookupKeySet) ||
				this.intersects(cached.dependencyPaths, affectedPathSet) ||
				this.intersects(cached.dependencyTags, affectedTagSet)
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

	/**
	 * キャッシュサイズを取得する（テスト用）
	 */
	private get size(): number {
		return this.cache.size;
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
