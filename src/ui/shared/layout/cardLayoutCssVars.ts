import {
	DEFAULT_CARD_GAP_PX,
	DEFAULT_CARD_HEIGHT_PX,
	DEFAULT_CARD_HEIGHT_RATIO,
	DEFAULT_CARD_MAX_COLUMNS,
	DEFAULT_CARD_WIDTH_PX,
	DEFAULT_SECTION_MARGIN_BOTTOM_PX,
	type CardLayoutSettingKey,
	type PluginSettings,
} from "features/settings/model";

export type CardLayoutSettings = Partial<Pick<PluginSettings, CardLayoutSettingKey>>;

export interface ResolvedCardLayoutSettings {
	cardWidthPx: number;
	cardHeightPx: number;
	cardHeightRatio: number;
	cardGapPx: number;
	cardMaxColumns: number;
	sectionMarginBottomPx: number;
}

const normalizePositiveInteger = (
	value: number | undefined,
	fallback: number,
): number => {
	const normalized = Math.floor(value ?? fallback);
	if (!Number.isFinite(normalized) || normalized <= 0) {
		return fallback;
	}
	return normalized;
};

const normalizePositiveNumber = (
	value: number | undefined,
	fallback: number,
): number => {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return value;
};

function normalizeCardWidthPx(value: number | undefined): number {
	return normalizePositiveInteger(value, DEFAULT_CARD_WIDTH_PX);
}

export function normalizeCardHeightRatio(value: number | undefined): number {
	return normalizePositiveNumber(value, DEFAULT_CARD_HEIGHT_RATIO);
}

export function computeCardHeightPxFromWidth(
	widthPx: number,
	heightRatio: number,
): number {
	if (!Number.isFinite(widthPx) || widthPx <= 0) {
		return DEFAULT_CARD_HEIGHT_PX;
	}

	const ratio = normalizeCardHeightRatio(heightRatio);
	return Math.max(1, Math.round(widthPx * ratio));
}

export function resolveCardLayoutSettings(
	settings?: CardLayoutSettings,
): ResolvedCardLayoutSettings {
	const cardWidthPx = normalizeCardWidthPx(settings?.cardWidthPx);
	const cardHeightRatio = normalizeCardHeightRatio(settings?.cardHeightRatio);

	return {
		cardWidthPx,
		cardHeightRatio,
		cardHeightPx: computeCardHeightPxFromWidth(cardWidthPx, cardHeightRatio),
		cardGapPx: normalizePositiveInteger(settings?.cardGapPx, DEFAULT_CARD_GAP_PX),
		cardMaxColumns: normalizePositiveInteger(
			settings?.cardMaxColumns,
			DEFAULT_CARD_MAX_COLUMNS,
		),
		sectionMarginBottomPx: normalizePositiveInteger(
			settings?.sectionMarginBottomPx,
			DEFAULT_SECTION_MARGIN_BOTTOM_PX,
		),
	};
}

/**
 * Returns the previous resolved layout object when the layout-affecting
 * setting values are unchanged.
 */
export function createResolvedCardLayoutSettingsMemo(): (
	settings?: CardLayoutSettings | null,
) => ResolvedCardLayoutSettings | null {
	let previous: ResolvedCardLayoutSettings | null = null;

	return (settings) => {
		if (!settings) {
			previous = null;
			return null;
		}

		const cardWidthPx = normalizeCardWidthPx(settings.cardWidthPx);
		const cardHeightRatio = normalizeCardHeightRatio(settings.cardHeightRatio);
		const cardHeightPx = computeCardHeightPxFromWidth(cardWidthPx, cardHeightRatio);
		const cardGapPx = normalizePositiveInteger(
			settings.cardGapPx,
			DEFAULT_CARD_GAP_PX,
		);
		const cardMaxColumns = normalizePositiveInteger(
			settings.cardMaxColumns,
			DEFAULT_CARD_MAX_COLUMNS,
		);
		const sectionMarginBottomPx = normalizePositiveInteger(
			settings.sectionMarginBottomPx,
			DEFAULT_SECTION_MARGIN_BOTTOM_PX,
		);

		if (
			previous &&
			previous.cardWidthPx === cardWidthPx &&
			previous.cardHeightPx === cardHeightPx &&
			previous.cardHeightRatio === cardHeightRatio &&
			previous.cardGapPx === cardGapPx &&
			previous.cardMaxColumns === cardMaxColumns &&
			previous.sectionMarginBottomPx === sectionMarginBottomPx
		) {
			return previous;
		}

		previous = {
			cardWidthPx,
			cardHeightPx,
			cardHeightRatio,
			cardGapPx,
			cardMaxColumns,
			sectionMarginBottomPx,
		};
		return previous;
	};
}

export function getCardLayoutCssText(settings?: CardLayoutSettings): string {
	const layout = resolveCardLayoutSettings(settings);
	return [
		`--ccl-box-size: ${layout.cardWidthPx}px;`,
		`--ccl-box-height-ratio: ${layout.cardHeightRatio};`,
		`--ccl-box-height: ${layout.cardHeightPx}px;`,
		`--ccl-box-gap: ${layout.cardGapPx}px;`,
		`--ccl-box-cols-max: ${layout.cardMaxColumns};`,
		`--ccl-section-margin-bottom: ${layout.sectionMarginBottomPx}px;`,
	].join(" ");
}

export function applyCardLayoutCssVars(
	element: HTMLElement,
	settings?: CardLayoutSettings,
): void {
	const layout = resolveCardLayoutSettings(settings);
	element.style.setProperty("--ccl-box-size", `${layout.cardWidthPx}px`);
	element.style.setProperty("--ccl-box-height-ratio", `${layout.cardHeightRatio}`);
	element.style.setProperty("--ccl-box-height", `${layout.cardHeightPx}px`);
	element.style.setProperty("--ccl-box-gap", `${layout.cardGapPx}px`);
	element.style.setProperty("--ccl-box-cols-max", `${layout.cardMaxColumns}`);
	element.style.setProperty(
		"--ccl-section-margin-bottom",
		`${layout.sectionMarginBottomPx}px`,
	);
}
