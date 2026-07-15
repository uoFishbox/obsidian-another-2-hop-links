import { isAttachment } from "core/rules/fileRules";
import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import type {
	CardPresentationState,
	CardSectionVariant,
} from "ui/components/common/cardPresentation";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";

export type TwoHopCardSectionVariant = CardSectionVariant;

export type TwoHopItemReuseFamily =
	| "resolved-item"
	| "missing-branch"
	| "new-link"
	| "tagged-note"
	| "file";

export type TwoHopCardPresentationState = CardPresentationState;

/** Immutable item display state compiled before cells enter the scroll hot path. */
export interface TwoHopCellDisplayMetadata {
	readonly reuseFamily: TwoHopItemReuseFamily | null;
	readonly presentation: TwoHopCardPresentationState | null;
	readonly interactionId: string | null;
}

const EMPTY_CELL_DISPLAY_METADATA: TwoHopCellDisplayMetadata = {
	reuseFamily: null,
	presentation: null,
	interactionId: null,
};

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

/** Compiles the display metadata reused whenever a logical cell is rebound. */
export function compileTwoHopCellDisplayMetadata(
	cell: VirtualListLogicalCell<TwoHopVirtualListItem>,
	section: TwoHopVirtualListSection,
): TwoHopCellDisplayMetadata {
	if (cell.kind !== "item") return EMPTY_CELL_DISPLAY_METADATA;

	const row = cell.item;
	const sectionVariant = resolveTwoHopSectionVariant(section);
	const extension = resolveItemExtension(row.item);
	const presentation = (
		resolution: TwoHopCardPresentationState["resolution"],
	): TwoHopCardPresentationState => ({
		sectionVariant,
		resolution,
		attachment: isAttachment(extension ?? undefined),
		extension,
	});

	switch (row.item.type) {
		case "newLink":
			return {
				reuseFamily: "new-link",
				presentation: presentation("missing"),
				interactionId: row.interactionId ?? null,
			};
		case "branch": {
			const missing = row.item.data.hop1.isUnresolved;
			return {
				reuseFamily: missing ? "missing-branch" : "resolved-item",
				presentation: presentation(missing ? "missing" : "resolved"),
				interactionId: row.interactionId ?? null,
			};
		}
		case "taggedNote":
			return {
				reuseFamily: "tagged-note",
				presentation: presentation("resolved"),
				interactionId: row.interactionId ?? null,
			};
		case "file":
			return {
				reuseFamily: "file",
				presentation: presentation("resolved"),
				interactionId: row.interactionId ?? null,
			};
		case "backlink":
			return {
				reuseFamily: "resolved-item",
				presentation: presentation("resolved"),
				interactionId: row.interactionId ?? null,
			};
		default: {
			const _exhaustive: never = row.item;
			void _exhaustive;
			return EMPTY_CELL_DISPLAY_METADATA;
		}
	}
}

function normalizeExtension(extension: string | undefined): string | null {
	if (!extension || extension.toLowerCase() === "md") return null;
	return extension.toLowerCase();
}

function resolvePathExtension(path: string | undefined): string | null {
	if (!path) return null;
	const fileName = path.split("/").at(-1) ?? "";
	const extensionIndex = fileName.lastIndexOf(".");
	return normalizeExtension(
		extensionIndex > 0 ? fileName.slice(extensionIndex + 1) : undefined,
	);
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
	}
}
