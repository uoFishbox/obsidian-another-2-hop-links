import type { ViewItem } from "application/presenters";
import type { SearchWorkerMatchScope } from "features/search/searchWorkerTypes";
import { generateLinkKey } from "features/preview/text-processing/textUtils";
import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import type { TwoHopLinkBranch } from "types/domain";

interface TwoHopSectionBase {
	readonly id: string;
	readonly key: string;
	readonly title: string;
	readonly className?: string;
	readonly header: TwoHopHeaderModel;
	readonly items: readonly TwoHopItemModel[];
	readonly totalCount: number;
	readonly visibleCount: number;
}

export interface TwoHopHeaderModel {
	readonly logicalKey: string;
	readonly props: ClickableHeaderExtraProps;
}

export type TwoHopSectionModel =
	| (TwoHopSectionBase & { readonly kind: "primary-section" })
	| (TwoHopSectionBase & {
			readonly kind: "two-hop-branch";
			readonly branch: TwoHopLinkBranch;
	  })
	| (TwoHopSectionBase & {
			readonly kind: "tag-section";
			readonly tag: string;
	  })
	| (TwoHopSectionBase & { readonly kind: "new-links-section" });

export type TwoHopItemModel =
	| {
			readonly kind: "primary-link";
			readonly item: ViewItem;
			readonly interactionId?: string;
			readonly interactionKey?: string;
			readonly sourceSectionId: string;
			readonly searchKey: string;
			readonly key: string;
	  }
	| {
			readonly kind: "two-hop-link";
			readonly item: ViewItem;
			readonly interactionId?: string;
			readonly interactionKey?: string;
			readonly branch: TwoHopLinkBranch;
			readonly searchKey: string;
			readonly key: string;
	  }
	| {
			readonly kind: "tag-link";
			readonly item: ViewItem;
			readonly interactionId?: string;
			readonly interactionKey?: string;
			readonly tag: string;
			readonly searchKey: string;
			readonly key: string;
	  }
	| {
			readonly kind: "new-link";
			readonly item: ViewItem;
			readonly interactionId?: string;
			readonly interactionKey?: string;
			readonly searchKey: string;
			readonly key: string;
	  };

interface CreateTwoHopSectionModelBase {
	readonly id: string;
	readonly key: string;
	readonly title: string;
	readonly className?: string;
	readonly headerProps?: ClickableHeaderExtraProps;
	readonly items: readonly TwoHopItemModel[];
}

export type CreateTwoHopSectionModelParams =
	| (CreateTwoHopSectionModelBase & { readonly kind: "primary-section" })
	| (CreateTwoHopSectionModelBase & {
			readonly kind: "two-hop-branch";
			readonly branch: TwoHopLinkBranch;
	  })
	| (CreateTwoHopSectionModelBase & {
			readonly kind: "tag-section";
			readonly tag: string;
	  })
	| (CreateTwoHopSectionModelBase & { readonly kind: "new-links-section" });

/** Publishes one immutable section consumed directly by geometry and chunks. */
export function createTwoHopSectionModel(
	params: CreateTwoHopSectionModelParams,
): TwoHopSectionModel {
	const items = Object.freeze(params.items);
	const base = {
		id: params.id,
		key: params.key,
		kind: params.kind,
		title: params.title,
		className: params.className,
		header: Object.freeze({
			logicalKey: `header:${params.id}`,
			props: params.headerProps ?? {},
		}),
		items,
		totalCount: items.length,
		visibleCount: items.length,
	};

	switch (params.kind) {
		case "two-hop-branch":
			return Object.freeze({ ...base, kind: params.kind, branch: params.branch });
		case "tag-section":
			return Object.freeze({ ...base, kind: params.kind, tag: params.tag });
		case "primary-section":
		case "new-links-section":
			return Object.freeze({ ...base, kind: params.kind });
	}
}

export function createTaggedNoteSectionItemKey(
	item: ViewItem,
	tag: string,
	index: number,
): string {
	if (item.type !== "taggedNote") return `tag-item-${tag}-${index}`;

	const data = item.data;
	const startOffset = data.position?.start.offset ?? "";
	const endOffset = data.position?.end.offset ?? "";
	const suffix = `tag-note:${tag}:${data.usageKey ?? ""}:${startOffset}:${endOffset}`;
	return generateLinkKey(data.path, data.file.basename, suffix);
}

export function resolveTwoHopPageItemSearchScope(
	row: TwoHopItemModel,
	searchScope: SearchWorkerMatchScope,
	contentMatched: boolean | undefined,
): SearchWorkerMatchScope {
	return searchScope === "title-and-content" && (contentMatched ?? true)
		? "title-and-content"
		: "title-only";
}
