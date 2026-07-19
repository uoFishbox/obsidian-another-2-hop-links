import { describe, expect, it, vi } from "vitest";
import { createTwoHopDomPool } from "features/two-hop/ui/twoHopDomPool";
import { createTwoHopShellRenderer } from "features/two-hop/ui/twoHopShellRenderer";
import { createTwoHopDocument } from "features/two-hop/ui/twoHopDocument";
import {
	compileFixedGridLayout,
	resolveTwoHopCell,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import type { TwoHopVirtualSectionDescriptor } from "features/two-hop/ui/twoHopVirtualListModel";
import type { TwoHopVirtualListItem } from "features/two-hop/ui/twoHopVirtualListModel";
import type { TFile } from "obsidian";
import { VIRTUAL_CELL_WILL_REBIND_EVENT } from "ui/interactions/virtualCellRebind";
import type { TwoHopCardShellSlot } from "features/two-hop/ui/twoHopDomPool";

function installPreview(
	slot: TwoHopCardShellSlot,
	content: Node,
	dispose: (() => void) | null,
): void {
	const token = slot.beginEnrichment("test-preview");
	token.setDispose(dispose);
	expect(slot.commitEnrichment(token, content)).toBe(true);
}

function createFixture() {
	const item = {
		kind: "new-link",
		item: { type: "newLink" },
		interactionId: "item:missing",
		searchKey: "missing",
		virtualKey: "missing",
	} as TwoHopVirtualListItem;
	const descriptor = {
		section: {
			kind: "new-links-section",
			rawSectionId: "new",
			sectionId: "new",
			sectionKey: "new",
			title: "New links",
			getKey: () => "missing",
		},
		sectionKey: "new",
		sectionId: "new",
		title: "New links",
		totalCount: 4,
		loadedCount: 4,
		getItems: () => [item],
		getItem: (index) => (index === 0 ? item : undefined),
		headerProps: {},
	} satisfies TwoHopVirtualSectionDescriptor;
	const model = createTwoHopDocument({
		sections: [descriptor],
		visibleCounts: { new: 1 },
		initialVisibleCount: 1,
	});
	const geometry = compileFixedGridLayout(model, {
		containerWidth: 400,
		columns: 2,
		cellWidth: 195,
		rowHeight: 100,
		gap: 10,
		sectionMarginBottom: 20,
	});
	return { model, geometry };
}

describe("twoHop imperative DOM pool", () => {
	it("creates a fixed shell count and reuses it across logical rows", () => {
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 3, columns: 2 });
		const initialRows = [...pool.rows.map((row) => row.root)];

		pool.positionRow(pool.rows[0], 10, 1100);
		pool.positionRow(pool.rows[0], 20, 2200);

		expect(pool.rows.map((row) => row.root)).toEqual(initialRows);
		expect(content.querySelectorAll(".twohop-card-shell")).toHaveLength(6);
		expect(pool.rows[0].root.style.top).toBe("0px");
		expect(pool.rows[0].root.style.transform).toBe("translateY(2200px)");
		expect(pool.rows[0].root.dataset.cclRowIndex).toBe("20");
		expect(pool.rows[0].cells[0].cell.dataset.cclRowIndex).toBe("20");
		expect(pool.rows[0].cells[0].cell.dataset.cclColumnIndex).toBe("0");
		expect(pool.rows[0].cells[1].cell.dataset.cclColumnIndex).toBe("1");
	});

	it("lets hidden pool rows hide cells after rendering and reuse", () => {
		const { model, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const renderer = createTwoHopShellRenderer({});
		const cell = resolveTwoHopCell(model, geometry, 0, 0);
		if (!cell) throw new Error("expected header cell");
		const row = pool.rows[0];
		const slot = row.cells[0];

		pool.positionRow(row, 0, 0);
		renderer.renderShell(slot, cell, model);
		renderer.renderShell(slot, cell, model);
		pool.hideRow(row);

		expect(row.root.style.visibility).toBe("hidden");
		expect(slot.cell.style.visibility).toBe("");
		expect(slot.logicalIdentity).toBe(cell.logicalKey);
	});

	it("releases transient interaction state before rebinding a physical cell", () => {
		const { model, geometry } = createFixture();
		const content = document.createElement("div");
		document.body.append(content);
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const renderer = createTwoHopShellRenderer({});
		const item = resolveTwoHopCell(model, geometry, 0, 1);
		const header = resolveTwoHopCell(model, geometry, 0, 0);
		if (!item || !header) throw new Error("expected item and header cells");
		const slot = pool.rows[0].cells[0];
		renderer.renderShell(slot, item, model);
		slot.root.dataset.cclHovered = "true";
		slot.root.dataset.cclLongPressed = "1";
		slot.root.dataset.cclLastTouchAt = "123";
		slot.root.focus();
		const eventDetails: Array<{
			previousLogicalKey: string;
			nextLogicalKey: string;
			logicalKeyDuringDispatch: string | undefined;
		}> = [];
		const eventTargets: EventTarget[] = [];
		slot.cell.addEventListener(VIRTUAL_CELL_WILL_REBIND_EVENT, (event) => {
			const detail = (
				event as CustomEvent<{
					previousLogicalKey: string;
					nextLogicalKey: string;
				}>
			).detail;
			if (event.target) eventTargets.push(event.target);
			eventDetails.push({
				...detail,
				logicalKeyDuringDispatch: slot.cell.dataset.cclLogicalKey,
			});
		});

		renderer.renderShell(slot, header, model);

		expect(document.activeElement).not.toBe(slot.root);
		expect(slot.root.dataset.cclHovered).toBeUndefined();
		expect(slot.root.dataset.cclLongPressed).toBeUndefined();
		expect(slot.root.dataset.cclLastTouchAt).toBeUndefined();
		expect(eventDetails).toEqual([
			{
				previousLogicalKey: item.logicalKey,
				nextLogicalKey: header.logicalKey,
				logicalKeyDuringDispatch: item.logicalKey,
			},
		]);
		expect(eventTargets).toEqual([slot.cell]);
		expect(slot.cell.dataset.cclLogicalKey).toBe(header.logicalKey);
	});

	it("releases every physical cell before hiding a pool row", () => {
		const { model, geometry } = createFixture();
		const content = document.createElement("div");
		document.body.append(content);
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const renderer = createTwoHopShellRenderer({});
		const row = pool.rows[0];
		const header = resolveTwoHopCell(model, geometry, 0, 0);
		const item = resolveTwoHopCell(model, geometry, 0, 1);
		if (!header || !item) throw new Error("expected header and item cells");
		pool.positionRow(row, 0, 0);
		renderer.renderShell(row.cells[0], header, model);
		renderer.renderShell(row.cells[1], item, model);
		for (const cell of row.cells) {
			cell.root.dataset.cclHovered = "true";
			cell.root.dataset.cclLongPressed = "1";
			cell.root.dataset.cclLastTouchAt = "123";
		}
		row.cells[1].root.focus();
		const releasedCells: HTMLElement[] = [];
		content.addEventListener(VIRTUAL_CELL_WILL_REBIND_EVENT, (event) => {
			if (event.target instanceof HTMLElement) releasedCells.push(event.target);
		});

		pool.hideRow(row);

		expect(document.activeElement).not.toBe(row.cells[1].root);
		expect(releasedCells).toEqual(row.cells.map((cell) => cell.cell));
		for (const cell of row.cells) {
			expect(cell.root.dataset.cclHovered).toBeUndefined();
			expect(cell.root.dataset.cclLongPressed).toBeUndefined();
			expect(cell.root.dataset.cclLastTouchAt).toBeUndefined();
		}
		expect(row.root.style.visibility).toBe("hidden");
	});

	it("avoids subtree scans while releasing two-hop cells", () => {
		const { model, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const renderer = createTwoHopShellRenderer({});
		const row = pool.rows[0];
		const header = resolveTwoHopCell(model, geometry, 0, 0);
		const item = resolveTwoHopCell(model, geometry, 0, 1);
		if (!header || !item) throw new Error("expected header and item cells");
		const subtreeQueries = row.cells.map((slot) =>
			vi.spyOn(slot.cell, "querySelectorAll"),
		);

		pool.positionRow(row, 0, 0);
		renderer.renderShell(row.cells[0], header, model);
		renderer.renderShell(row.cells[1], item, model);
		expect(subtreeQueries.map((query) => query.mock.calls.length)).toEqual([0, 0]);

		pool.hideRow(row);
		pool.hideRow(row);
		pool.positionRow(row, 1, 100);
		renderer.renderShell(row.cells[0], item, model);
		renderer.renderShell(row.cells[1], header, model);

		expect(subtreeQueries.map((query) => query.mock.calls.length)).toEqual([0, 0]);
	});

	it("renders a cheap skeleton before resolving a rich card model", () => {
		const { model, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 2, columns: 2 });
		const resolveItemCardModel = vi.fn(() => ({
			item: model.sections[0].getItem(0).item,
			targetFile: null,
			title: "Resolved title",
			ariaLabel: "Open Resolved title",
			className: null,
			extension: null,
			directory: null,
			interactionId: "item:missing",
			interactionKey: "item:missing",
			presentation: undefined,
			searchQuery: "resolved",
			searchScope: "title-only" as const,
			contentPreview: undefined,
			previewRefreshToken: 0,
			previewActivationIdentity: undefined,
		}));
		const renderer = createTwoHopShellRenderer({
			resolveItemCardModel,
			resolveItemTitle: () => "Shell title",
		});
		const cell = resolveTwoHopCell(model, geometry, 0, 1);
		const slot = pool.rows[0].cells[1];

		renderer.renderSkeleton(slot, cell, model);
		expect(resolveItemCardModel).not.toHaveBeenCalled();
		expect(slot.root.classList.contains("is-skeleton")).toBe(true);
		expect(slot.root.classList.contains("has-shell-title")).toBe(true);
		expect(slot.title.textContent).toBe("Shell title");

		if (!cell) throw new Error("expected item cell");
		renderer.renderShell(slot, cell, model);
		expect(resolveItemCardModel).toHaveBeenCalledOnce();
		expect(slot.title.textContent).toBe("Resolved title");
		expect(slot.title.querySelector(".ccl-search-highlight")?.textContent).toBe(
			"Resolved",
		);
		expect(slot.root.dataset.cclInteractionId).toBe("item:missing");
		expect(slot.root.classList.contains("is-skeleton")).toBe(false);
		expect(slot.root.classList.contains("has-shell-title")).toBe(false);
	});

	it("renders a section title in a skeleton header", () => {
		const { model, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const renderer = createTwoHopShellRenderer({});
		const header = resolveTwoHopCell(model, geometry, 0, 0);
		const slot = pool.rows[0].cells[0];

		renderer.renderSkeleton(slot, header, model);

		expect(slot.title.textContent).toBe("New links");
		expect(slot.root.classList.contains("has-shell-title")).toBe(true);
	});

	it("retains the preview when its activation identity is unchanged", () => {
		const { model, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const resolveItemCardModel = vi.fn(() => ({
			item: model.sections[0].getItem(0).item,
			targetFile: {
				path: "notes/missing.md",
				extension: "md",
			} as TFile,
			title: "Resolved title",
			ariaLabel: "Open Resolved title",
			className: null,
			extension: null,
			directory: null,
			interactionId: "item:missing",
			interactionKey: "item:missing",
			presentation: undefined,
			searchQuery: "",
			searchScope: "title-only" as const,
			contentPreview: undefined,
			previewRefreshToken: 0,
			previewActivationIdentity: "preview:notes/missing.md",
		}));
		const renderer = createTwoHopShellRenderer({ resolveItemCardModel });
		const cell = resolveTwoHopCell(model, geometry, 0, 1);
		if (!cell) throw new Error("expected item cell");
		const slot = pool.rows[0].cells[1];
		renderer.renderShell(slot, cell, model);
		const disposePreview = vi.fn();
		const generation = slot.generation;
		installPreview(slot, document.createElement("strong"), disposePreview);

		renderer.invalidateCardModels();
		renderer.renderShell(slot, cell, model);

		expect(resolveItemCardModel).toHaveBeenCalledTimes(2);
		expect(disposePreview).not.toHaveBeenCalled();
		expect(slot.generation).toBe(generation + 1);
		expect(slot.previewStatus).toBe("empty");
		expect(slot.previewHost.childElementCount).toBe(1);
	});

	it("retains the preview across temporary row hiding", () => {
		const { model, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const resolveItemCardModel = vi.fn(() => ({
			item: model.sections[0].getItem(0).item,
			targetFile: {
				path: "notes/missing.md",
				extension: "md",
			} as TFile,
			title: "Resolved title",
			ariaLabel: "Open Resolved title",
			className: null,
			extension: null,
			directory: null,
			interactionId: "item:missing",
			interactionKey: "item:missing",
			presentation: undefined,
			searchQuery: "",
			searchScope: "title-only" as const,
			contentPreview: undefined,
			previewRefreshToken: 0,
			previewActivationIdentity: "preview:notes/missing.md",
		}));
		const renderer = createTwoHopShellRenderer({ resolveItemCardModel });
		const cell = resolveTwoHopCell(model, geometry, 0, 1);
		if (!cell) throw new Error("expected item cell");
		const row = pool.rows[0];
		const slot = row.cells[1];
		pool.positionRow(row, 0, 0);
		renderer.renderShell(slot, cell, model);
		const disposePreview = vi.fn();
		const preview = document.createElement("strong");
		installPreview(slot, preview, disposePreview);

		pool.hideRow(row);
		pool.positionRow(row, 0, 0);
		renderer.invalidateCardModels();
		renderer.renderShell(slot, cell, model);

		expect(slot.previewHost.firstChild).toBe(preview);
		expect(disposePreview).not.toHaveBeenCalled();
		expect(slot.logicalIdentity).toBe(cell.logicalKey);
	});

	it("discards a retained preview when its activation identity changes", () => {
		const { model, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		let previewActivationIdentity = "preview:notes/missing.md:query-a";
		const resolveItemCardModel = vi.fn(() => ({
			item: model.sections[0].getItem(0).item,
			targetFile: {
				path: "notes/missing.md",
				extension: "md",
			} as TFile,
			title: "Resolved title",
			ariaLabel: "Open Resolved title",
			className: null,
			extension: null,
			directory: null,
			interactionId: "item:missing",
			interactionKey: "item:missing",
			presentation: undefined,
			searchQuery: "",
			searchScope: "title-and-content" as const,
			contentPreview: undefined,
			previewRefreshToken: 0,
			previewActivationIdentity,
		}));
		const renderer = createTwoHopShellRenderer({ resolveItemCardModel });
		const cell = resolveTwoHopCell(model, geometry, 0, 1);
		if (!cell) throw new Error("expected item cell");
		const slot = pool.rows[0].cells[1];
		renderer.renderShell(slot, cell, model);
		const disposePreview = vi.fn();
		const generation = slot.generation;
		installPreview(slot, document.createElement("strong"), disposePreview);

		previewActivationIdentity = "preview:notes/missing.md:query-b";
		renderer.invalidateCardModels();
		renderer.renderShell(slot, cell, model);

		expect(resolveItemCardModel).toHaveBeenCalledTimes(2);
		expect(disposePreview).toHaveBeenCalledOnce();
		expect(slot.previewHost.childElementCount).toBe(0);
		expect(slot.previewStatus).toBe("empty");
		expect(slot.generation).toBe(generation + 1);
	});

	it("renders section headers as title and icon without a visible count", () => {
		const { model, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const renderer = createTwoHopShellRenderer({});
		const header = resolveTwoHopCell(model, geometry, 0, 0);
		if (!header) throw new Error("expected header cell");

		const slot = pool.rows[0].cells[0];
		renderer.renderShell(slot, header, model);
		pool.hideRow(pool.rows[0]);
		pool.positionRow(pool.rows[0], 0, 0);
		renderer.renderShell(slot, header, model);

		expect(slot.title.textContent).toBe("New links");
		expect(slot.meta.textContent).toBe("");
		expect(slot.titleWrapper.className).toBe("cosense-card-links__title-container");
		expect(slot.meta.style.display).toBe("none");
		expect(slot.headerIcon.style.display).toBe("");
		expect(slot.headerIcon.dataset.cclIconName).toBe("Unlink");
		expect(
			slot.headerIcon.querySelectorAll("path, circle, rect, line").length,
		).toBeGreaterThan(0);
	});

	it("renders load more with the original centered ellipsis icon", () => {
		const { model, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const renderer = createTwoHopShellRenderer({});
		const loadMore = resolveTwoHopCell(model, geometry, 1, 0);
		if (!loadMore || loadMore.kind !== "load-more") {
			throw new Error("expected load-more cell");
		}

		renderer.renderShell(pool.rows[0].cells[0], loadMore, model);

		const slot = pool.rows[0].cells[0];
		expect(
			slot.root.classList.contains("cosense-card-links__load-more-button"),
		).toBe(true);
		expect(slot.title.textContent).toBe("");
		expect(slot.meta.style.display).toBe("none");
		expect(slot.previewHost.style.display).toBe("none");
		expect(slot.headerIcon.dataset.cclIconName).toBe("Ellipsis");
		expect(slot.headerIcon.getAttribute("width")).toBe("28");
		expect(slot.headerIcon.getAttribute("height")).toBe("28");
		expect(slot.headerIcon.querySelectorAll("circle")).toHaveLength(3);
	});
});
