import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { SectionRenderDescriptor } from "../../sections/types";
import { computeInitialVisibleCount, normalizeIncrement } from "../listPagination";

export interface SectionPaginationState {
	getVisibleCount(sectionId: string, totalLoadedCount: number): number;
	setExpandedLimit(sectionId: string, limit: number): void;
	loadMore(sectionId: string, loadedCount: number): void;
	canLoadMore(sectionId: string, loadedCount: number): boolean;
	prune(sectionIds: ReadonlySet<string>): void;
}

export interface CreateSectionPaginationStateParams {
	getExpandedLimits(): Readonly<Record<string, number>>;
	setExpandedLimits(expandedLimits: Record<string, number>): void;
	applicationStore?: ApplicationStore;
	initialVisibleCount?: number;
	loadMoreIncrement?: number;
}

export interface SectionVisibleCountsSnapshot {
	readonly visibleCounts: Readonly<Record<string, number>>;
	readonly expandedLimits: Readonly<Record<string, number>>;
	readonly sectionIds: ReadonlySet<string>;
	readonly version: number;
}

export interface SectionVisibleCountsUpdate {
	readonly snapshot: SectionVisibleCountsSnapshot;
	readonly changed: boolean;
}

export interface SectionVisibleCountsController<T, G> {
	getSnapshot(): SectionVisibleCountsSnapshot;
	resolveForInput(
		sections: readonly SectionRenderDescriptor<T, G>[],
	): SectionVisibleCountsUpdate;
	resolveInitialSectionVisibleCount(section: SectionRenderDescriptor<T, G>): number;
	clampVisibleCount(section: SectionRenderDescriptor<T, G>, count: number): number;
	loadMore(sectionId: string, loadedCount: number): SectionVisibleCountsUpdate;
}

export interface CreateSectionVisibleCountsControllerParams {
	applicationStore?: ApplicationStore;
	initialVisibleCount?: number;
	loadMoreIncrement?: number;
}

const normalizeStoredVisibleCount = (count: number): number => {
	const floored = Math.floor(count);
	return Number.isFinite(floored) ? Math.max(0, floored) : 0;
};

const EMPTY_SECTION_VISIBLE_COUNTS_SNAPSHOT: SectionVisibleCountsSnapshot = {
	visibleCounts: {},
	expandedLimits: {},
	sectionIds: new Set(),
	version: 0,
};

export function getSectionPaginationKey<T, G>(
	section: SectionRenderDescriptor<T, G>,
): string {
	return section.paginationKey ?? section.sectionId;
}

const hasSameVisibleCounts = (
	current: Readonly<Record<string, number>>,
	next: Readonly<Record<string, number>>,
): boolean => {
	const currentKeys = Object.keys(current);
	const nextKeys = Object.keys(next);
	if (currentKeys.length !== nextKeys.length) {
		return false;
	}

	for (const key of currentKeys) {
		if (current[key] !== next[key]) {
			return false;
		}
	}

	return true;
};

const hasSameSectionIds = (
	current: ReadonlySet<string>,
	next: ReadonlySet<string>,
): boolean => {
	if (current.size !== next.size) {
		return false;
	}

	for (const sectionId of current) {
		if (!next.has(sectionId)) {
			return false;
		}
	}

	return true;
};

export function createSectionVisibleCountsController<T, G>({
	applicationStore,
	initialVisibleCount,
	loadMoreIncrement,
}: CreateSectionVisibleCountsControllerParams = {}): SectionVisibleCountsController<
	T,
	G
