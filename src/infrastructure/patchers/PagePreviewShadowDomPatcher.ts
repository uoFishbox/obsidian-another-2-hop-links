import type { PluginHost } from "types/pluginHost";
import {
	disposeShadowHoverPopoverProxies,
	normalizeHoverPopoverTargetEl,
} from "features/popover/hoverPopoverTarget";
import { enableLogging, logger } from "shared/logging/logger";
import { getPagePreviewOnLinkHover } from "infrastructure/capabilities/obsidianInternals";
import { applyPatch } from "infrastructure/capabilities/applyPatch";
import {
	isEventLike,
	isHTMLElementLike,
	isMouseEventLike,
	isShadowRootLike,
} from "ui/shared/dom/realmSafeDom";

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

let hoverCallSequence = 0;

function describeTargetEl(
	targetEl: HTMLElement | ShadowRoot | null | undefined,
): string {
	return isHTMLElementLike(targetEl)
		? [
				targetEl.tagName.toLowerCase(),
				targetEl.id ? `#${targetEl.id}` : "",
				targetEl.dataset.cclInteractionId
					? `[${targetEl.dataset.cclInteractionId}]`
					: "",
			].join("")
		: isShadowRootLike(targetEl)
			? `<shadow-root:${targetEl.host.tagName.toLowerCase()}>`
			: String(targetEl ?? "<null>");
}

function describeHoverEvent(event: Event | undefined): Record<string, unknown> {
	if (!event) {
		return { eventType: null };
	}

	return {
		eventType: event.type,
		target: describeTargetEl(event.target as HTMLElement | ShadowRoot | null),
		currentTarget: describeTargetEl(
			event.currentTarget as HTMLElement | ShadowRoot | null,
		),
		relatedTarget:
			"relatedTarget" in event
				? describeTargetEl(
						(event as MouseEvent | FocusEvent).relatedTarget as
							| HTMLElement
							| ShadowRoot
							| null,
					)
				: undefined,
		ctrlKey: isMouseEventLike(event) ? event.ctrlKey : undefined,
		metaKey: isMouseEventLike(event) ? event.metaKey : undefined,
		altKey: isMouseEventLike(event) ? event.altKey : undefined,
		shiftKey: isMouseEventLike(event) ? event.shiftKey : undefined,
		isTrusted: event.isTrusted,
	};
}

function describeShortStack(limit = 6): string[] {
	return (new Error().stack ?? "")
		.split("\n")
		.slice(2, 2 + limit)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
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
		if (enableLogging)
			logger(
				"[PagePreviewShadowDomPatcher] Skipped page-preview patch: onLinkHover unavailable.",
			);
		return;
	}

	const applied = applyPatch(plugin, {
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
				const callId = ++hoverCallSequence;
				const eventArg = args.find((entry): entry is Event =>
					isEventLike(entry),
				);

				if (enableLogging)
					logger("[PagePreviewShadowDomPatcher] onLinkHover intercepted", {
						callId,
						sourcePath,
						linkText,
						incomingTargetEl: describeTargetEl(targetEl),
						stack: describeShortStack(),
						...describeHoverEvent(eventArg),
					});
				const normalizedTargetEl = normalizeHoverPopoverTargetEl(
					targetEl,
					eventArg,
				);
				if (enableLogging)
					logger(
						"[PagePreviewShadowDomPatcher] onLinkHover normalized target",
						{
							callId,
							sourcePath,
							linkText,
							incomingTargetEl: describeTargetEl(targetEl),
							normalizedTargetEl: describeTargetEl(normalizedTargetEl),
							targetChanged: normalizedTargetEl !== targetEl,
						},
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

	if (applied && enableLogging) {
		logger(
			"[PagePreviewShadowDomPatcher] Patched page-preview onLinkHover for Shadow DOM anchors.",
		);
	}
}
