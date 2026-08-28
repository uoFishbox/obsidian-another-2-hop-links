import type { IndexedLink } from "indexing/model";
import type { TwoHopLinkBranch } from "two-hop/model";
import type { MergedLinkItem } from "two-hop/display/displayDataBuilder";
import {
	generateBranchCardKey,
	generateBacklinkKey,
	generateIndexedLinkKey,
} from "card-preview/text/textUtils";
import type { SectionConfig } from "./types";

export const backlinksSectionConfig: SectionConfig<IndexedLink> = {
	title: "Backlinks",
	sectionId: "backlinks",
	className: "twohop-links-back-links",
	getKey: (link: IndexedLink) => generateBacklinkKey(link, "backlink"),
};

export const outgoingLinksSectionConfig: SectionConfig<TwoHopLinkBranch> = {
	title: "Outgoing links",
	sectionId: "outgoing",
	className: "twohop-links-forward-links",
	getKey: (branch: TwoHopLinkBranch) => generateBranchCardKey(branch),
};

const isMergedBranch = (item: MergedLinkItem): item is TwoHopLinkBranch =>
	"hop1" in item && "hop2" in item;

export const mergedLinksSectionConfig: SectionConfig<MergedLinkItem> = {
	title: "Links",
	sectionId: "merged",
	className: "twohop-links-merged",
	getKey: (item: MergedLinkItem) =>
		isMergedBranch(item)
			? generateBranchCardKey(item, "outgoing")
			: generateBacklinkKey(item, "backlink"),
};

export const newLinksSectionConfig: SectionConfig<IndexedLink> = {
	title: "New Links",
	sectionId: "newlinks",
	className: "cosense-card-links__new-links",
	getKey: (link: IndexedLink) => generateIndexedLinkKey(link, "new"),
};
