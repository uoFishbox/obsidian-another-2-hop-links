import {
	computeCardHeightPxFromWidth,
	normalizeCardHeightRatio,
	type ResolvedCardLayoutSettings,
} from "ui/shared/layout/cardLayoutCssVars";
import { getOptionalOwnerWindow } from "ui/shared/dom/realmSafeDom";
import { computeColumnCount } from "ui/virtualization/public";

const parseCssNumber = (value: string, fallback: number): number => {
	const parsed = Number.parseFloat(value.trim());
	return Number.isFinite(parsed) ? parsed : fallback;
};

interface ResolveCardLayoutFromCssVarsOptions {
	includeSectionMarginBottom?: boolean;
}

export interface CardGridLayoutBase {
	cardLayout: ResolvedCardLayoutSettings;
	containerWidth: number;
	columns: number;
	cellWidth: number;
	rowHeight: number;
	gap: number;
}

interface ResolveCardGridLayoutBaseOptions {
	rootEl: HTMLElement;
	rootRect: DOMRect;
	measuredWidth: number | null;
	defaults: ResolvedCardLayoutSettings;
	configuredLayout?: ResolvedCardLayoutSettings | null;
	includeSectionMarginBottom?: boolean;
}

const resolveCardLayoutFromCssVars = (
	rootEl: HTMLElement,
	defaults: ResolvedCardLayoutSettings,
	options?: ResolveCardLayoutFromCssVarsOptions,
): ResolvedCardLayoutSettings => {
	const ownerWindow = getOptionalOwnerWindow(rootEl);
	if (!ownerWindow) {
		return defaults;
	}

	const computedStyle = ownerWindow.getComputedStyle(rootEl);
	const cardWidthCssValue = computedStyle.getPropertyValue("--ccl-box-size");
	const fallbackCardHeightCssValue =
		computedStyle.getPropertyValue("--ccl-box-height");
	const cardHeightRatioCssValue = computedStyle.getPropertyValue(
		"--ccl-box-height-ratio",
	);
	const cardGapCssValue = computedStyle.getPropertyValue("--ccl-box-gap");
	const cardMaxColumnsCssValue = computedStyle.getPropertyValue("--ccl-box-cols-max");
	const includeSectionMarginBottom = options?.includeSectionMarginBottom !== false;
	const sectionMarginBottomCssValue = includeSectionMarginBottom
		? computedStyle.getPropertyValue("--ccl-section-margin-bottom")
		: "";
	const cardWidthPx = parseCssNumber(cardWidthCssValue, defaults.cardWidthPx);
	const fallbackCardHeightPx = parseCssNumber(
		fallbackCardHeightCssValue,
		defaults.cardHeightPx,
	);
	const cardHeightRatio = normalizeCardHeightRatio(
		parseCssNumber(cardHeightRatioCssValue, fallbackCardHeightPx / cardWidthPx),
	);
	const sectionMarginBottomPx = includeSectionMarginBottom
		? parseCssNumber(sectionMarginBottomCssValue, defaults.sectionMarginBottomPx)
		: defaults.sectionMarginBottomPx;
	const layout: ResolvedCardLayoutSettings = {
		cardWidthPx,
		cardHeightRatio,
		cardHeightPx: computeCardHeightPxFromWidth(cardWidthPx, cardHeightRatio),
		cardGapPx: parseCssNumber(cardGapCssValue, defaults.cardGapPx),
		cardMaxColumns: parseCssNumber(cardMaxColumnsCssValue, defaults.cardMaxColumns),
		sectionMarginBottomPx,
	};
	return layout;
};

export function resolveCardGridLayoutBase({
	rootEl,
	rootRect,
	measuredWidth,
	defaults,
	configuredLayout,
	includeSectionMarginBottom,
}: ResolveCardGridLayoutBaseOptions): CardGridLayoutBase {
	const cardLayout =
		configuredLayout ??
		resolveCardLayoutFromCssVars(rootEl, defaults, {
			includeSectionMarginBottom,
		});
	const containerWidth = computeContainerWidth(
		measuredWidth,
		rootRect,
		rootEl,
		cardLayout.cardWidthPx,
	);
	const gap = Math.max(0, cardLayout.cardGapPx);
	const columns = computeColumnCount({
		containerWidth,
		minCellWidth: cardLayout.cardWidthPx,
		gap,
		maxColumns: cardLayout.cardMaxColumns,
	});
	const cellWidth =
		columns <= 1
			? containerWidth
			: Math.max(0, (containerWidth - gap * (columns - 1)) / columns);
	const rowHeight = computeCardHeightPxFromWidth(
		cellWidth,
		cardLayout.cardHeightRatio,
	);
	return {
		cardLayout,
		containerWidth,
		columns,
		cellWidth,
		rowHeight,
		gap,
	};
}

export function computeContainerWidth(
	measuredWidth: number | null,
	rootRect: DOMRect,
	rootEl: HTMLElement,
	minCellWidth: number,
): number {
	const rawContainerWidth = measuredWidth ?? rootRect.width ?? rootEl.clientWidth;
	if (rawContainerWidth > 0) {
		return rawContainerWidth;
	}
	if (rootEl.clientWidth > 0) {
		return rootEl.clientWidth;
	}
	return minCellWidth;
}
