import {
	computeInitialVisibleCount,
	normalizeIncrement,
} from "cards/components/listPagination";

export interface SectionPaginationApplicationStore {
	getDefaultSectionVisibleLimit?(): number;
	getSectionExpandedLimit?(sectionId: string): number | undefined;
	setSectionExpandedLimit?(sectionId: string, limit: number): void;
}

export interface SectionPaginationState {
	getVisibleCount(sectionId: string, totalLoadedCount: number): number;
	loadMore(sectionId: string, loadedCount: number): void;
}

export interface CreateSectionPaginationStateParams {
	getExpandedLimits(): Readonly<Record<string, number>>;
	setExpandedLimits(expandedLimits: Record<string, number>): void;
	applicationStore?: SectionPaginationApplicationStore;
	initialVisibleCount?: number;
	loadMoreIncrement?: number;
}

const normalizeStoredVisibleCount = (count: number): number => {
	const floored = Math.floor(count);
	return Number.isFinite(floored) ? Math.max(0, floored) : 0;
};

export function createSectionPaginationState({
	getExpandedLimits,
	setExpandedLimits,
	applicationStore,
	initialVisibleCount,
	loadMoreIncrement,
}: CreateSectionPaginationStateParams): SectionPaginationState {
	const resolveDefaultVisibleLimit = (
		sectionId: string,
		totalLoadedCount: number,
	): number => {
		if (typeof applicationStore?.getDefaultSectionVisibleLimit === "function") {
			return applicationStore.getDefaultSectionVisibleLimit();
		}

		return computeInitialVisibleCount(totalLoadedCount, initialVisibleCount);
	};

	const getExpandedLimit = (sectionId: string): number | undefined => {
		const localExpandedLimit = getExpandedLimits()[sectionId];
		if (localExpandedLimit !== undefined) {
			return localExpandedLimit;
		}

		if (typeof applicationStore?.getSectionExpandedLimit === "function") {
			return applicationStore.getSectionExpandedLimit(sectionId);
		}

		return getExpandedLimits()[sectionId];
	};

	const getVisibleCount = (sectionId: string, totalLoadedCount: number): number => {
		const defaultLimit = resolveDefaultVisibleLimit(sectionId, totalLoadedCount);
		const expandedLimit = getExpandedLimit(sectionId) ?? 0;
		return Math.min(
			totalLoadedCount,
			Math.max(
				normalizeStoredVisibleCount(defaultLimit),
				normalizeStoredVisibleCount(expandedLimit),
			),
		);
	};

	const setExpandedLimit = (sectionId: string, limit: number): void => {
		const nextLimit = normalizeStoredVisibleCount(limit);
		setExpandedLimits({
			...getExpandedLimits(),
			[sectionId]: nextLimit,
		});
		if (typeof applicationStore?.setSectionExpandedLimit === "function") {
			applicationStore.setSectionExpandedLimit(sectionId, nextLimit);
		}
	};

	return {
		getVisibleCount,
		loadMore(sectionId, loadedCount) {
			const visibleCount = getVisibleCount(sectionId, loadedCount);
			if (visibleCount >= loadedCount) {
				return;
			}

			const increment = normalizeIncrement(loadMoreIncrement);
			const nextCount =
				increment === Number.POSITIVE_INFINITY
					? loadedCount
					: Math.min(loadedCount, visibleCount + increment);
			setExpandedLimit(
				sectionId,
				Math.max(getExpandedLimit(sectionId) ?? 0, nextCount),
			);
		},
	};
}
