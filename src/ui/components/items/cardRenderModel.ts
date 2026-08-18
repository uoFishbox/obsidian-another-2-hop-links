import type { TFile } from "obsidian";
import type { ViewItem } from "application/presenters";
import { getItemStrategy } from "application/presenters";
import { ARIA_LABELS } from "../../../appConstants";
import { resolveFileCardTitle } from "core/frontmatterCardTitle";
import {
	compileCardPreviewRequest,
	type CardPreviewRequest,
} from "features/card-preview/core/cardPreviewRequest";
import type { PreviewData } from "features/card-preview/public-types";
import { formatLinkText } from "features/card-preview/text-processing/textUtils";
import type { LinkUtilitiesContext } from "types/linkContext";
import type { PluginSettings } from "features/settings/model";
import {
	createItemInteractionDescriptor,
	createItemInteractionKey,
	type ItemInteractionDescriptor,
} from "ui/interactions/interactionTypes";

export interface CardShellModel {
	readonly item: ViewItem;
	readonly targetFile: TFile | null;
	readonly title: string;
	readonly ariaLabel: string;
	readonly className: string | null;
	readonly extension: string | null;
	readonly interactionId: string;
	readonly searchQuery: string;
}

export interface PreviewModel {
	readonly previewRequest: CardPreviewRequest | null;
}

export interface InteractionModel {
	readonly interactionDescriptor: ItemInteractionDescriptor | null;
}

export interface CardRenderModel
	extends CardShellModel, PreviewModel, InteractionModel {}

export interface CardTitleSnapshot {
	readonly title: string;
	readonly targetFile: TFile | null;
}

export interface CreateCardRenderModelParams {
	readonly item: ViewItem;
	readonly settings: PluginSettings;
	readonly context: LinkUtilitiesContext;
	readonly getPreviewRenderVersion: (path: string) => string;
	readonly searchQuery?: string;
	readonly searchScope?: "title-only" | "title-and-content";
	readonly contentPreview?: string;
	readonly interactionId?: string;
}

/** Creates the card shell and memoizes preview/interaction models on first access. */
export function createCardRenderModel(
	params: CreateCardRenderModelParams,
): CardRenderModel {
	const strategy = getItemStrategy(params.item);
	const targetFile =
		strategy?.getTargetFile(params.item.data, params.context) ?? null;
	const className = strategy?.getClassName(params.item.data) ?? null;
	const title = resolveCardTitle(
		params.item,
		targetFile,
		params.settings,
		params.context,
	);
	const searchQuery = params.searchQuery ?? "";
	const searchScope = params.searchScope ?? "title-and-content";
	const contentPreview = params.contentPreview;
	const interactionId = params.interactionId ?? createItemInteractionKey(params.item);
	let previewRequest: CardPreviewRequest | null | undefined;
	let interactionDescriptor: ItemInteractionDescriptor | null | undefined;

	function resolvePreviewRequest(): CardPreviewRequest | null {
		if (previewRequest !== undefined) return previewRequest;
		if (!targetFile) {
			previewRequest = null;
			return previewRequest;
		}
		previewRequest = compileCardPreviewRequest({
			file: targetFile,
			searchQuery: searchScope === "title-only" ? "" : searchQuery,
			previewOverride: createTextPreviewOverride(targetFile, contentPreview),
			previewRenderVersion: params.getPreviewRenderVersion(targetFile.path),
			settings: params.settings,
		});
		return previewRequest;
	}

	function resolveInteractionDescriptor(): ItemInteractionDescriptor | null {
		if (interactionDescriptor !== undefined) return interactionDescriptor;
		interactionDescriptor = createItemInteractionDescriptor(
			params.item,
			params.settings,
			searchQuery,
			params.context,
			{ interactionId },
		);
		return interactionDescriptor;
	}

	return {
		item: params.item,
		targetFile,
		title,
		ariaLabel:
			params.item.type === "newLink"
				? ARIA_LABELS.UNRESOLVED_LINK
				: ARIA_LABELS.OPEN_LINK(title),
		className,
		extension: targetFile?.extension ?? null,
		interactionId,
		get interactionDescriptor() {
			return resolveInteractionDescriptor();
		},
		searchQuery,
		get previewRequest() {
			return resolvePreviewRequest();
		},
	};
}

/** Resolves only the file identity and display title needed by a card shell. */
export function resolveCardTitleSnapshot(
	item: ViewItem,
	settings: Pick<PluginSettings, "priorityFrontmatterKeyForTitle">,
	context: LinkUtilitiesContext,
): CardTitleSnapshot {
	const strategy = getItemStrategy(item);
	const targetFile = strategy?.getTargetFile(item.data, context) ?? null;

	return {
		targetFile,
		title: resolveCardTitle(item, targetFile, settings, context),
	};
}

function resolveCardTitle(
	item: ViewItem,
	targetFile: TFile | null,
	settings: Pick<PluginSettings, "priorityFrontmatterKeyForTitle">,
	context: LinkUtilitiesContext,
): string {
	if (targetFile) {
		return resolveFileCardTitle(
			targetFile,
			context.sourceFile.path,
			context.fileToLinktext,
			context.getMetadata,
			settings.priorityFrontmatterKeyForTitle,
		);
	}

	switch (item.type) {
		case "branch":
			return formatLinkText(item.data.hop1);
		case "backlink":
			return formatLinkText(item.data);
		case "taggedNote":
			return item.data.file.basename;
		case "file":
			return item.data.basename;
		case "newLink":
			return formatLinkText(item.data);
		default:
			return "";
	}
}

function createTextPreviewOverride(
	targetFile: TFile | null,
	contentPreview: string | undefined,
): PreviewData | null {
	if (!targetFile || targetFile.extension === "md" || !contentPreview) {
		return null;
	}

	return { type: "text", content: contentPreview };
}
