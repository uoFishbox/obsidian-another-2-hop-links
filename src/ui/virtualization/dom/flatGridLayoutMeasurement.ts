import { computeVirtualGridLayout } from "../layout/flatGridLayout";
import { resolveCardGridLayoutBase } from "./virtualListCardLayout";
import { resolveVirtualListLayoutStability } from "./virtualListMeasurementStability";
import { resolveCardLayoutSettings } from "ui/shared/layout/cardLayoutCssVars";

export const DEFAULT_FLAT_GRID_CARD_LAYOUT = resolveCardLayoutSettings();

export const DEFAULT_FLAT_GRID_LAYOUT = computeVirtualGridLayout({
	containerWidth: DEFAULT_FLAT_GRID_CARD_LAYOUT.cardWidthPx,
	minCellWidth: DEFAULT_FLAT_GRID_CARD_LAYOUT.cardWidthPx,
	gap: DEFAULT_FLAT_GRID_CARD_LAYOUT.cardGapPx,
	maxColumns: DEFAULT_FLAT_GRID_CARD_LAYOUT.cardMaxColumns,
	rowHeight: DEFAULT_FLAT_GRID_CARD_LAYOUT.cardHeightPx,
	cellCount: 0,
});

export type VirtualGridLayout = typeof DEFAULT_FLAT_GRID_LAYOUT;
export type ConfiguredCardLayout = ReturnType<typeof resolveCardLayoutSettings>;

export interface ResolveFlatGridLayoutMeasurementParams {
	rootEl: HTMLElement;
	rootRect: DOMRect;
	measuredWidth: number | null;
	configuredLayout: ConfiguredCardLayout | null;
	logicalCellCount: number;
	hasRenderableItems: boolean;
}

export interface FlatGridLayoutMeasurement {
	layout: VirtualGridLayout;
	hasRenderableContent: boolean;
	hasStableLayout: boolean;
}

export const isSameFlatGridLayout = (
	current: VirtualGridLayout,
	next: VirtualGridLayout,
): boolean =>
	current.containerWidth === next.containerWidth &&
	current.columns === next.columns &&
	current.cellWidth === next.cellWidth &&
	current.gap === next.gap &&
	current.rowHeight === next.rowHeight &&
	current.rowCount === next.rowCount &&
	current.rowStride === next.rowStride &&
	current.contentHeight === next.contentHeight;

export function resolveFlatGridLayoutMeasurement({
	rootEl,
	rootRect,
	measuredWidth,
	configuredLayout,
	logicalCellCount,
	hasRenderableItems,
}: ResolveFlatGridLayoutMeasurementParams): FlatGridLayoutMeasurement {
	const layoutBase = resolveCardGridLayoutBase({
		rootEl,
		rootRect,
		measuredWidth,
		defaults: DEFAULT_FLAT_GRID_CARD_LAYOUT,
		configuredLayout,
		includeSectionMarginBottom: false,
	});
	const layout = computeVirtualGridLayout({
		containerWidth: layoutBase.containerWidth,
		minCellWidth: layoutBase.cardLayout.cardWidthPx,
		gap: layoutBase.gap,
		maxColumns: layoutBase.columns,
		rowHeight: layoutBase.rowHeight,
		cellCount: logicalCellCount,
	});
	const layoutStability = resolveVirtualListLayoutStability({
		rootEl,
		rootRect,
		measuredWidth,
		hasRenderableContent: hasRenderableItems,
	});

	return {
		layout,
		hasRenderableContent: hasRenderableItems,
		hasStableLayout: layoutStability.isStable,
	};
}
