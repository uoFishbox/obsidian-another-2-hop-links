import { isAttachment } from "core/rules/fileRules";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import type {
	CardPresentationState,
	CardSectionVariant,
} from "ui/components/common/cardPresentation";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "features/two-hop/ui/twoHopVirtualListModel";

export type TwoHopCardSectionVariant = CardSectionVariant;

export type TwoHopItemReuseFamily = "resolved-card" | "missing-branch" | "new-link";

export type TwoHopCardPresentationState = CardPresentationState;

/** Immutable display and interaction data shared by bindings for one logical cell. */
export interface TwoHopCellStaticState {
	readonly reuseFamily: TwoHopItemReuseFamily | null;
	readonly presentation: TwoHopCardPresentationState | null;
	readonly interactionId: string | null;
}

export function resolveTwoHopSectionVariant(
	section: TwoHopVirtualListSection,
): TwoHopCardSectionVariant {
	switch (section.kind) {
		case "new-links-section":
			return "new-links";
		case "tag-section":
			return "tag";
		case "two-hop-branch":
			return "two-hop";
		case "primary-section":
			switch (section.rawSectionId) {
				case "outgoing":
					return "outgoing";
				case "merged":
					return "merged";
				default:
					return "backlinks";
			}
	}
}

/** Resolves item data once while compiling a TwoHop view plan. */
export function resolveTwoHopItemStaticState(
	row: TwoHopVirtualListItem,
	section: TwoHopVirtualListSection,
): TwoHopCellStaticState {
	const sectionVariant = resolveTwoHopSectionVariant(section);
	const extension = resolveItemExtension(row.item);
	const interactionId = row.interactionId ?? createItemInteractionKey(row.item);

	switch (row.item.type) {
		case "newLink":
			return {
				reuseFamily: "new-link",
				presentation: createPresentationState(
					sectionVariant,
					extension,
					"missing",
				),
				interactionId,
			};
		case "branch": {
			const missing = row.item.data.hop1.isUnresolved;
			return {
				reuseFamily: missing ? "missing-branch" : "resolved-card",
				presentation: createPresentationState(
					sectionVariant,
					extension,
					missing ? "missing" : "resolved",
				),
				interactionId,
			};
		}
		case "taggedNote":
		case "file":
		case "backlink":
			return {
				reuseFamily: "resolved-card",
				presentation: createPresentationState(
					sectionVariant,
					extension,
					"resolved",
				),
				interactionId,
			};
		default:
			return {
				reuseFamily: null,
				presentation: null,
				interactionId: row.interactionId ?? null,
			};
	}
}

function createPresentationState(
	sectionVariant: TwoHopCardSectionVariant,
	extension: string | null,
	resolution: TwoHopCardPresentationState["resolution"],
): TwoHopCardPresentationState {
	return {
		sectionVariant,
		resolution,
		attachment: isAttachment(extension ?? undefined),
		extension,
	};
}

function normalizeExtension(extension: string | undefined): string | null {
	if (!extension || extension.toLowerCase() === "md") return null;
	return extension.toLowerCase();
}

function resolvePathExtension(path: string | undefined): string | null {
	if (!path) return null;
	const separatorIndex = path.lastIndexOf("/");
	const fileNameStart = separatorIndex < 0 ? 0 : separatorIndex + 1;
	const extensionIndex = path.lastIndexOf(".");
	if (extensionIndex <= fileNameStart) return null;
	return normalizeExtension(path.slice(extensionIndex + 1));
}

function resolveItemExtension(item: TwoHopVirtualListItem["item"]): string | null {
	switch (item.type) {
		case "newLink":
			return null;
		case "branch":
			return resolvePathExtension(item.data.hop1.path);
		case "backlink":
			return normalizeExtension(item.data.sourceFile.extension);
		case "taggedNote":
			return normalizeExtension(item.data.file.extension);
		case "file":
			return normalizeExtension(item.data.extension);
		default:
			return null;
	}
}
