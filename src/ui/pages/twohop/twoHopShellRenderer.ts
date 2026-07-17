import { IS_PROD } from "../../../appConstants";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import {
	INTERACTION_ID_ATTRIBUTE,
	INTERACTION_KIND_ATTRIBUTE,
} from "ui/interactions/interactionTypes";
import type { TwoHopCardShellSlot } from "./twoHopDomPool";
import type { TwoHopResolvedCell } from "./twoHopGeometry";
import { resolveTwoHopItemStaticState, resolveTwoHopSectionVariant } from "./twoHopCellStaticState";
import type { TwoHopSnapshot } from "./twoHopSnapshot";
import { resolveTwoHopNavigationCellKey } from "./twoHopInteractionRouter";

export interface TwoHopShellRendererParams {
	readonly resolveItemCardModel?: (
		item: Extract<TwoHopResolvedCell, { kind: "item" }>['item'],
		presentation: NonNullable<
			ReturnType<typeof resolveTwoHopItemStaticState>["presentation"]
		>,
	) => CardRenderModel;
}

export function createTwoHopShellRenderer(params: TwoHopShellRendererParams) {
	let modelCache = new WeakMap<
		Extract<TwoHopResolvedCell, { kind: "item" }>["item"],
		CardRenderModel
	>();
	function renderSkeleton(
		slot: TwoHopCardShellSlot,
		cell: TwoHopResolvedCell | null,
		snapshot: TwoHopSnapshot,
	): void {
		prepareSlot(slot, cell, snapshot);
		slot.rich = false;
		slot.root.classList.add("is-skeleton");
		slot.title.textContent = "";
		slot.meta.textContent = "";
		clearInteraction(slot.root);
	}

	function renderShell(
		slot: TwoHopCardShellSlot,
		cell: TwoHopResolvedCell,
		snapshot: TwoHopSnapshot,
	): void {
		const identity = resolveCellIdentity(cell, snapshot);
		const retainedRichShell = slot.rich && slot.logicalIdentity === identity;
		prepareSlot(slot, cell, snapshot);
		if (retainedRichShell) return;
		slot.rich = true;
		slot.root.classList.remove("is-skeleton");
		resetVariantClasses(slot.root);

		const section = snapshot.sections[cell.sectionIndex];
		const descriptor = section.descriptor;
		if (cell.kind === "header") {
			slot.root.classList.add(
				descriptor.section.kind === "primary-section" ||
					descriptor.section.kind === "new-links-section"
					? "cosense-card-links__connected-links-header"
					: "cosense-card-links__twohop-header",
			);
			slot.title.className = "cosense-card-links__header-title";
			slot.title.textContent = descriptor.title;
			slot.meta.textContent = `${descriptor.totalCount}`;
			slot.root.setAttribute(
				"aria-label",
				`${descriptor.totalCount} notes`,
			);
			slot.root.dataset.cclSectionVariant = resolveTwoHopSectionVariant(
				descriptor.section,
			);
			const interactionId = descriptor.headerProps.interactionId;
			if (interactionId) {
				setInteraction(slot.root, interactionId, "sectionHeader");
			} else {
				clearInteraction(slot.root);
			}
			if (!IS_PROD) {
				slot.cell.dataset.testid = `section-block-${descriptor.sectionId}`;
			}
			return;
		}

		if (cell.kind === "load-more") {
			slot.root.classList.add("cosense-card-links__load-more-button");
			slot.title.className = "cosense-card-links__box-title";
			slot.title.textContent = "•••";
			slot.meta.textContent = "";
			slot.root.setAttribute("aria-label", "Load more");
			slot.root.dataset.twoHopLoadMoreSection = descriptor.sectionId;
			clearInteraction(slot.root);
			if (!IS_PROD) {
				slot.cell.dataset.testid = `load-more-${descriptor.sectionId}`;
			}
			return;
		}

		const staticState = resolveTwoHopItemStaticState(
			cell.item,
			descriptor.section,
		);
		const presentation = staticState.presentation;
		let model = modelCache.get(cell.item) ?? null;
		if (!model && presentation && params.resolveItemCardModel) {
			model = params.resolveItemCardModel(cell.item, presentation);
			modelCache.set(cell.item, model);
		}
		slot.title.className = "cosense-card-links__box-title";
		slot.title.textContent = model?.title ?? cell.item.virtualKey;
		slot.meta.textContent = model?.extension ?? presentation?.extension ?? "";
		slot.root.setAttribute("aria-label", model?.ariaLabel ?? slot.title.textContent);
		slot.root.dataset.cclSectionVariant = presentation?.sectionVariant ?? "";
		slot.root.dataset.cclResolution = presentation?.resolution ?? "resolved";
		slot.root.dataset.cclAttachment = presentation?.attachment ? "true" : "false";
		slot.root.dataset.cclExtension = presentation?.extension ?? "";
		slot.root.classList.toggle("is-attachment", presentation?.attachment ?? false);
		if (!IS_PROD) {
			slot.cell.dataset.testid = "twohop-item-cell";
			slot.cell.dataset.index = String(cell.itemIndex);
		}
		const interactionId = model?.interactionId ?? staticState.interactionId;
		if (interactionId) {
			setInteraction(slot.root, interactionId, "item");
		} else {
			clearInteraction(slot.root);
		}
	}

	return {
		renderSkeleton,
		renderShell,
		invalidateCardModels() {
			modelCache = new WeakMap();
		},
	};
}

function prepareSlot(
	slot: TwoHopCardShellSlot,
	cell: TwoHopResolvedCell | null,
	snapshot: TwoHopSnapshot,
): void {
	const identity = cell ? resolveCellIdentity(cell, snapshot) : null;
	if (slot.logicalIdentity !== identity) {
		slot.logicalIdentity = identity;
		slot.generation += 1;
		slot.previewGeneration += 1;
		slot.previewHost.replaceChildren();
	}
	slot.logicalRowIndex = cell?.rowIndex ?? -1;
	slot.logicalColumnIndex = cell?.columnIndex ?? -1;
	slot.cell.style.visibility = cell ? "visible" : "hidden";
	if (identity) slot.cell.dataset.cclLogicalKey = identity;
	else delete slot.cell.dataset.cclLogicalKey;
	delete slot.cell.dataset.testid;
	delete slot.root.dataset.twoHopLoadMoreSection;
}

function resolveCellIdentity(
	cell: TwoHopResolvedCell,
	snapshot: TwoHopSnapshot,
): string {
	return resolveTwoHopNavigationCellKey(cell, snapshot);
}

function resetVariantClasses(root: HTMLElement): void {
	root.classList.remove(
		"cosense-card-links__connected-links-header",
		"cosense-card-links__twohop-header",
		"cosense-card-links__load-more-button",
		"is-attachment",
	);
}

function setInteraction(
	root: HTMLElement,
	interactionId: string,
	kind: "item" | "sectionHeader",
): void {
	root.setAttribute(INTERACTION_ID_ATTRIBUTE, interactionId);
	root.setAttribute(INTERACTION_KIND_ATTRIBUTE, kind);
	root.tabIndex = 0;
	root.draggable = true;
}

function clearInteraction(root: HTMLElement): void {
	root.removeAttribute(INTERACTION_ID_ATTRIBUTE);
	root.removeAttribute(INTERACTION_KIND_ATTRIBUTE);
	root.tabIndex = -1;
	root.draggable = false;
}
