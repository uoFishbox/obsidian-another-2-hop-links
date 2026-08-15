import type {
	IMetricProvider,
	ISortService,
	SortableItem,
	SortKey,
	SortMetricKind,
	SortOption,
	SortResult,
} from "./types";
import { getSortPlan, type SortPlan } from "./comparators";

export class SortService implements ISortService {
	private memoizedMetricProvider: IMetricProvider;
	private readonly sortPlanCache = new Map<SortOption, SortPlan | undefined>();
	private readonly collator = new Intl.Collator(undefined, {
		numeric: true,
		sensitivity: "base",
	});

	constructor(private readonly metricProvider: IMetricProvider) {
		this.memoizedMetricProvider = this.createMemoizedMetricProvider();
	}

	sort<T extends SortableItem>(
		items: readonly T[],
		sortOption: SortOption,
	): readonly T[] {
		return this.sortItems(items, sortOption);
	}

	sortWithResult<T extends SortableItem>(
		items: readonly T[],
		sortOption: SortOption,
	): SortResult<T> {
		const sortedItems = this.sortItems(items, sortOption);
		return {
			items: sortedItems,
			orderChanged: sortedItems !== items,
		};
	}

	private sortItems<T extends SortableItem>(
		items: readonly T[],
		sortOption: SortOption,
	): readonly T[] {
		if (items.length <= 1) {
			return items;
		}

		const sortPlan = this.getSortPlan(sortOption);
		if (!sortPlan) {
			console.warn(`Unknown sort option: ${sortOption}, using default`);
			return items;
		}

		if (items.length === 2) {
			return this.sortPair(items, sortPlan);
		}

		return this.sortIndexed(items, sortPlan);
	}

	private sortPair<T extends SortableItem>(
		items: readonly T[],
		sortPlan: SortPlan,
	): readonly T[] {
		const left = items[0];
		const right = items[1];

		const primaryCompare = this.compareSortKeys(
			sortPlan.getPrimaryKey(left),
			sortPlan.getPrimaryKey(right),
		);
		const orderedPrimaryCompare =
			sortPlan.primaryOrder === "asc" ? primaryCompare : -primaryCompare;

		if (orderedPrimaryCompare < 0) {
			return items;
		}
		if (orderedPrimaryCompare > 0) {
			return [right, left];
		}

		if (sortPlan.getPrimaryKey !== sortPlan.getTieBreaker) {
			const tieBreakerCompare = this.collator.compare(
				sortPlan.getTieBreaker(left),
				sortPlan.getTieBreaker(right),
			);

			if (tieBreakerCompare > 0) {
				return [right, left];
			}
		}

		return items;
	}

	invalidateCache(): void {
		this.memoizedMetricProvider = this.createMemoizedMetricProvider();
		this.sortPlanCache.clear();
	}

	private getSortPlan(sortOption: SortOption): SortPlan | undefined {
		if (this.sortPlanCache.has(sortOption)) {
			return this.sortPlanCache.get(sortOption);
		}

		const sortPlan = getSortPlan(sortOption, this.memoizedMetricProvider);
		this.sortPlanCache.set(sortOption, sortPlan);
		return sortPlan;
	}

