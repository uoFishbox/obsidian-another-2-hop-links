export {
	useVirtualizer,
	type UseVirtualizerOptions,
	type VirtualizerMeasurementState,
	type VirtualListLayoutMeasurementResolution,
	type VirtualMeasurement,
	type VirtualListStableMeasurementContext,
} from "./runtime/useVirtualizer.svelte";
export {
	createResidentRowSlotAllocator,
	type ResidentRowSlotAllocator,
} from "./engine/mountedGridRows";
export {
	buildMountedGridRows,
	type MountedGridRow,
	type MountedGridRows,
} from "./engine/mountedGridRows";
export type { VirtualListSnapshot } from "./engine/snapshotComputation";
export type {
	StableScrollTopBand,
	VirtualScrollWindowRangeRowModel,
} from "./engine/scrollWindowResolver";
export {
	clampRange,
	EMPTY_ROW_RANGE,
	type MutableRowRange,
	type RowRange,
} from "./model/ranges";
export {
	computeVirtualRanges,
	resolveVirtualRangesInto,
	resolveVisibleRange,
	type VirtualVisibilityPolicy,
} from "./model/ranges";
export type {
	LogicalCellKey,
	MountedVirtualCell,
	MutableVirtualRanges,
	SourceKey,
	VirtualNavigationDirection,
	VirtualNavigationTarget,
	VirtualSequentialNavigationDirection,
	VirtualSequentialNavigationTarget,
	VirtualRanges,
	VirtualRow,
	VirtualRowModel,
} from "./model/types";
export { logicalCellKey, sourceKey } from "./model/types";
export type { FlatGridLayoutMetrics, VirtualRowLayoutMetrics } from "./model/types";
export {
	getScrollMetrics,
	type ProgrammaticScrollSnapshot,
} from "./viewport/measurement";
export { resolveVirtualListLayoutStability } from "./viewport/measurement";
export {
	computeColumnCount,
	computeFlatGridLayout,
	type FlatGridLayoutInput,
} from "./grid/layout";
export {
	createSectionedGridGeometry,
	type SectionedGridCellPosition,
	type SectionedGridGeometry,
	type SectionedGridGeometryInput,
	type SectionedGridRowPosition,
} from "./grid/layout";
