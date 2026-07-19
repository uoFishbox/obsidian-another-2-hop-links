import { IS_PROD } from "appConstants";
import {
	createRecyclableCellSlot,
	type RecyclableCellSlot,
} from "features/two-hop/ui/recyclableCellSlot";

export interface TwoHopCardShellSlot extends RecyclableCellSlot {
	readonly slotIndex: number;
	readonly cell: HTMLDivElement;
	readonly root: HTMLDivElement;
	readonly titleWrapper: HTMLDivElement;
	readonly title: HTMLDivElement;
	readonly meta: HTMLSpanElement;
	readonly headerIcon: SVGSVGElement;
	readonly previewHost: HTMLDivElement;
}

export interface TwoHopDomRowSlot {
	readonly slotIndex: number;
	readonly root: HTMLDivElement;
	readonly cells: readonly TwoHopCardShellSlot[];
	logicalRowIndex: number;
}

export interface TwoHopDomPool {
	readonly content: HTMLDivElement;
	readonly rows: readonly TwoHopDomRowSlot[];
	readonly capacity: number;
	readonly columns: number;
	setContentHeight(height: number): void;
	positionRow(slot: TwoHopDomRowSlot, logicalRowIndex: number, top: number): void;
	hideRow(slot: TwoHopDomRowSlot): void;
	dispose(): void;
}

/** Creates every row and card shell once. Pool growth is intentionally unsupported. */
export function createTwoHopDomPool(params: {
	readonly content: HTMLDivElement;
	readonly rowCapacity: number;
	readonly columns: number;
}): TwoHopDomPool {
	const ownerDocument = params.content.ownerDocument;
	const capacity = Math.max(1, Math.floor(params.rowCapacity));
	const columns = Math.max(1, Math.floor(params.columns));
	const rows: TwoHopDomRowSlot[] = [];
	let nextCellSlotIndex = 0;

	params.content.className =
		"view-plan-virtual-list-content view-plan-flow-content twohop-imperative-content";

	for (let rowSlotIndex = 0; rowSlotIndex < capacity; rowSlotIndex += 1) {
		const row = ownerDocument.createElement("div");
		row.className = "view-plan-flow-row twohop-imperative-row";
		row.dataset.cclRowSlot = String(rowSlotIndex);
		row.style.position = "absolute";
		row.style.inset = "0 auto auto 0";
		row.style.top = "0";
		row.style.visibility = "hidden";
		const cells: TwoHopCardShellSlot[] = [];

		for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
			const cell = ownerDocument.createElement("div");
			cell.className = "view-plan-virtual-list-cell view-plan-flow-cell";
			cell.dataset.slot = String(nextCellSlotIndex);
			cell.dataset.cclCellSlot = String(nextCellSlotIndex);
			cell.dataset.cclColumnIndex = String(columnIndex);
			const root = ownerDocument.createElement("div");
			root.className = "cosense-card-links__box twohop-card-shell is-skeleton";
			root.setAttribute("role", "button");
			root.tabIndex = -1;
			const titleWrapper = ownerDocument.createElement("div");
			titleWrapper.className = "cosense-card-links__box-title-wrapper";
			const title = ownerDocument.createElement("div");
			title.className = "cosense-card-links__box-title";
			const meta = ownerDocument.createElement("span");
			meta.className = "cosense-card-links__box-extension";
			const headerIcon = ownerDocument.createElementNS(
				"http://www.w3.org/2000/svg",
				"svg",
			);
			headerIcon.classList.add("twohop-links-icon");
			headerIcon.style.display = "none";
			const previewHost = ownerDocument.createElement("div");
			previewHost.className = "preview-mount-slot twohop-preview-host";
			titleWrapper.append(title, meta, headerIcon);
			root.append(titleWrapper, previewHost);
			cell.append(root);
			row.append(cell);
			const lifecycle = createRecyclableCellSlot({ cell, root, previewHost });
			cells.push(
				Object.assign(lifecycle, {
					slotIndex: nextCellSlotIndex,
					cell,
					root,
					titleWrapper,
					title,
					meta,
					headerIcon,
					previewHost,
				}),
			);
			nextCellSlotIndex += 1;
		}

		params.content.append(row);
		rows.push({
			slotIndex: rowSlotIndex,
			root: row,
			cells,
			logicalRowIndex: -1,
		});
	}

	return {
		content: params.content,
		rows,
		capacity,
		columns,
		setContentHeight(height) {
			params.content.style.height = `${Math.max(0, height)}px`;
		},
		positionRow(slot, logicalRowIndex, top) {
			slot.logicalRowIndex = logicalRowIndex;
			const rowIndexText = String(logicalRowIndex);
			if (!IS_PROD) slot.root.dataset.cclRowIndex = rowIndexText;
			for (const cell of slot.cells) {
				cell.cell.dataset.cclRowIndex = rowIndexText;
			}
			slot.root.style.transform = `translateY(${top}px)`;
			slot.root.style.visibility = "visible";
		},
		hideRow(slot) {
			for (const cell of slot.cells) {
				cell.suspend();
			}
			slot.logicalRowIndex = -1;
			delete slot.root.dataset.cclRowIndex;
			slot.root.style.visibility = "hidden";
		},
		dispose() {
			for (const row of rows) {
				for (const cell of row.cells) cell.unbind();
				row.root.remove();
			}
		},
	};
}
