import type { TFile } from "obsidian";
import type { IndexedLink } from "indexing/model";
import type { InteractionSettings } from "cards/interactions/interactionTypes";
import type { HighlightMode } from "cards/context/linkContext";
import { isAdvancedCanvasPosition } from "obsidian-integration/files/fileRules";

export const COSENSE_CARD_LINKS_HOVER_SOURCE_ID = "cosense-card-links";
export const COSENSE_CARD_LINKS_HOVER_SOURCE_DISPLAY = "Cosense Card Links";

export interface HoverPopoverLinkSpec {
	linktext: string;
	sourcePath: string;
	state: unknown;
}

function resolveHoverLinktext(
	link: IndexedLink,
	targetFile: TFile,
	isOutgoingLink: boolean,
): string {
	let linktext = targetFile.path;
	if (!isOutgoingLink) {
		return linktext;
	}

	const hashIndex = link.rawText.lastIndexOf("#");
	if (hashIndex !== -1) {
		linktext += link.rawText.substring(hashIndex);
	}

	return linktext;
}

function resolveHoverHighlightEnabled(
	highlightMode: HighlightMode,
	settings?: Pick<InteractionSettings, "highlightInPreviewOnHover">,
): boolean {
	if (highlightMode === "force") {
		return true;
	}
	if (highlightMode === "suppress") {
		return false;
	}
	return settings?.highlightInPreviewOnHover ?? false;
}

function resolveHoverState(
	link: IndexedLink,
	targetFile: TFile,
	settings: Pick<InteractionSettings, "highlightInPreviewOnHover"> | undefined,
	isOutgoingLink: boolean,
	highlightMode: HighlightMode,
): unknown {
	const shouldHighlightPreview = resolveHoverHighlightEnabled(
		highlightMode,
		settings,
	);

	if (!shouldHighlightPreview || isOutgoingLink || !link.position) {
		return undefined;
	}

	if (targetFile.extension === "canvas" && isAdvancedCanvasPosition(link.position)) {
		return {
			match: {
				matches: [[0, link.position.end.offset]],
			},
		};
	}

	return {
		line: link.position.start.line,
		scroll: link.position.start.line,
	};
}

export function buildHoverPopoverLinkSpec(
	link: IndexedLink,
	targetFile: TFile,
	settings?: Pick<InteractionSettings, "highlightInPreviewOnHover">,
	isOutgoingLink = false,
	highlightMode: HighlightMode = "auto",
): HoverPopoverLinkSpec {
	return {
		linktext: resolveHoverLinktext(link, targetFile, isOutgoingLink),
		sourcePath: link.sourceFile.path,
		state: resolveHoverState(
			link,
			targetFile,
			settings,
			isOutgoingLink,
			highlightMode,
		),
	};
}
