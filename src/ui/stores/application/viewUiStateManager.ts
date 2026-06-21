import type { PluginSettings, SortOption } from "types/settings";

export interface SectionExpansionLimits {
	[sectionId: string]: number;
}

export function getSectionExpandedLimit(
	sectionExpansionLimits: SectionExpansionLimits,
	settings: PluginSettings,
	sectionId: string,
): number | undefined {
	const storedLimit = sectionExpansionLimits[sectionId];
	if (storedLimit === undefined) {
		return undefined;
	}

	const expandedLimit = normalizeExpandedLimit(storedLimit);
	if (expandedLimit <= getDefaultSectionVisibleLimit(settings)) {
		return undefined;
	}

	return expandedLimit;
}

export function getDefaultSectionVisibleLimit(
	settings: PluginSettings,
): number {
	return normalizeExpandedLimit(settings.defaultVisibleLinkCount);
}

export function setSectionExpandedLimit(
	sectionExpansionLimits: SectionExpansionLimits,
	sectionId: string,
	limit: number,
): SectionExpansionLimits {
	const nextLimit = normalizeExpandedLimit(limit);
	if (sectionExpansionLimits[sectionId] === nextLimit) {
		return sectionExpansionLimits;
	}

	return {
		...sectionExpansionLimits,
		[sectionId]: nextLimit,
	};
}

export function clearSectionExpandedLimit(
	sectionExpansionLimits: SectionExpansionLimits,
	sectionId: string,
): SectionExpansionLimits {
	if (sectionExpansionLimits[sectionId] === undefined) {
		return sectionExpansionLimits;
	}

	const nextLimits = { ...sectionExpansionLimits };
	delete nextLimits[sectionId];
	return nextLimits;
}

export function resolveSortOption(
	current: SortOption,
	next: SortOption,
): SortOption {
	return current === next ? current : next;
}

function normalizeExpandedLimit(limit: number): number {
	const floored = Math.floor(limit);
	return Number.isFinite(floored) ? Math.max(0, floored) : 0;
}
