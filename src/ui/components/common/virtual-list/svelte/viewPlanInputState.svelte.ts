import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { SectionRenderDescriptor } from "../../../sections/types";
import {
	createSectionVisibleCountsController,
	getSectionPaginationKey,
	type SectionVisibleCountsSnapshot,
} from "../pagination";
import { validateViewPlanInput } from "../validation/viewPlanInputValidation";
import type { VirtualListInputError } from "../validation/virtualListValidationError";

const EMPTY_SECTIONS: readonly never[] = [];

export interface ViewPlanInputStateParams<T, G> {
	getSections(): readonly SectionRenderDescriptor<T, G>[];
	applicationStore?: ApplicationStore;
	initialVisibleCount?: number;
	loadMoreIncrement?: number;
}

export interface ViewPlanInputState<T, G> {
	readonly validatedSections: readonly SectionRenderDescriptor<T, G>[];
	readonly sectionsBySectionId: ReadonlyMap<string, SectionRenderDescriptor<T, G>>;
	readonly sectionVisibleCounts: Readonly<Record<string, number>>;
	readonly visibleCountsSnapshot: SectionVisibleCountsSnapshot;
	readonly validationError: VirtualListInputError<T, G> | null;
	syncVisibleCountsForInput(): void;
	loadMore(sectionId: string): void;
	pruneUnusedSectionsInput(): ReadonlySet<string>;
	resolveInitialSectionVisibleCount(section: SectionRenderDescriptor<T, G>): number;
	clampVisibleCount(section: SectionRenderDescriptor<T, G>, count: number): number;
}

export function createViewPlanInputState<T, G>({
	getSections,
	applicationStore,
	initialVisibleCount,
	loadMoreIncrement,
}: ViewPlanInputStateParams<T, G>): ViewPlanInputState<T, G> {
	const viewPlanInputValidation = $derived.by(() =>
		validateViewPlanInput<T, G>({ sections: getSections() }),
	);
	const sectionsBySectionId = $derived.by(() =>
		viewPlanInputValidation.ok
			? viewPlanInputValidation.value.sectionsBySectionId
			: new Map<string, SectionRenderDescriptor<T, G>>(),
	);
	const validatedSections = $derived.by(() =>
		viewPlanInputValidation.ok ? viewPlanInputValidation.value.sections : EMPTY_SECTIONS,
	);

	const visibleCountsController = createSectionVisibleCountsController<T, G>({
		applicationStore,
		initialVisibleCount,
		loadMoreIncrement,
	});
	let visibleCountsSnapshot = $state.raw<SectionVisibleCountsSnapshot>(
		visibleCountsController.getSnapshot(),
	);
	const publishVisibleCountsSnapshot = (
		nextSnapshot: SectionVisibleCountsSnapshot,
	): void => {
		if (visibleCountsSnapshot !== nextSnapshot) {
			visibleCountsSnapshot = nextSnapshot;
		}
	};
	const syncVisibleCountsForInput = (): void => {
		publishVisibleCountsSnapshot(
			visibleCountsController.resolveForInput(validatedSections).snapshot,
		);
	};
	const sectionVisibleCounts = $derived(
		visibleCountsSnapshot.visibleCounts,
	);
	const validationError = $derived.by(() =>
		viewPlanInputValidation.ok ? null : viewPlanInputValidation.error,
	);

	return {
		get validatedSections() {
			return validatedSections;
		},
		get sectionsBySectionId() {
			return sectionsBySectionId;
		},
		get sectionVisibleCounts() {
			return sectionVisibleCounts;
		},
		get visibleCountsSnapshot() {
			return visibleCountsSnapshot;
		},
		get validationError() {
			return validationError;
		},
		syncVisibleCountsForInput,
		loadMore(sectionId) {
			const section = sectionsBySectionId.get(sectionId) ?? null;
			if (!section) {
				return;
			}

			const visibleCount = visibleCountsController.clampVisibleCount(
				section,
				visibleCountsController.getSnapshot().visibleCounts[
					getSectionPaginationKey(section)
				] ??
					visibleCountsController.resolveInitialSectionVisibleCount(section),
			);
			const showLoadMore = visibleCount < section.loadedCount;
			if (!showLoadMore) {
				return;
			}

			const result = visibleCountsController.loadMore(
				getSectionPaginationKey(section),
				section.loadedCount,
			);
			if (result.changed) {
				publishVisibleCountsSnapshot(result.snapshot);
			}
		},
		pruneUnusedSectionsInput() {
			return visibleCountsSnapshot.sectionIds;
		},
		resolveInitialSectionVisibleCount:
			visibleCountsController.resolveInitialSectionVisibleCount,
		clampVisibleCount: visibleCountsController.clampVisibleCount,
	};
}
