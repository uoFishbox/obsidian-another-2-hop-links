import type { TwoHopLinkBranch } from "types/domain";
import type { ViewItem } from "application/presenters";
import type {
	ClickableHeaderExtraProps,
	SectionRenderDescriptor,
} from "ui/components/sections/types";
import type { SearchWorkerMatchScope } from "features/search/searchWorkerTypes";
import { generateLinkKey } from "features/preview/text-processing/textUtils";
import type { TagGroup, TaggedNote } from "types/domain";

export interface PrimarySectionSource {
	sectionId: string;
	title: string;
	className?: string;
	items: readonly ViewItem[];
	getKey: (item: ViewItem, index: number) => string;
	getSearchKey: (item: ViewItem) => string;
}

interface TwoHopPageVirtualSectionBase {
	rawSectionId: string;
	sectionId: string;
	sectionKey: string;
	title: string;
	className?: string;
}

export type TwoHopVirtualListSection =
	| (TwoHopPageVirtualSectionBase & {
			kind: "primary-section";
			source: PrimarySectionSource;
	  })
	| (TwoHopPageVirtualSectionBase & {
			kind: "two-hop-branch";
			branch: TwoHopLinkBranch;
			headerProps: ClickableHeaderExtraProps;
	  })
	| (TwoHopPageVirtualSectionBase & {
			kind: "tag-section";
			tag: string;
			headerProps: ClickableHeaderExtraProps;
	  })
	| (TwoHopPageVirtualSectionBase & {
			kind: "new-links-section";
			getKey: (item: ViewItem, index: number) => string;
	  });

export type TwoHopVirtualListItem =
	| {
			kind: "primary-link";
			item: ViewItem;
			interactionId?: string;
			interactionKey?: string;
			sourceSectionId: string;
			searchKey: string;
			virtualKey: string;
	  }
	| {
			kind: "two-hop-link";
			item: ViewItem;
			interactionId?: string;
			interactionKey?: string;
			branch: TwoHopLinkBranch;
			searchKey: string;
			virtualKey: string;
	  }
	| {
			kind: "tag-link";
			item: ViewItem;
			interactionId?: string;
			interactionKey?: string;
			tag: string;
			searchKey: string;
			virtualKey: string;
	  }
	| {
			kind: "new-link";
			item: ViewItem;
			interactionId?: string;
			interactionKey?: string;
			searchKey: string;
			virtualKey: string;
	  };

export type TwoHopVirtualSectionDescriptor = SectionRenderDescriptor<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

export const getTwoHopPageItemKey = (
	row: TwoHopVirtualListItem,
	_index: number,
	_section: TwoHopVirtualListSection,
): string => row.virtualKey;

export const createTaggedNoteSectionItemKey = (
	item: ViewItem,
	tag: string,
	index: number,
): string => {
	if (item.type !== "taggedNote") {
		return `tag-item-${tag}-${index}`;
	}

	const data = item.data;
	const startOffset = data.position?.start.offset ?? "";
	const endOffset = data.position?.end.offset ?? "";
	const suffix = `tag-note:${tag}:${data.usageKey ?? ""}:${startOffset}:${endOffset}`;

	return generateLinkKey(data.path, data.file.basename, suffix);
};

export const resolveTwoHopPageItemSearchScope = (
	row: TwoHopVirtualListItem,
	searchScope: SearchWorkerMatchScope,
	contentMatched: boolean | undefined,
): SearchWorkerMatchScope =>
	searchScope === "title-and-content" && (contentMatched ?? true)
		? "title-and-content"
		: "title-only";

export type { TagGroup, TaggedNote };
