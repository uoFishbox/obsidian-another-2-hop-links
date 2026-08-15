import type { CardSectionVariant } from "ui/components/common/cardPresentation";
import type { TwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";

export type TwoHopCardSectionVariant = CardSectionVariant;

export function resolveTwoHopSectionVariant(
	section: TwoHopSectionModel,
): TwoHopCardSectionVariant {
	switch (section.kind) {
		case "new-links-section":
			return "new-links";
		case "tag-section":
			return "tag";
		case "two-hop-branch":
			return "two-hop";
		case "primary-section":
			switch (section.id) {
				case "outgoing":
					return "outgoing";
				case "merged":
					return "merged";
				default:
					return "backlinks";
			}
	}
}
