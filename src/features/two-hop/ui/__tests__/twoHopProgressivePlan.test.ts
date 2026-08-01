import { describe, expect, it } from "vitest";
import { createTwoHopDocument } from "features/two-hop/ui/twoHopDocument";
import { compileFixedGridLayout } from "features/two-hop/ui/viewport/twoHopGeometry";
import {
	appendTwoHopProgressivePlan,
	compileTwoHopProgressivePlan,
	resolveInitialProgressiveMountedRowEnd,
	resolveNextProgressiveMountedRowEnd,
	TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK,
} from "features/two-hop/ui/twoHopProgressivePlan";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import { createSectionDataRevision } from "features/two-hop/ui/twoHopRevisions";

function createSection(count: number): TwoHopVirtualSectionDescriptor {
	const items = Array.from({ length: count }, (_, index) => ({
		kind: "new-link",
		item: { type: "newLink" },
		searchKey: `item:${index}`,
		virtualKey: `item:${index}`,
	})) as TwoHopVirtualListItem[];
	return {
		sourceRevision: createSectionDataRevision(1),
		section: {
			kind: "new-links-section",
			rawSectionId: "section",
			sectionId: "section",
			sectionKey: "section",
			title: "Section",
		},
		sectionKey: "section",
		sectionId: "section",
		title: "Section",
		totalCount: count,
		loadedCount: count,
		getItems: () => items,
		getItem: (index) => items[index],
		headerProps: {},
	};
}

const layout = {
	containerWidth: 320,
	columns: 3,
	cellWidth: 100,
	rowHeight: 100,
	gap: 10,
	sectionMarginBottom: 20,
};

describe("TwoHop progressive chunk plan", () => {
	it("mounts two initial chunks and appends exactly one chunk", () => {
		const document = createTwoHopDocument({
			sections: [createSection(200)],
			visibleCounts: {},
			initialVisibleCount: 200,
		});
		const geometry = compileFixedGridLayout(document, layout);
		const initialEnd = resolveInitialProgressiveMountedRowEnd(geometry.rowCount);
		const initial = compileTwoHopProgressivePlan(document, geometry, initialEnd);

		expect(initialEnd).toBe(TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK * 2);
		expect(initial.chunks).toHaveLength(2);
		expect(initial.hasMoreRows).toBe(true);

		const nextEnd = resolveNextProgressiveMountedRowEnd(
			initial.mountedRowEnd,
			geometry.rowCount,
		);
		const appended = appendTwoHopProgressivePlan(
			document,
			geometry,
			initial,
			nextEnd,
		);
		expect(appended.chunks).toHaveLength(3);
		expect(appended.mountedRowEnd - initial.mountedRowEnd).toBe(
			TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK,
		);
		expect(appended.chunks[0]).toBe(initial.chunks[0]);
		expect(appended.chunks[1]).toBe(initial.chunks[1]);
		expect(appended.chunks[0]?.rows[0]).toBe(initial.chunks[0]?.rows[0]);
		expect(appended.chunks[0]?.rows[0]?.cells[0]).toBe(
			initial.chunks[0]?.rows[0]?.cells[0],
		);
	});

	it("preserves fixed row geometry across chunk boundaries", () => {
		const document = createTwoHopDocument({
			sections: [createSection(200)],
			visibleCounts: {},
			initialVisibleCount: 200,
		});
		const geometry = compileFixedGridLayout(document, layout);
		const plan = compileTwoHopProgressivePlan(
			document,
			geometry,
			resolveInitialProgressiveMountedRowEnd(geometry.rowCount),
		);
		const first = plan.chunks[0];
		const second = plan.chunks[1];

		expect(first.rowStart).toBe(0);
		expect(first.rowEnd).toBe(16);
		expect(first.height).toBe(16 * layout.rowHeight + 16 * layout.gap);
		expect(second.rowStart).toBe(16);
		expect(second.rows[0].top).toBe(0);
		expect(second.rows.at(-1)?.top).toBe(15 * (layout.rowHeight + layout.gap));
	});

	it("stops at the final partial chunk", () => {
		const document = createTwoHopDocument({
			sections: [createSection(4)],
			visibleCounts: {},
			initialVisibleCount: 4,
		});
		const geometry = compileFixedGridLayout(document, layout);
		const initialEnd = resolveInitialProgressiveMountedRowEnd(geometry.rowCount);
		const plan = compileTwoHopProgressivePlan(document, geometry, initialEnd);

		expect(plan.chunks).toHaveLength(1);
		expect(plan.mountedRowEnd).toBe(geometry.rowCount);
		expect(plan.hasMoreRows).toBe(false);
		expect(
			resolveNextProgressiveMountedRowEnd(plan.mountedRowEnd, geometry.rowCount),
		).toBe(plan.mountedRowEnd);
	});
});
