<script lang="ts">
	import { computeVirtualGridLayout } from "../../layout/flatGridLayout";
	import { createFlatLogicalCellSource } from "../../flatLogicalCellSource";
	import { createFlatLinkRowModel } from "../../row-models/flatLinkRowModel";
	import { buildMountedVirtualGridCellsFromRowModel } from "../../core/reconciliation/linkListVirtualLayout";
	import { useVirtualList } from "../useVirtualList.svelte";

	interface TestItem {
		id: string;
	}

	interface Props {
		onSurfacePublication: () => void;
	}

	const { onSurfacePublication }: Props = $props();
	const items = Array.from({ length: 12 }, (_, index) => ({
		id: `item-${index}`,
	}));
	const cellSource = createFlatLogicalCellSource({
		header: false,
		items,
		visibleCount: items.length,
		showLoadMore: false,
		getKey: (item: TestItem) => item.id,
		sectionId: "publication-harness",
	});
	const layout = computeVirtualGridLayout({
		containerWidth: 320,
		minCellWidth: 100,
		gap: 10,
		maxColumns: 3,
		rowHeight: 100,
		cellCount: cellSource.cellCount,
	});
	const rowModel = createFlatLinkRowModel({ cellSource, layout });
	const virtualList = useVirtualList({
		buildMountedCells: buildMountedVirtualGridCellsFromRowModel<TestItem>,
	});

	const applyMeasurement = (
		previewVisible: { start: number; end: number },
		isScrollActive: boolean,
	): void => {
		virtualList.applyMeasurement({
			rowModel,
			scrollTop: 0,
			viewportHeight: 100,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: true,
			isScrollActive,
			precomputedRanges: {
				mounted: { start: 0, end: 3 },
				previewVisible,
			},
			visibilityPolicy: {
				bootstrapRows: 3,
				mountedOverscanPx: 0,
			},
		});
	};

	$effect(() => {
		virtualList.getSnapshot();
		onSurfacePublication();
	});
</script>

<button
	data-testid="initial"
	onclick={() => applyMeasurement({ start: 0, end: 1 }, false)}
>
	Initial
</button>
<button
	data-testid="preview-only"
	onclick={() => applyMeasurement({ start: 1, end: 2 }, false)}
>
	Preview only
</button>
<button data-testid="mode" onclick={() => applyMeasurement({ start: 2, end: 3 }, true)}>
	Mode
</button>
