import type { PluginHost } from "types/pluginHost";
import {
	disposeShadowHoverPopoverProxies,
	normalizeHoverPopoverTargetEl,
} from "features/popover/hoverPopoverTarget";
import { getPagePreviewOnLinkHover } from "infrastructure/capabilities/obsidianInternals";
import { applyPatch } from "infrastructure/capabilities/applyPatch";
import { isEventLike } from "ui/shared/dom/realmSafeDom";

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
