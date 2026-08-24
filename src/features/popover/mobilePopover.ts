import type { App, HoverPopover } from "obsidian";
import { type TFile, Platform, type Workspace } from "obsidian";
import type { TwoHopIndexedLink } from "types";
import type { PluginSettings } from "features/settings/model";
import type { PluginHost } from "types/pluginHost";
import type { HighlightMode } from "ui/context/linkContext";
import {
	normalizeHoverPopoverTargetEl,
	resolveHoverPopoverTargetElement,
	resolveHoverPreviewTargetElement,
} from "./hoverPopoverTarget";
import {
	buildHoverPopoverLinkSpec,
	COSENSE_CARD_LINKS_HOVER_SOURCE_ID,
} from "./hoverPopoverLinkSpec";
import {
	getPagePreviewOnLinkHover,
	type PagePreviewOnLinkHoverCapability,
} from "infrastructure/capabilities/obsidianInternals";

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
	if (!targetEl) {
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
		triggerMobilePagePreview(
			plugin.app,
			request.targetEl,
			request.linktext,
			request.sourcePath,
			request.state,
		);
		return;
	}
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

const mobileHoverParent: { hoverPopover: HoverPopover | undefined } = {
	hoverPopover: undefined,
};

function getPagePreviewInstance(app: App): typeof pagePreviewInstance {
	if (!checkedPagePreview) {
		const capability = getPagePreviewOnLinkHover(app);
		if (capability) {
			pagePreviewInstance = capability.instance;
		} else {
			console.warn("Could not get page-preview instance");
			pagePreviewInstance = undefined;
		}
		checkedPagePreview = true;
	}
	return pagePreviewInstance;
}

function triggerMobilePagePreview(
	app: App,
	targetEl: HTMLElement,
	linktext: string,
	sourcePath: string,
	state?: unknown,
): boolean {
	const instance = getPagePreviewInstance(app);
	if (instance) {
		instance.onLinkHover(mobileHoverParent, targetEl, linktext, sourcePath, state);
		return true;
	}
	console.warn("page-preview plugin not available on mobile");
	return false;
}

export { resolveHoverPopoverTargetElement };
