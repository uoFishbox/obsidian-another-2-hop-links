import { describe, expect, it, vi } from "vitest";
import { createTwoHopDomPool } from "../twoHopDomPool";
import { createTwoHopShellRenderer } from "../twoHopShellRenderer";
import { createTwoHopSnapshot } from "../twoHopSnapshot";
import { createTwoHopGeometry, resolveTwoHopCell } from "../twoHopGeometry";
import type { TwoHopVirtualSectionDescriptor } from "../twoHopVirtualListModel";
import type { TwoHopVirtualListItem } from "../twoHopVirtualListModel";

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
		headerProps: {},
	} satisfies TwoHopVirtualSectionDescriptor;
	const snapshot = createTwoHopSnapshot({
		sections: [descriptor],
		visibleCounts: { new: 1 },
		initialVisibleCount: 1,
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
		expect(pool.rows[0].root.style.transform).toContain("2200px");
	});

	it("renders a cheap skeleton before resolving a rich card model", () => {
		const { snapshot, geometry } = createFixture();
		const content = document.createElement("div");
		const pool = createTwoHopDomPool({ content, rowCapacity: 2, columns: 2 });
		const resolveItemCardModel = vi.fn(() => ({
			item: snapshot.sections[0].items[0].item,
			targetFile: null,
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
			previewActivationIdentity: undefined,
		}));
		const renderer = createTwoHopShellRenderer({ resolveItemCardModel });
		const cell = resolveTwoHopCell(snapshot, geometry, 0, 1);
		const slot = pool.rows[0].cells[1];

		renderer.renderSkeleton(slot, cell, snapshot);
		expect(resolveItemCardModel).not.toHaveBeenCalled();
		expect(slot.root.classList.contains("is-skeleton")).toBe(true);

		if (!cell) throw new Error("expected item cell");
		renderer.renderShell(slot, cell, snapshot);
		expect(resolveItemCardModel).toHaveBeenCalledOnce();
		expect(slot.title.textContent).toBe("Resolved title");
		expect(slot.root.dataset.cclInteractionId).toBe("item:missing");
		expect(slot.root.classList.contains("is-skeleton")).toBe(false);
	});
});