> {
	let snapshot = EMPTY_SECTION_VISIBLE_COUNTS_SNAPSHOT;
	let sourceExpandedLimits: Record<string, number> = {};

	let cachedSections: readonly SectionRenderDescriptor<T, G>[] | undefined;
	let cachedVersion = -1;
	let cachedUpdate: SectionVisibleCountsUpdate | undefined;

	const resolveDefaultVisibleLimit = (
		sectionId: string,
		totalLoadedCount: number,
	): number => {
		if (typeof applicationStore?.getDefaultSectionVisibleLimit === "function") {
			return applicationStore.getDefaultSectionVisibleLimit();
		}

		return computeInitialVisibleCount(totalLoadedCount, initialVisibleCount);
	};

	const resolveExpandedLimit = (sectionId: string): number | undefined => {
		const localExpandedLimit = sourceExpandedLimits[sectionId];
		if (localExpandedLimit !== undefined) {
			return localExpandedLimit;
		}

		if (typeof applicationStore?.getSectionExpandedLimit === "function") {
			return applicationStore.getSectionExpandedLimit(sectionId);
		}

		return snapshot.expandedLimits[sectionId];
	};

	const resolveVisibleCount = (
		sectionId: string,
		totalLoadedCount: number,
	): number => {
		const defaultLimit = resolveDefaultVisibleLimit(sectionId, totalLoadedCount);
		const expandedLimit = resolveExpandedLimit(sectionId) ?? 0;
		return Math.min(totalLoadedCount, Math.max(defaultLimit, expandedLimit));
	};

	const commitSnapshot = (
		visibleCounts: Record<string, number>,
		expandedLimits: Record<string, number>,
		sectionIds: ReadonlySet<string>,
	): SectionVisibleCountsUpdate => {
		if (
			hasSameVisibleCounts(snapshot.visibleCounts, visibleCounts) &&
			hasSameVisibleCounts(snapshot.expandedLimits, expandedLimits) &&
			hasSameSectionIds(snapshot.sectionIds, sectionIds)
		) {
			return { snapshot, changed: false };
		}

		snapshot = {
			visibleCounts,
			expandedLimits,
			sectionIds,
			version: snapshot.version + 1,
		};
		return { snapshot, changed: true };
	};

	const resolveInitialSectionVisibleCount = (
		section: SectionRenderDescriptor<T, G>,
	): number =>
		normalizeStoredVisibleCount(
			resolveVisibleCount(getSectionPaginationKey(section), section.loadedCount),
		);

	const clampVisibleCount = (
		section: SectionRenderDescriptor<T, G>,
		count: number,
	): number => Math.min(section.loadedCount, normalizeStoredVisibleCount(count));

	return {
		getSnapshot() {
			return snapshot;
		},
		resolveForInput(sections) {
			if (sections === cachedSections && snapshot.version === cachedVersion) {
				return cachedUpdate!;
			}

			const visibleCounts: Record<string, number> = {};
			const activeExpandedLimits: Record<string, number> = {};
			const sectionIds = new Set<string>();

			for (const section of sections) {
				const paginationKey = getSectionPaginationKey(section);
				sectionIds.add(paginationKey);
				const expandedLimit = resolveExpandedLimit(paginationKey);
				if (expandedLimit !== undefined) {
					activeExpandedLimits[paginationKey] = expandedLimit;
				}
				visibleCounts[paginationKey] =
					resolveInitialSectionVisibleCount(section);
			}

			const update = commitSnapshot(
				visibleCounts,
				activeExpandedLimits,
				sectionIds,
			);
			cachedSections = sections;
			cachedVersion = snapshot.version;
			cachedUpdate = update;
			return update;
		},
		resolveInitialSectionVisibleCount,
		clampVisibleCount,
		loadMore(sectionId, loadedCount) {
			const visibleCount = resolveVisibleCount(sectionId, loadedCount);
			if (visibleCount >= loadedCount) {
				return { snapshot, changed: false };
			}

			const increment = normalizeIncrement(loadMoreIncrement);
			const nextLimit =
				increment === Number.POSITIVE_INFINITY
					? loadedCount
					: Math.min(loadedCount, visibleCount + increment);
			const nextExpandedLimit = Math.max(
				resolveExpandedLimit(sectionId) ?? 0,
				nextLimit,
			);
			sourceExpandedLimits = {
				...sourceExpandedLimits,
				[sectionId]: nextExpandedLimit,
			};
			const nextExpandedLimits = {
				...snapshot.expandedLimits,
				[sectionId]: nextExpandedLimit,
			};
			const nextVisibleCounts = {
				...snapshot.visibleCounts,
				[sectionId]: Math.min(
					loadedCount,
					Math.max(
						resolveDefaultVisibleLimit(sectionId, loadedCount),
						nextExpandedLimit,
					),
				),
			};
			const nextSnapshot = commitSnapshot(
				nextVisibleCounts,
				nextExpandedLimits,
				snapshot.sectionIds,
			);
			if (
				nextSnapshot.changed &&
				typeof applicationStore?.setSectionExpandedLimit === "function"
			) {
				applicationStore.setSectionExpandedLimit(sectionId, nextExpandedLimit);
			}
			return nextSnapshot;
		},
	};
}

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
		setExpandedLimit,
		canLoadMore(sectionId, loadedCount) {
			return getVisibleCount(sectionId, loadedCount) < loadedCount;
		},
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
		prune(sectionIds) {
			const expandedLimits = getExpandedLimits();
			const hasRemovedSection = Object.keys(expandedLimits).some(
				(sectionId) => !sectionIds.has(sectionId),
			);

			if (!hasRemovedSection) {
				return;
			}

			const nextExpandedLimits: Record<string, number> = {};

			for (const sectionId in expandedLimits) {
				if (sectionIds.has(sectionId)) {
					nextExpandedLimits[sectionId] = expandedLimits[sectionId];
				}
			}

			setExpandedLimits(nextExpandedLimits);
		},
	};
}
