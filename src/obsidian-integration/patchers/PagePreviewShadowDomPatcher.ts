import type { PluginHost } from "obsidian-integration/pluginHost";
import {
	disposeShadowHoverPopoverProxies,
	normalizeHoverPopoverTargetEl,
} from "preview/popover/hoverPopoverTarget";
import { getPagePreviewOnLinkHover } from "obsidian-integration/capabilities/obsidianInternals";
import { applyPatch } from "obsidian-integration/capabilities/applyPatch";
import { isEventLike } from "shared/ui/dom/realmSafeDom";

interface PagePreviewLike {
	onLinkHover: (
		parent: unknown,
		targetEl: HTMLElement | ShadowRoot | null,
		linkText: string,
		sourcePath: string,
		state?: unknown,
		...args: unknown[]
	) => unknown;
}

export function initPagePreviewShadowDomPatcher(plugin: PluginHost): void {
	plugin.register(() => {
		disposeShadowHoverPopoverProxies();
	});

	plugin.app.workspace.onLayoutReady(() => {
		patchPagePreviewInstance(plugin);
	});
}

function patchPagePreviewInstance(plugin: PluginHost): void {
	const capability = getPagePreviewOnLinkHover(plugin.app);
	if (!capability) {
		return;
	}

	applyPatch(plugin, {
		id: "page-preview:onLinkHover",
		target: capability.instance,
		method: "onLinkHover",
		wrap: (next) =>
			function (
				this: PagePreviewLike,
				parent: unknown,
				targetEl: HTMLElement | ShadowRoot | null,
				linkText: string,
				sourcePath: string,
				state?: unknown,
				...args: unknown[]
			) {
				const eventArg = args.find((entry): entry is Event =>
					isEventLike(entry),
				);
				const normalizedTargetEl = normalizeHoverPopoverTargetEl(
					targetEl,
					eventArg,
				);
				return next.call(
					this,
					parent,
					normalizedTargetEl,
					linkText,
					sourcePath,
					state,
					...args,
				);
			},
	});
}
