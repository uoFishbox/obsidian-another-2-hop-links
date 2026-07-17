export interface TwoHopCardShellSlot {
	readonly slotIndex: number;
	readonly cell: HTMLDivElement;
	readonly root: HTMLDivElement;
	readonly title: HTMLDivElement;
	readonly meta: HTMLSpanElement;
	readonly previewHost: HTMLDivElement;
	logicalRowIndex: number;
	logicalColumnIndex: number;
	logicalIdentity: string | null;
	generation: number;
	previewGeneration: number;
	rich: boolean;
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
		row.style.position = "absolute";
		row.style.inset = "0 auto auto 0";
		row.style.visibility = "hidden";
		const cells: TwoHopCardShellSlot[] = [];

		for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
			const cell = ownerDocument.createElement("div");
			cell.className = "view-plan-virtual-list-cell view-plan-flow-cell";
			cell.dataset.slot = String(nextCellSlotIndex);
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
			const previewHost = ownerDocument.createElement("div");
			previewHost.className = "preview-mount-slot twohop-preview-host";
			titleWrapper.append(title, meta);
			root.append(titleWrapper, previewHost);
			cell.append(root);
			row.append(cell);
			cells.push({
				slotIndex: nextCellSlotIndex,
				cell,
				root,
				title,
				meta,
				previewHost,
				logicalRowIndex: -1,
				logicalColumnIndex: columnIndex,
				logicalIdentity: null,
				generation: 0,
				previewGeneration: 0,
				rich: false,
			});
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
			slot.root.style.transform = `translate3d(0, ${top}px, 0)`;
			slot.root.style.visibility = "visible";
		},
		hideRow(slot) {
			slot.logicalRowIndex = -1;
			slot.root.style.visibility = "hidden";
		},
		dispose() {
			for (const row of rows) row.root.remove();
		},
	};
}
