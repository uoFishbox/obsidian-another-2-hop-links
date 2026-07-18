import { describe, expect, it, vi } from "vitest";
import { createTwoHopDomPool } from "../twoHopDomPool";
import { createTwoHopShellRenderer } from "../twoHopShellRenderer";
import { createTwoHopSnapshot } from "../twoHopSnapshot";
import { createTwoHopGeometry, resolveTwoHopCell } from "../twoHopGeometry";
import type { TwoHopVirtualSectionDescriptor } from "../twoHopVirtualListModel";
import type { TwoHopVirtualListItem } from "../twoHopVirtualListModel";
import type { TFile } from "obsidian";

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
	const snapshot = createTwoHopSnapshot({
		sections: [descriptor],
		visibleCounts: { new: 1 },
		initialVisibleCount: 1,
		resolveItemTitle: () => "Shell title",
	});
	const geometry = createTwoHopGeometry(snapshot, {
		containerWidth: 400,
		columns: 2,
		cellWidth: 195,
		rowHeight: 100,
		gap: 10,
		sectionMarginBottom: 20,
	});
	return { snapshot, geometry };
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
		expect(pool.rows[0].root.style.top).toBe("2200px");
		expect(pool.rows[0].root.style.transform).toBe("");
	});

	it("lets hidden pool rows hide cells after rendering and reuse", () => {
		const { snapshot, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const renderer = createTwoHopShellRenderer({});
		const cell = resolveTwoHopCell(snapshot, geometry, 0, 0);
		if (!cell) throw new Error("expected header cell");
		const row = pool.rows[0];
		const slot = row.cells[0];

		pool.positionRow(row, 0, 0);
		renderer.renderShell(slot, cell, snapshot);
		renderer.renderShell(slot, cell, snapshot);
		pool.hideRow(row);

		expect(row.root.style.visibility).toBe("hidden");
		expect(slot.cell.style.visibility).toBe("");
	});

	it("renders a cheap skeleton before resolving a rich card model", () => {
		const { snapshot, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 2, columns: 2 });
		const resolveItemCardModel = vi.fn(() => ({
			item: snapshot.sections[0].visibleItems[0].item,
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
		const renderer = createTwoHopShellRenderer({ resolveItemCardModel });
		const cell = resolveTwoHopCell(snapshot, geometry, 0, 1);
		const slot = pool.rows[0].cells[1];

		renderer.renderSkeleton(slot, cell, snapshot);
		expect(resolveItemCardModel).not.toHaveBeenCalled();
		expect(slot.root.classList.contains("is-skeleton")).toBe(true);
		expect(slot.root.classList.contains("has-shell-title")).toBe(true);
		expect(slot.title.textContent).toBe("Shell title");

		if (!cell) throw new Error("expected item cell");
		renderer.renderShell(slot, cell, snapshot);
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
		const { snapshot, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const renderer = createTwoHopShellRenderer({});
		const header = resolveTwoHopCell(snapshot, geometry, 0, 0);
		const slot = pool.rows[0].cells[0];

		renderer.renderSkeleton(slot, header, snapshot);

		expect(slot.title.textContent).toBe("New links");
		expect(slot.root.classList.contains("has-shell-title")).toBe(true);
	});

	it("retains the preview when its activation identity is unchanged", () => {
		const { snapshot, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const resolveItemCardModel = vi.fn(() => ({
			item: snapshot.sections[0].visibleItems[0].item,
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
		const cell = resolveTwoHopCell(snapshot, geometry, 0, 1);
		if (!cell) throw new Error("expected item cell");
		const slot = pool.rows[0].cells[1];
		renderer.renderShell(slot, cell, snapshot);
		const disposePreview = vi.fn();
		const generation = slot.generation;
		slot.previewStatus = "ready";
		slot.disposePreview = disposePreview;
		slot.previewHost.append(document.createElement("strong"));

		renderer.invalidateCardModels();
		renderer.renderShell(slot, cell, snapshot);

		expect(resolveItemCardModel).toHaveBeenCalledTimes(2);
		expect(disposePreview).not.toHaveBeenCalled();
		expect(slot.generation).toBe(generation + 1);
		expect(slot.previewStatus).toBe("empty");
		expect(slot.previewHost.childElementCount).toBe(1);
	});

	it("discards a retained preview when its activation identity changes", () => {
		const { snapshot, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		let previewActivationIdentity = "preview:notes/missing.md:query-a";
		const resolveItemCardModel = vi.fn(() => ({
			item: snapshot.sections[0].visibleItems[0].item,
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
		const cell = resolveTwoHopCell(snapshot, geometry, 0, 1);
		if (!cell) throw new Error("expected item cell");
		const slot = pool.rows[0].cells[1];
		renderer.renderShell(slot, cell, snapshot);
		const disposePreview = vi.fn();
		const generation = slot.generation;
		slot.previewStatus = "ready";
		slot.disposePreview = disposePreview;
		slot.previewHost.append(document.createElement("strong"));

		previewActivationIdentity = "preview:notes/missing.md:query-b";
		renderer.invalidateCardModels();
		renderer.renderShell(slot, cell, snapshot);

		expect(resolveItemCardModel).toHaveBeenCalledTimes(2);
		expect(disposePreview).toHaveBeenCalledOnce();
		expect(slot.previewHost.childElementCount).toBe(0);
		expect(slot.previewStatus).toBe("empty");
		expect(slot.generation).toBe(generation + 1);
	});

	it("renders section headers as title and icon without a visible count", () => {
		const { snapshot, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const renderer = createTwoHopShellRenderer({});
		const header = resolveTwoHopCell(snapshot, geometry, 0, 0);
		if (!header) throw new Error("expected header cell");

		renderer.renderShell(pool.rows[0].cells[0], header, snapshot);

		const slot = pool.rows[0].cells[0];
		expect(slot.title.textContent).toBe("New links");
		expect(slot.meta.textContent).toBe("");
		expect(slot.headerIcon.dataset.cclIconName).toBe("Unlink");
		expect(
			slot.headerIcon.querySelectorAll("path, circle, rect, line").length,
		).toBeGreaterThan(0);
	});

	it("renders load more with the original centered ellipsis icon", () => {
		const { snapshot, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
		const renderer = createTwoHopShellRenderer({});
		const loadMore = resolveTwoHopCell(snapshot, geometry, 1, 0);
		if (!loadMore || loadMore.kind !== "load-more") {
			throw new Error("expected load-more cell");
		}

		renderer.renderShell(pool.rows[0].cells[0], loadMore, snapshot);

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
