import { buildScopedSectionId } from "ui/components/common/listPagination";
import {
	createSectionPaginationState,
	type SectionPaginationApplicationStore,
} from "ui/virtualization/pagination";
import type { TwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";

export interface TwoHopSectionProjectionInput {
	readonly sections: readonly TwoHopSectionModel[];
	readonly paginationScope: string;
	readonly initialVisibleCount: number | undefined;
	readonly loadMoreIncrement: number | undefined;
}

export interface TwoHopSectionProjection {
	getSections(): readonly TwoHopSectionModel[];
	setInput(input: TwoHopSectionProjectionInput): readonly TwoHopSectionModel[];
	loadMore(sectionId: string): readonly TwoHopSectionModel[] | null;
}

export interface CreateTwoHopSectionProjectionParams {
	readonly sections: readonly TwoHopSectionModel[];
	readonly applicationStore?: SectionPaginationApplicationStore;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
	readonly paginationScope?: string;
}

/** Applies pagination while retaining the same section model shape. */
export function createTwoHopSectionProjection(
	params: CreateTwoHopSectionProjectionParams,
): TwoHopSectionProjection {
	let sources = params.sections;
	let paginationScope = params.paginationScope?.trim() ?? "";
	let initialVisibleCount = params.initialVisibleCount;
	let loadMoreIncrement = params.loadMoreIncrement;
	let expandedLimits: Record<string, number> = {};
	let pagination = createPagination();
	let sections: readonly TwoHopSectionModel[] = [];
	sections = project();

	function createPagination() {
		return createSectionPaginationState({
			getExpandedLimits: () => expandedLimits,
			setExpandedLimits: (next) => {
				expandedLimits = next;
			},
			applicationStore: params.applicationStore,
			initialVisibleCount,
			loadMoreIncrement,
		});
	}

	function getPaginationId(sectionId: string): string {
		return buildScopedSectionId(sectionId, paginationScope);
	}

	function project(): readonly TwoHopSectionModel[] {
		const previousById = new Map(sections?.map((section) => [section.id, section]));
		const next = sources.map((source) => {
			const visibleCount = pagination.getVisibleCount(
				getPaginationId(source.id),
				source.items.length,
			);
			const previous = previousById.get(source.id);
			if (
				previous &&
				previous.items === source.items &&
				previous.header === source.header &&
				previous.visibleCount === visibleCount
			) {
				return previous;
			}
			if (source.visibleCount === visibleCount) return source;
			return Object.freeze({ ...source, visibleCount }) as TwoHopSectionModel;
		});
		if (
			sections &&
			sections.length === next.length &&
			sections.every((section, index) => section === next[index])
		) {
			return sections;
		}
		return Object.freeze(next);
	}

	return {
		getSections: () => sections,
		setInput(input) {
			const nextScope = input.paginationScope.trim();
			const optionsChanged =
				nextScope !== paginationScope ||
				!Object.is(input.initialVisibleCount, initialVisibleCount) ||
				!Object.is(input.loadMoreIncrement, loadMoreIncrement);
			if (!optionsChanged && input.sections === sources) return sections;

			sources = input.sections;
			if (optionsChanged) {
				paginationScope = nextScope;
				initialVisibleCount = input.initialVisibleCount;
				loadMoreIncrement = input.loadMoreIncrement;
				expandedLimits = {};
				pagination = createPagination();
			}
			sections = project();
			return sections;
		},
		loadMore(sectionId) {
			const source = sources.find((section) => section.id === sectionId);
			const current = sections.find((section) => section.id === sectionId);
			if (!source || !current || current.visibleCount >= source.items.length) {
				return null;
			}
			const before = sections;
			pagination.loadMore(getPaginationId(source.id), source.items.length);
			sections = project();
			return sections === before ? null : sections;
		},
	};
}