	private sortIndexed<T extends SortableItem>(
		items: readonly T[],
		sortPlan: SortPlan,
	): readonly T[] {
		const itemCount = items.length;
		const indices = new Array<number>(itemCount);
		const primaryKeys = new Array<SortKey>(itemCount);
		const hasTieBreaker = sortPlan.getPrimaryKey !== sortPlan.getTieBreaker;
		let tieBreakerKeys: Array<string | undefined> | undefined;

		for (let index = 0; index < itemCount; index += 1) {
			const item = items[index];
			indices[index] = index;
			primaryKeys[index] = sortPlan.getPrimaryKey(item);
		}

		indices.sort((leftIndex, rightIndex) => {
			const primaryCompare = this.compareSortKeys(
				primaryKeys[leftIndex],
				primaryKeys[rightIndex],
			);

			if (primaryCompare !== 0) {
				return sortPlan.primaryOrder === "asc"
					? primaryCompare
					: -primaryCompare;
			}

			if (hasTieBreaker) {
				tieBreakerKeys ??= new Array<string | undefined>(itemCount);

				let leftTieBreaker = tieBreakerKeys[leftIndex];
				if (leftTieBreaker === undefined) {
					leftTieBreaker = sortPlan.getTieBreaker(items[leftIndex]);
					tieBreakerKeys[leftIndex] = leftTieBreaker;
				}

				let rightTieBreaker = tieBreakerKeys[rightIndex];
				if (rightTieBreaker === undefined) {
					rightTieBreaker = sortPlan.getTieBreaker(items[rightIndex]);
					tieBreakerKeys[rightIndex] = rightTieBreaker;
				}

				const tieBreakerCompare =
					leftTieBreaker === rightTieBreaker
						? 0
						: this.collator.compare(leftTieBreaker, rightTieBreaker);

				if (tieBreakerCompare !== 0) {
					return tieBreakerCompare;
				}
			}

			return leftIndex - rightIndex;
		});

		for (let index = 0; index < itemCount; index += 1) {
			if (indices[index] !== index) {
				const sortedItems = new Array<T>(itemCount);

				for (let sortedIndex = 0; sortedIndex < itemCount; sortedIndex += 1) {
					sortedItems[sortedIndex] = items[indices[sortedIndex]];
				}

				return sortedItems;
			}
		}

		return items;
	}

	private compareSortKeys(a: SortKey, b: SortKey): number {
		if (a === b) {
			return 0;
		}

		if (typeof a === "string" && typeof b === "string") {
			return this.collator.compare(a, b);
		}

		if (a > b) {
			return 1;
		}
		if (a < b) {
			return -1;
		}
		return 0;
	}

	private createMemoizedMetricProvider(): IMetricProvider {
		const displayNameCache = new WeakMap<SortableItem, string>();
		const outgoingLinkCountCache = new WeakMap<SortableItem, number>();
		const createdTimeCache = new WeakMap<SortableItem, number>();
		const modifiedTimeCache = new WeakMap<SortableItem, number>();
		const backlinkCountCache = new WeakMap<SortableItem, number>();
		const fileSizeCache = new WeakMap<SortableItem, number>();

		const memoize = <T extends string | number>(
			metricKind: SortMetricKind,
			cache: WeakMap<SortableItem, T>,
			getValue: (item: SortableItem) => T,
		) => {
			const sharedMetricCache = new WeakMap<object, T>();

			return (item: SortableItem): T => {
				const cached = cache.get(item);
				if (cached !== undefined) {
					return cached;
				}

				const cacheIdentity = this.metricProvider.getMetricCacheIdentity?.(
					metricKind,
					item,
				);
				const sharedCached =
					cacheIdentity === undefined
						? undefined
						: sharedMetricCache.get(cacheIdentity);
				if (sharedCached !== undefined) {
					cache.set(item, sharedCached);
					return sharedCached;
				}

				const value = getValue(item);
				cache.set(item, value);
				if (cacheIdentity !== undefined) {
					sharedMetricCache.set(cacheIdentity, value);
				}
				return value;
			};
		};

		return {
			getDisplayName: memoize("displayName", displayNameCache, (item) =>
				this.metricProvider.getDisplayName(item),
			),
			getOutgoingLinkCount: memoize(
				"outgoingLinkCount",
				outgoingLinkCountCache,
				(item) => this.metricProvider.getOutgoingLinkCount(item),
			),
			getCreatedTime: memoize("createdTime", createdTimeCache, (item) =>
				this.metricProvider.getCreatedTime(item),
			),
			getModifiedTime: memoize("modifiedTime", modifiedTimeCache, (item) =>
				this.metricProvider.getModifiedTime(item),
			),
			getBacklinkCount: memoize("backlinkCount", backlinkCountCache, (item) =>
				this.metricProvider.getBacklinkCount(item),
			),
			getFileSize: memoize("fileSize", fileSizeCache, (item) =>
				this.metricProvider.getFileSize(item),
			),
		};
	}
}
