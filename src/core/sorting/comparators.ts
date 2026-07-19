import type { SortOption } from "features/settings/model";
import type { SortableItem, Comparator, SortKey } from "./types";
import type { IMetricProvider } from "types/services";

const collator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

export interface SortPlan {
	getPrimaryKey(item: SortableItem): SortKey;
	getTieBreaker(item: SortableItem): string;
	primaryOrder: "asc" | "desc";
}

const getDisplayName = (metricProvider: IMetricProvider, item: SortableItem): string =>
	metricProvider.getDisplayName(item);

const createDateKeyGetter = (
	order: "asc" | "desc",
	getter: (item: SortableItem) => number,
): ((item: SortableItem) => number) => {
	const missingDateKey =
		order === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;

	return (item) => {
		const time = getter(item);
		return time === 0 ? missingDateKey : time;
	};
};

export const getSortPlan = (
	sortOption: SortOption,
	metricProvider: IMetricProvider,
): SortPlan | undefined => {
	const displayNameTieBreaker = (item: SortableItem): string =>
		getDisplayName(metricProvider, item);

	switch (sortOption) {
		case "alphabetical":
			return {
				getPrimaryKey: displayNameTieBreaker,
				getTieBreaker: displayNameTieBreaker,
				primaryOrder: "asc",
			};
		case "alphabetical-reverse":
			return {
				getPrimaryKey: displayNameTieBreaker,
				getTieBreaker: displayNameTieBreaker,
				primaryOrder: "desc",
			};
		case "created-date":
			return {
				getPrimaryKey: createDateKeyGetter("asc", (item) =>
					metricProvider.getCreatedTime(item),
				),
				getTieBreaker: displayNameTieBreaker,
				primaryOrder: "asc",
			};
		case "created-date-reverse":
			return {
				getPrimaryKey: createDateKeyGetter("desc", (item) =>
					metricProvider.getCreatedTime(item),
				),
				getTieBreaker: displayNameTieBreaker,
				primaryOrder: "desc",
			};
		case "modified-date":
			return {
				getPrimaryKey: createDateKeyGetter("asc", (item) =>
					metricProvider.getModifiedTime(item),
				),
				getTieBreaker: displayNameTieBreaker,
				primaryOrder: "asc",
			};
		case "modified-date-reverse":
			return {
				getPrimaryKey: createDateKeyGetter("desc", (item) =>
					metricProvider.getModifiedTime(item),
				),
				getTieBreaker: displayNameTieBreaker,
				primaryOrder: "desc",
			};
		case "backlink-count":
			return {
				getPrimaryKey: (item) => metricProvider.getBacklinkCount(item),
				getTieBreaker: displayNameTieBreaker,
				primaryOrder: "asc",
			};
		case "backlink-count-reverse":
			return {
				getPrimaryKey: (item) => metricProvider.getBacklinkCount(item),
				getTieBreaker: displayNameTieBreaker,
				primaryOrder: "desc",
			};
		case "file-size":
			return {
				getPrimaryKey: (item) => metricProvider.getFileSize(item),
				getTieBreaker: displayNameTieBreaker,
				primaryOrder: "asc",
			};
		case "file-size-reverse":
			return {
				getPrimaryKey: (item) => metricProvider.getFileSize(item),
				getTieBreaker: displayNameTieBreaker,
				primaryOrder: "desc",
			};
		default:
			return undefined;
	}
};

export const getComparator = (
	sortOption: SortOption,
	metricProvider: IMetricProvider,
): Comparator | undefined => {
	const sortPlan = getSortPlan(sortOption, metricProvider);
	if (!sortPlan) {
		return undefined;
	}

	const primaryDirection = sortPlan.primaryOrder === "asc" ? 1 : -1;
	return (a, b) => {
		const primaryA = sortPlan.getPrimaryKey(a);
		const primaryB = sortPlan.getPrimaryKey(b);
		const primaryCompare =
			typeof primaryA === "string" && typeof primaryB === "string"
				? collator.compare(primaryA, primaryB)
				: primaryA > primaryB
					? 1
					: primaryA < primaryB
						? -1
						: 0;

		if (primaryCompare !== 0) {
			return primaryCompare * primaryDirection;
		}

		return collator.compare(sortPlan.getTieBreaker(a), sortPlan.getTieBreaker(b));
	};
};
