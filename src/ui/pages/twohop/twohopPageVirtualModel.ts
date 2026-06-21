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

export type TwoHopPageVirtualSection =
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

export type TwoHopPageVirtualItem =
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

export type TwoHopSectionDescriptor = SectionRenderDescriptor<
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection
>;

export const getTwoHopPageItemKey = (
	row: TwoHopPageVirtualItem,
	_index: number,
	_section: TwoHopPageVirtualSection,
): string => row.virtualKey;

export const createTaggedNoteSectionItemKey = (
	item: ViewItem,
	tag: string,
	index: number,
): string =>
	item.type === "taggedNote"
		? generateLinkKey(
				item.data.path,
				item.data.file.basename,
				[
					"tag-note",
					tag,
					item.data.usageKey ?? "",
					item.data.position?.start.offset ?? "",
					item.data.position?.end.offset ?? "",
				].join(":"),
			)
		: `tag-item-${tag}-${index}`;

export const resolveTwoHopPageItemSearchScope = (
	row: TwoHopPageVirtualItem,
	searchScope: SearchWorkerMatchScope,
	contentMatched: boolean | undefined,
): SearchWorkerMatchScope =>
	searchScope === "title-and-content" && (contentMatched ?? true)
		? "title-and-content"
		: "title-only";

export type { TagGroup, TaggedNote };
