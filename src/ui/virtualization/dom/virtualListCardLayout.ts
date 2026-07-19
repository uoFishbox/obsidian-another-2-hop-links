import {
	computeCardHeightPxFromWidth,
	normalizeCardHeightRatio,
	type ResolvedCardLayoutSettings,
} from "ui/utils/cardLayoutCssVars";
import { getOptionalOwnerWindow } from "ui/utils/realmSafeDom";
import { computeColumnCount } from "../core/gridLayout";

const parseCssNumber = (value: string, fallback: number): number => {
	const parsed = Number.parseFloat(value.trim());
	return Number.isFinite(parsed) ? parsed : fallback;
};

interface ResolveCardLayoutFromCssVarsOptions {
	includeSectionMarginBottom?: boolean;
}

export type CachedCardGridLayoutKind = "flat" | "view-plan";

export interface CachedCardGridLayoutBase {
	cardLayout: ResolvedCardLayoutSettings;
	containerWidth: number;
	columns: number;
	cellWidth: number;
	rowHeight: number;
	gap: number;
}

interface CssCardLayoutSnapshot {
	signature: string;
	layout: ResolvedCardLayoutSettings;
}

interface ResolveCachedCardGridLayoutBaseOptions {
	rootEl: HTMLElement;
	rootRect: DOMRect;
	measuredWidth: number | null;
	defaults: ResolvedCardLayoutSettings;
	listKind: CachedCardGridLayoutKind;
	scrollContainerEl?: HTMLElement | null;
	configuredLayout?: ResolvedCardLayoutSettings | null;
	includeSectionMarginBottom?: boolean;
}

const sharedCardGridLayoutCache = new WeakMap<
	HTMLElement,
	Map<string, CachedCardGridLayoutBase>
>();
const MAX_SHARED_CARD_GRID_LAYOUT_CACHE_ENTRIES = 48;

const createCssCardLayoutSnapshot = (
	rootEl: HTMLElement,
	defaults: ResolvedCardLayoutSettings,
	options?: ResolveCardLayoutFromCssVarsOptions,
): CssCardLayoutSnapshot => {
	const ownerWindow = getOptionalOwnerWindow(rootEl);
	if (!ownerWindow) {
		return {
			signature: "no-window",
			layout: defaults,
		};
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
	const signature = [
		cardWidthCssValue,
		fallbackCardHeightCssValue,
		cardHeightRatioCssValue,
		cardGapCssValue,
		cardMaxColumnsCssValue,
		sectionMarginBottomCssValue,
	].join("\u001f");
	return { signature, layout };
};

const createConfiguredCardLayoutSignature = (
	layout: ResolvedCardLayoutSettings,
	includeSectionMarginBottom: boolean,
): string =>
	[
		"configured",
		layout.cardWidthPx,
		layout.cardHeightRatio,
		layout.cardGapPx,
		layout.cardMaxColumns,
		includeSectionMarginBottom ? layout.sectionMarginBottomPx : "",
	].join("\u001f");

const resolveSharedLayoutCacheRoot = (
	rootEl: HTMLElement,
	scrollContainerEl: HTMLElement | null | undefined,
): HTMLElement =>
	scrollContainerEl ??
	rootEl.closest<HTMLElement>(".cosense-card-links__container") ??
	rootEl;

export function resolveCachedCardGridLayoutBase({
	rootEl,
	rootRect,
	measuredWidth,
	defaults,
	listKind,
	scrollContainerEl,
	configuredLayout,
	includeSectionMarginBottom,
}: ResolveCachedCardGridLayoutBaseOptions): CachedCardGridLayoutBase {
	const shouldIncludeSectionMarginBottom = includeSectionMarginBottom !== false;
	const layoutSnapshot = configuredLayout
		? {
				signature: createConfiguredCardLayoutSignature(
					configuredLayout,
					shouldIncludeSectionMarginBottom,
				),
				layout: configuredLayout,
			}
		: createCssCardLayoutSnapshot(rootEl, defaults, {
				includeSectionMarginBottom,
			});
	const cardLayout = layoutSnapshot.layout;
	const containerWidth = computeContainerWidth(
		measuredWidth,
		rootRect,
		rootEl,
		cardLayout.cardWidthPx,
	);
	const cacheRoot = resolveSharedLayoutCacheRoot(rootEl, scrollContainerEl);
	const cacheKey = [listKind, containerWidth, layoutSnapshot.signature].join(
		"\u001e",
	);
	let cacheForRoot = sharedCardGridLayoutCache.get(cacheRoot);
	if (!cacheForRoot) {
		cacheForRoot = new Map<string, CachedCardGridLayoutBase>();
		sharedCardGridLayoutCache.set(cacheRoot, cacheForRoot);
	}
	const cached = cacheForRoot.get(cacheKey);
	if (cached) {
		return cached;
	}

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
	const nextLayoutBase: CachedCardGridLayoutBase = {
		cardLayout,
		containerWidth,
		columns,
		cellWidth,
		rowHeight,
		gap,
	};
	if (
		cacheForRoot.size >= MAX_SHARED_CARD_GRID_LAYOUT_CACHE_ENTRIES &&
		!cacheForRoot.has(cacheKey)
	) {
		const oldestKey = cacheForRoot.keys().next().value;
		if (oldestKey) {
			cacheForRoot.delete(oldestKey);
		}
	}
	cacheForRoot.set(cacheKey, nextLayoutBase);
	return nextLayoutBase;
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
