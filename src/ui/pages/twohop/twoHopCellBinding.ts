import type { LogicalCellKey } from "ui/components/common/virtual-list/types";
import type { TwoHopMountedCell } from "./twoHopMountedTypes";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";
import type { MountedFlatItemCell } from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import type {
	CardPresentationState,
	CardSectionVariant,
} from "ui/components/common/cardPresentation";
import type { RenderBodyKey } from "ui/components/common/virtual-list/renderRevision";
import { isAttachment } from "core/rules/fileRules";

export type TwoHopCardSectionVariant = CardSectionVariant;

export type TwoHopItemReuseFamily = "resolved-card" | "missing-branch" | "new-link";

export type TwoHopCardPresentationState = CardPresentationState;

type TwoHopMountedItemCell = MountedFlatItemCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

/** Complete, committed state for one physical cell's current logical binding. */
export interface TwoHopCellBinding {
	readonly epoch: number;
	readonly logicalKey: LogicalCellKey;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly renderBodyKey: RenderBodyKey | undefined;
	readonly renderKind: TwoHopMountedCell["renderBodyKind"];
	readonly reuseFamily: TwoHopItemReuseFamily | null;
	readonly presentation: TwoHopCardPresentationState | null;
	readonly interactionId: string | null;
	readonly mountedCell: TwoHopMountedCell;
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

function resolveItemState(
	cell: TwoHopMountedItemCell,
): Pick<TwoHopCellBinding, "reuseFamily" | "presentation" | "interactionId"> {
	const row = cell.cell.item;
	const sectionVariant = resolveTwoHopSectionVariant(cell.section);
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
				reuseFamily: missing ? "missing-branch" : "resolved-card",
				presentation: presentation(missing ? "missing" : "resolved"),
				interactionId: row.interactionId ?? null,
			};
		}
		case "taggedNote":
			return {
				reuseFamily: "resolved-card",
				presentation: presentation("resolved"),
				interactionId: row.interactionId ?? null,
			};
		case "file":
			return {
				reuseFamily: "resolved-card",
				presentation: presentation("resolved"),
				interactionId: row.interactionId ?? null,
			};
		case "backlink":
			return {
				reuseFamily: "resolved-card",
				presentation: presentation("resolved"),
				interactionId: row.interactionId ?? null,
			};
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

function isItemCell(cell: TwoHopMountedCell): cell is TwoHopMountedItemCell {
	return cell.cell.kind === "item";
}

/** Builds the single snapshot committed by a physical slot rebind. */
export function createTwoHopCellBinding(
	cell: TwoHopMountedCell,
	epoch: number,
): TwoHopCellBinding {
	const mountedCell = {
		...cell,
		cell: { ...cell.cell },
	} as TwoHopMountedCell;
	const itemState = isItemCell(mountedCell)
		? resolveItemState(mountedCell)
		: { reuseFamily: null, presentation: null, interactionId: null };

	return {
		epoch,
		logicalKey: mountedCell.key,
		rowIndex: mountedCell.rowIndex,
		columnIndex: mountedCell.columnIndex,
		renderBodyKey: mountedCell.renderBodyKey,
		renderKind: mountedCell.renderBodyKind,
		...itemState,
		mountedCell,
	};
}
