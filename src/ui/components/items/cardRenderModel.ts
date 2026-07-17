import type { TFile } from "obsidian";
import type { ViewItem } from "application/presenters";
import { getItemStrategy } from "application/presenters";
import { ARIA_LABELS } from "../../../appConstants";
import { getPriorityFrontmatterCardTitle } from "core/frontmatterCardTitle";
import { buildCardPreviewActivationIdentity } from "features/preview/core/cardPreviewActivationIdentity";
import { normalizePreviewQuery } from "features/preview/core/previewRenderKeys";
import type { PreviewData } from "features/preview/public-types";
import { formatLinkText } from "features/preview/text-processing/textUtils";
import type { LinkUtilitiesContext } from "types/linkContext";
import type { PluginSettings } from "types/settings";
import type { CardPresentationState } from "ui/components/common/cardPresentation";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";

export interface CardRenderModel {
	readonly item: ViewItem;
	readonly targetFile: TFile | null;
	readonly title: string;
	readonly ariaLabel: string;
	readonly className: string | null;
	readonly extension: string | null;
	readonly directory: string | null;
	readonly interactionId: string;
	readonly interactionKey: string;
	readonly presentation: CardPresentationState | undefined;
	readonly searchQuery: string;
	readonly searchScope: "title-only" | "title-and-content";
	readonly contentPreview: string | undefined;
	readonly previewRefreshToken: number;
	readonly previewActivationIdentity: string | undefined;
}

export interface CreateCardRenderModelParams {
	readonly item: ViewItem;
	readonly settings: PluginSettings;
	readonly context: LinkUtilitiesContext;
	readonly getPreviewRenderVersion: (path: string) => string;
	readonly searchQuery?: string;
	readonly searchScope?: "title-only" | "title-and-content";
	readonly contentPreview?: string;
	readonly previewRefreshToken?: number;
	readonly interactionId?: string;
	readonly interactionKey?: string;
	readonly presentation?: CardPresentationState;
}

/** Compiles all display-only values needed to render one item card. */
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
	const previewRefreshToken = params.previewRefreshToken ?? 0;
	const interactionKey =
		params.interactionKey ?? createItemInteractionKey(params.item);
	const interactionId = params.interactionId ?? interactionKey;
	const previewOverride = createTextPreviewOverride(targetFile, contentPreview);
	const effectiveSearchQuery = searchScope === "title-only" ? "" : searchQuery;

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
		directory: targetFile?.parent?.path ?? null,
		interactionId,
		interactionKey,
		presentation: params.presentation,
		searchQuery,
		searchScope,
		contentPreview,
		previewRefreshToken,
		previewActivationIdentity: targetFile
			? buildCardPreviewActivationIdentity(
					targetFile,
					params.settings,
					normalizePreviewQuery(effectiveSearchQuery),
					params.getPreviewRenderVersion(targetFile.path),
					previewRefreshToken,
					previewOverride,
				)
			: undefined,
	};
}

function resolveCardTitle(
	item: ViewItem,
	targetFile: TFile | null,
	settings: PluginSettings,
	context: LinkUtilitiesContext,
): string {
	if (targetFile) {
		return (
			getPriorityFrontmatterCardTitle(
				targetFile,
				settings.priorityFrontmatterKeyForTitle,
				context.getMetadata,
			) ?? context.fileToLinktext(targetFile, context.sourceFile.path, true)
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
