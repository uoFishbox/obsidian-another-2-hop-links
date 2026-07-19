import { resolveCardLayoutSettings } from "ui/utils/cardLayoutCssVars";

export interface ViewPlanLayoutMetrics {
	containerWidth: number;
	columns: number;
	cellWidth: number;
	rowHeight: number;
	gap: number;
	sectionMarginBottom: number;
}

export const DEFAULT_VIEW_PLAN_CARD_LAYOUT = resolveCardLayoutSettings();

export const DEFAULT_VIEW_PLAN_LAYOUT: ViewPlanLayoutMetrics = {
	containerWidth: DEFAULT_VIEW_PLAN_CARD_LAYOUT.cardWidthPx,
	columns: 1,
	cellWidth: DEFAULT_VIEW_PLAN_CARD_LAYOUT.cardWidthPx,
	rowHeight: DEFAULT_VIEW_PLAN_CARD_LAYOUT.cardHeightPx,
	gap: DEFAULT_VIEW_PLAN_CARD_LAYOUT.cardGapPx,
	sectionMarginBottom: DEFAULT_VIEW_PLAN_CARD_LAYOUT.sectionMarginBottomPx,
};

export const isSameViewPlanLayout = (
	current: ViewPlanLayoutMetrics,
	next: ViewPlanLayoutMetrics,
): boolean =>
	current.containerWidth === next.containerWidth &&
	current.columns === next.columns &&
	current.cellWidth === next.cellWidth &&
	current.rowHeight === next.rowHeight &&
	current.gap === next.gap &&
	current.sectionMarginBottom === next.sectionMarginBottom;
