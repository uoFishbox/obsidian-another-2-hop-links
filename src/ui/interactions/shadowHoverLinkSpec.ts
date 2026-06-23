import type { CachedMetadataWithLinkReferences } from "types";
import type { AppContext } from "ui/context/linkContext";
import type { InteractionDescriptor } from "./interactionTypes";
import { resolveDescriptorInteractionOptions } from "./interactionTypes";
import {
	buildHoverPopoverLinkSpec,
	type HoverPopoverLinkSpec,
} from "features/preview/interactions/hoverPopoverLinkSpec";
import { hydrateRuntimeBacklinkLink } from "ui/context/runtimeBacklinkPositionResolver";

export function buildShadowHoverLinkSpec(
	descriptor: InteractionDescriptor | undefined,
	appContext: AppContext | undefined,
): HoverPopoverLinkSpec | null {
	if (!descriptor?.targetFile || descriptor.hoverPreviewEnabled === false) {
		return null;
	}

	const options = resolveDescriptorInteractionOptions(descriptor, appContext);
	const highlightMode = options.highlightMode ?? "auto";
	const preferredPosition = options.preferredPosition;

	if (descriptor.kind === "sectionHeader") {
		return buildHoverPopoverLinkSpec(
			descriptor.link,
			descriptor.targetFile,
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
				descriptor.targetFile,
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
				descriptor.targetFile,
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
					: hydrateRuntimeBacklinkLink(
							(appContext?.linkContext.getMetadata(
								descriptor.item.data.sourceFile,
							) as CachedMetadataWithLinkReferences | null) ?? null,
							descriptor.item.data,
						),
				descriptor.targetFile,
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
				descriptor.targetFile,
				descriptor.settings,
				false,
				highlightMode,
			);
		case "newLink":
		default:
			return null;
	}
}
