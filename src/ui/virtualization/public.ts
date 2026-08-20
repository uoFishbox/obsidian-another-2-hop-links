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
} from "./engine/residentRowPool";
export {
	buildMountedGridRows,
	type MountedGridRow,
	type MountedGridRows,
} from "./engine/mountedGridRows";
export type {
	MountedVirtualCellsBuild,
	VirtualListSnapshot,
} from "./engine/snapshotComputation";
export type {
	StableScrollTopBand,
	VirtualScrollWindowRangeRowModel,
} from "./engine/scrollWindowResolver";
export { clampRange, EMPTY_ROW_RANGE, type RowRange } from "./model/rowRange";
export {
	computeVirtualRanges,
	resolveVirtualRangesInto,
	resolveVisibleRange,
	type VirtualVisibilityPolicy,
} from "./model/ranges";
export type {
	LogicalCellKey,
	MountedVirtualCell,
	RowKey,
	SourceKey,
	VirtualNavigationDirection,
	VirtualNavigationTarget,
	VirtualRanges,
	VirtualRow,
	VirtualRowModel,
} from "./model/types";
export { logicalCellKey, sourceKey } from "./model/types";
export type {
	FlatGridLayoutMetrics,
	VirtualRowLayoutMetrics,
} from "./model/layoutMetrics";
export {
	getScrollMetrics,
	type ProgrammaticScrollSnapshot,
} from "./viewport/measurementAdapter";
export { resolveVirtualListLayoutStability } from "./viewport/measurementStability";
export {
	computeColumnCount,
	computeFlatGridLayout,
	type FlatGridLayoutInput,
} from "./grid/layout";
export {
	markVirtualScrollMeasurementRun,
	readVirtualScrollMeasurementEpoch,
	resetVirtualScrollMeasurementFrameForTests,
	shouldDeferPreviewActivationForVirtualScrollMeasurement,
} from "./runtime/virtualScrollMeasurementEpoch";
