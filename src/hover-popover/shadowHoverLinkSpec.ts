import type { CachedMetadataWithLinkReferences } from "indexing/model";
import type { TFile } from "obsidian";
import type { AppContext, LinkInteractionOptions } from "cards/context/linkContext";
import type { InteractionDescriptor } from "cards/interactions/interactionTypes";
import {
	isPromiseLike,
	resolveDescriptorInteractionOptionsAsync,
} from "cards/interactions/interactionTypes";
import {
	buildHoverPopoverLinkSpec,
	type HoverPopoverLinkSpec,
} from "hover-popover/hoverPopoverLinkSpec";
import { hydrateRuntimeBacklinkHoverLink } from "cards/context/runtimeBacklinkPositionResolver";

export function buildShadowHoverLinkSpec(
	descriptor: InteractionDescriptor | undefined,
	appContext: AppContext | undefined,
): HoverPopoverLinkSpec | null | Promise<HoverPopoverLinkSpec | null> {
	if (!descriptor?.targetFile || descriptor.hoverPreviewEnabled === false) {
		return null;
	}
	const targetFile = descriptor.targetFile;

	const options = resolveDescriptorInteractionOptionsAsync(descriptor, appContext);
	if (isPromiseLike(options)) {
		return options.then((resolvedOptions) =>
			buildResolvedShadowHoverLinkSpec(
				descriptor,
				targetFile,
				appContext,
				resolvedOptions,
			),
		);
	}

	return buildResolvedShadowHoverLinkSpec(
		descriptor,
		targetFile,
		appContext,
		options,
	);
}

function buildResolvedShadowHoverLinkSpec(
	descriptor: InteractionDescriptor,
	targetFile: TFile,
	appContext: AppContext | undefined,
	options: LinkInteractionOptions,
): HoverPopoverLinkSpec | null {
	const highlightMode = options.highlightMode ?? "auto";
	const preferredPosition = options.preferredPosition;

	if (descriptor.kind === "sectionHeader") {
		return buildHoverPopoverLinkSpec(
			descriptor.link,
			targetFile,
			descriptor.settings,
			descriptor.isOutgoingLink,
			highlightMode,
		);
	}

	switch (descriptor.item.type) {
		case "taggedNote":
			return buildHoverPopoverLinkSpec(
				{
					rawText: descriptor.item.data.file.basename,
					path: descriptor.item.data.path,
					sourceFile: descriptor.item.data.file,
					isUnresolved: false,
					position: preferredPosition ?? descriptor.item.data.position,
				},
				targetFile,
				descriptor.settings,
				false,
				highlightMode,
			);
		case "branch": {
			const preferSearchMatch = highlightMode === "force" && !!preferredPosition;
			return buildHoverPopoverLinkSpec(
				preferSearchMatch
					? {
							...descriptor.item.data.hop1,
							position: preferredPosition,
						}
					: descriptor.item.data.hop1,
				targetFile,
				descriptor.settings,
				!preferSearchMatch,
				highlightMode,
			);
		}
		case "backlink":
			return buildHoverPopoverLinkSpec(
				preferredPosition
					? {
							...descriptor.item.data,
							position: preferredPosition,
						}
					: hydrateRuntimeBacklinkHoverLink(
							(appContext?.linkContext.getMetadata(
								descriptor.item.data.sourceFile,
							) as CachedMetadataWithLinkReferences | null) ?? null,
							descriptor.item.data,
							appContext?.app?.metadataCache,
						),
				targetFile,
				descriptor.settings,
				false,
				highlightMode,
			);
		case "file":
			return buildHoverPopoverLinkSpec(
				{
					rawText: descriptor.item.data.basename,
					path: descriptor.item.data.path,
					sourceFile: descriptor.item.data,
					isUnresolved: false,
					position: preferredPosition,
				},
				targetFile,
				descriptor.settings,
				false,
				highlightMode,
			);
		case "newLink":
		default:
			return null;
	}
}
