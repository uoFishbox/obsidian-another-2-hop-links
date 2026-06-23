import type { App, HoverPopover } from "obsidian";
import { type TFile, Platform, type Workspace } from "obsidian";
import type { TwoHopIndexedLink } from "types";
import type { PluginSettings } from "types/settings";
import type { PluginHost } from "types/pluginHost";
import type { HighlightMode } from "../public-types";
import {
	normalizeHoverPopoverTargetEl,
	resolveHoverPopoverTargetElement,
	resolveHoverPreviewTargetElement,
} from "./hoverPopoverTarget";
import {
	buildHoverPopoverLinkSpec,
	COSENSE_CARD_LINKS_HOVER_SOURCE_ID,
} from "./hoverPopoverLinkSpec";
import { enableLogging, logger } from "utils/logger";
import {
	ObsidianInternalFacade,
	type PagePreviewOnLinkHoverCapability,
} from "infrastructure/capabilities/ObsidianInternalFacade";
import { isHTMLElementLike, isShadowRootLike } from "ui/utils/realmSafeDom";

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

type HoverPopoverRequest = {
	targetEl: HTMLElement;
	linktext: string;
	sourcePath: string;
	state: unknown;
};

function buildHoverPopoverRequest(
	event: MouseEvent,
	link: TwoHopIndexedLink,
	targetFile: TFile,
	settings: PluginSettings,
	isOutgoingLink: boolean,
	highlightMode: HighlightMode,
): HoverPopoverRequest | null {
	const eventTargetEl = resolveHoverPreviewTargetElement(event);
	const targetEl = normalizeHoverPopoverTargetEl(eventTargetEl, event);
	if (enableLogging)
		logger("[HoverPopoverTrigger] triggerHoverPopover called", {
			eventType: event.type,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			altKey: event.altKey,
			shiftKey: event.shiftKey,
			eventTargetEl: describeTargetEl(eventTargetEl),
			normalizedTargetEl: describeTargetEl(targetEl),
			targetFile: targetFile.path,
			isOutgoingLink,
			highlightMode,
			sourcePath: link.sourceFile.path,
			linkPath: link.path,
		});

	if (!targetEl) {
		if (enableLogging)
			logger(
				"[HoverPopoverTrigger] triggerHoverPopover aborted: normalized target missing",
				{
					eventType: event.type,
					targetFile: targetFile.path,
					sourcePath: link.sourceFile.path,
				},
			);
		return null;
	}

	const spec = buildHoverPopoverLinkSpec(
		link,
		targetFile,
		settings,
		isOutgoingLink,
		highlightMode,
	);

	return {
		targetEl,
		linktext: spec.linktext,
		sourcePath: spec.sourcePath,
		state: spec.state,
	};
}

export function triggerHoverPopover(
	workspace: Workspace,
	plugin: PluginHost,
	event: MouseEvent,
	link: TwoHopIndexedLink,
	targetFile: TFile,
	settings: PluginSettings,
	isOutgoingLink = false,
	highlightMode: HighlightMode = "auto",
): void {
	const request = buildHoverPopoverRequest(
		event,
		link,
		targetFile,
		settings,
		isOutgoingLink,
		highlightMode,
	);
	if (!request) {
		return;
	}

	if (Platform.isMobile) {
		if (enableLogging)
			logger(
				"[HoverPopoverTrigger] Forwarding hover to mobile page-preview instance",
				{
					targetEl: describeTargetEl(request.targetEl),
					linktext: request.linktext,
					sourcePath: request.sourcePath,
					state: request.state,
				},
			);
		triggerMobilePagePreview(
			plugin.app,
			request.targetEl,
			request.linktext,
			request.sourcePath,
			request.state,
		);
		return;
	}
	if (enableLogging)
		logger(
			"[HoverPopoverTrigger] Dispatching workspace.trigger('hover-link') from plugin",
			{
				targetEl: describeTargetEl(request.targetEl),
				linktext: request.linktext,
				sourcePath: request.sourcePath,
				state: request.state,
				eventType: event.type,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
			},
		);
	workspace.trigger("hover-link", {
		event,
		source: COSENSE_CARD_LINKS_HOVER_SOURCE_ID,
		hoverParent: plugin,
		targetEl: request.targetEl,
		linktext: request.linktext,
		sourcePath: request.sourcePath,
		state: request.state,
	});
}

let pagePreviewInstance: PagePreviewOnLinkHoverCapability["instance"] | undefined =
	undefined;
let checkedPagePreview = false;
let shadowDesktopExperimentalKeepAlive = false;
let lastAssignedShadowDesktopPopover: HoverPopover | undefined;

const mobileHoverParent: { hoverPopover: HoverPopover | undefined } = {
	hoverPopover: undefined,
};

function getPagePreviewInstance(app: App): typeof pagePreviewInstance {
	if (!checkedPagePreview) {
		const capability = new ObsidianInternalFacade(app).getPagePreviewOnLinkHover();
		if (capability.ok) {
			pagePreviewInstance = capability.value.instance;
		} else {
			console.warn(`Could not get page-preview instance: ${capability.reason}`);
			pagePreviewInstance = undefined;
		}
		checkedPagePreview = true;
	}
	return pagePreviewInstance;
}

export function triggerMobilePagePreview(
	app: App,
	targetEl: HTMLElement,
	linktext: string,
	sourcePath: string,
	state?: unknown,
): boolean {
	const instance = getPagePreviewInstance(app);
	if (instance) {
		if (enableLogging)
			logger(
				"[HoverPopoverTrigger] Calling page-preview.onLinkHover directly (mobile)",
				{
					targetEl: describeTargetEl(targetEl),
					linktext,
					sourcePath,
					state,
				},
			);
		instance.onLinkHover(mobileHoverParent, targetEl, linktext, sourcePath, state);
		lastAssignedShadowDesktopPopover = mobileHoverParent.hoverPopover;
		return true;
	}
	console.warn("page-preview plugin not available on mobile");
	return false;
}

export { resolveHoverPopoverTargetElement };

export function getShadowDesktopHoverParentForDebug(): typeof mobileHoverParent {
	return mobileHoverParent;
}

export function getLastAssignedShadowDesktopPopoverForDebug():
	| HoverPopover
	| undefined {
	return lastAssignedShadowDesktopPopover;
}

export function getShadowDesktopHoverDebugState(): Record<string, unknown> {
	return {
		hasPopover: Boolean(mobileHoverParent.hoverPopover),
		experimentalKeepAlive: shadowDesktopExperimentalKeepAlive,
	};
}

export function getShadowDesktopExperimentalKeepAlive(): boolean {
	return shadowDesktopExperimentalKeepAlive;
}

export function setShadowDesktopExperimentalKeepAlive(enabled: boolean): boolean {
	shadowDesktopExperimentalKeepAlive = Boolean(enabled);
	return shadowDesktopExperimentalKeepAlive;
}

export function forceCloseShadowDesktopPopover(_reason = "force-close"): void {
	(mobileHoverParent.hoverPopover as { hide?: () => void } | undefined)?.hide?.();
	mobileHoverParent.hoverPopover = undefined;
	lastAssignedShadowDesktopPopover = undefined;
}
