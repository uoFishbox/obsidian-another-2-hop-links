import { resolveCardGridLayoutBase } from "cards/grid/layout/cardGridLayout";
import {
	resolveCardLayoutSettings,
	type ResolvedCardLayoutSettings,
} from "cards/layout/cardLayoutCssVars";

/** Resolved geometry for the two-hop virtual grid. */
export interface TwoHopGridLayout {
	containerWidth: number;
	columns: number;
	cellWidth: number;
	rowHeight: number;
	gap: number;
	sectionMarginBottom: number;
}

export const DEFAULT_TWO_HOP_GRID_CARD_LAYOUT = resolveCardLayoutSettings();

export const DEFAULT_TWO_HOP_GRID_LAYOUT: TwoHopGridLayout = {
	containerWidth: DEFAULT_TWO_HOP_GRID_CARD_LAYOUT.cardWidthPx,
	columns: 1,
	cellWidth: DEFAULT_TWO_HOP_GRID_CARD_LAYOUT.cardWidthPx,
	rowHeight: DEFAULT_TWO_HOP_GRID_CARD_LAYOUT.cardHeightPx,
	gap: DEFAULT_TWO_HOP_GRID_CARD_LAYOUT.cardGapPx,
	sectionMarginBottom: DEFAULT_TWO_HOP_GRID_CARD_LAYOUT.sectionMarginBottomPx,
};

export const isSameTwoHopGridLayout = (
	current: TwoHopGridLayout,
	next: TwoHopGridLayout,
): boolean =>
	current.containerWidth === next.containerWidth &&
	current.columns === next.columns &&
	current.cellWidth === next.cellWidth &&
	current.rowHeight === next.rowHeight &&
	current.gap === next.gap &&
	current.sectionMarginBottom === next.sectionMarginBottom;

export interface ResolveTwoHopGridLayoutParams {
	readonly rootEl: HTMLElement;
	readonly sectionRect: DOMRect;
	readonly measuredWidth: number | null;
	readonly configuredLayout: ResolvedCardLayoutSettings | null;
}

/** Resolves committed grid geometry from one section measurement. */
export function resolveTwoHopGridLayout(
	params: ResolveTwoHopGridLayoutParams,
): TwoHopGridLayout {
	const layoutBase = resolveCardGridLayoutBase({
		rootEl: params.rootEl,
		rootRect: params.sectionRect,
		measuredWidth:
			params.sectionRect.width > 0
				? params.sectionRect.width
				: params.measuredWidth,
		defaults: DEFAULT_TWO_HOP_GRID_CARD_LAYOUT,
		configuredLayout: params.configuredLayout,
	});
	return {
		containerWidth: layoutBase.containerWidth,
		columns: layoutBase.columns,
		cellWidth: layoutBase.cellWidth,
		rowHeight: layoutBase.rowHeight,
		gap: layoutBase.gap,
		sectionMarginBottom: Math.max(0, layoutBase.cardLayout.sectionMarginBottomPx),
	};
}
