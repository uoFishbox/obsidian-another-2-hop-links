import { computeFlatGridLayout, type VirtualRanges } from "cards/virtualization/public";
import {
	createVirtualizerEngine,
	type VirtualizerEngine,
	type VirtualListSnapshot,
} from "cards/virtualization/engine/virtualizer";
import { createFlatGridCellSource } from "../cellSource";
import type { FlatGridLogicalCell } from "../logicalCell";
import { buildMountedFlatGridRows, type MountedFlatGridBuild } from "../mountedRows";
import { createFlatGridRowModel, type FlatGridRowModel } from "../rowModel";
import { flattenMountedRowBindings } from "./mountedRowsTestHelpers";

export interface FlatGridHarnessItem {
	readonly id: string;
}

export type FlatGridHarnessSnapshot = VirtualListSnapshot<
	FlatGridLogicalCell<FlatGridHarnessItem>,
	MountedFlatGridBuild<FlatGridHarnessItem>
>;

export type FlatGridHarnessEngine = VirtualizerEngine<
	FlatGridLogicalCell<FlatGridHarnessItem>,
	FlatGridRowModel<FlatGridHarnessItem>,
	MountedFlatGridBuild<FlatGridHarnessItem>
>;

export interface FlatGridComputation {
	readonly snapshot: FlatGridHarnessSnapshot;
	readonly engine: FlatGridHarnessEngine;
}

interface HarnessEngineState {
	readonly engine: FlatGridHarnessEngine;
	buildMountedRows: typeof buildMountedFlatGridRows<FlatGridHarnessItem>;
}

// A snapshot is the only handle the engine hands back, so the harness keys the
// engine that produced it off the snapshot itself.
const engineStates = new WeakMap<FlatGridHarnessSnapshot, HarnessEngineState>();

export type FlatGridMountedCell = NonNullable<
	MountedFlatGridBuild<FlatGridHarnessItem>["rowsInMountedRange"][number]["bindings"][number]
>;

export function getHarnessMountedCells(
	build: MountedFlatGridBuild<FlatGridHarnessItem>,
): FlatGridMountedCell[] {
	return flattenMountedRowBindings(build.rowsInMountedRange);
}

export function createHarnessRowModel(
	count: number,
	sectionId = "engine-contract",
): FlatGridRowModel<FlatGridHarnessItem> {
	const items = Array.from({ length: count }, (_, index) => ({
		id: `item-${index}`,
	}));
	const cellSource = createFlatGridCellSource({
		header: false,
		items,
		visibleCount: items.length,
		showLoadMore: false,
		getItemId: (item) => item.id,
		sectionId,
	});
	const layout = computeFlatGridLayout({
		containerWidth: 320,
		minCellWidth: 100,
		gap: 10,
		maxColumns: 3,
		rowHeight: 100,
		cellCount: cellSource.cellCount,
	});

	return createFlatGridRowModel({ cellSource, layout });
}

export function computeHarnessSnapshot(params: {
	readonly rowModel: FlatGridRowModel<FlatGridHarnessItem>;
	readonly previous?: FlatGridHarnessSnapshot;
	readonly ranges?: VirtualRanges;
	readonly scrollTop?: number;
	readonly mountedOverscanPx?: number;
	readonly buildMountedRows?: typeof buildMountedFlatGridRows<FlatGridHarnessItem>;
}): FlatGridComputation {
	let state = params.previous ? engineStates.get(params.previous) : undefined;
	if (!state) {
		const nextState = {} as HarnessEngineState;
		const engine = createVirtualizerEngine<
			FlatGridLogicalCell<FlatGridHarnessItem>,
			FlatGridRowModel<FlatGridHarnessItem>,
			MountedFlatGridBuild<FlatGridHarnessItem>
		>({
			buildMountedRows: ({
				rowModel,
				rowRange,
				previousBuild,
				rowSlotAllocator,
			}) =>
				nextState.buildMountedRows({
					rowModel,
					rowRange,
					previousBuild,
					rowSlotAllocator,
				}),
		});
		state = Object.assign(nextState, {
			engine,
			buildMountedRows: params.buildMountedRows ?? buildMountedFlatGridRows,
		});
	} else {
		state.buildMountedRows = params.buildMountedRows ?? buildMountedFlatGridRows;
	}
	state.engine.applyRangeMeasurement(
		{
			scrollTop: params.scrollTop ?? 0,
			viewportHeight: 100,
			sectionTop: 0,
			hasValidScrollMetrics: true,
			isScrollActive: false,
			scrollGeneration: 0,
			source: "scroll",
		},
		params.rowModel,
		{
			bootstrapRows: 3,
			mountedOverscanPx: params.mountedOverscanPx ?? 0,
		},
		params.ranges,
	);
	const snapshot = state.engine.getSnapshot();
	if (!snapshot) {
		throw new Error("Expected a virtual-list snapshot.");
	}
	engineStates.set(snapshot, state);
	return {
		snapshot,
		engine: state.engine,
	};
}
