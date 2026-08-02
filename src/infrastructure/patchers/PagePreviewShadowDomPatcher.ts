import type { PluginHost } from "types/pluginHost";
import {
	disposeShadowHoverPopoverProxies,
	normalizeHoverPopoverTargetEl,
} from "features/popover/hoverPopoverTarget";
import { enableLogging, logger } from "shared/logging/logger";
import { ObsidianInternalFacade } from "infrastructure/capabilities/ObsidianInternalFacade";
import type { PatchRegistry } from "infrastructure/capabilities/PatchRegistry";

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

interface WorkspaceLike {
	trigger: (name: string, ...args: unknown[]) => unknown;
}

let hoverCallSequence = 0;
let hoverTriggerSequence = 0;

function describeTargetEl(
	targetEl: HTMLElement | ShadowRoot | null | undefined,
): string {
	return targetEl instanceof HTMLElement
		? [
				targetEl.tagName.toLowerCase(),
				targetEl.id ? `#${targetEl.id}` : "",
				targetEl.dataset.cclInteractionId
					? `[${targetEl.dataset.cclInteractionId}]`
					: "",
			].join("")
		: targetEl instanceof ShadowRoot
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
		ctrlKey: event instanceof MouseEvent ? event.ctrlKey : undefined,
		metaKey: event instanceof MouseEvent ? event.metaKey : undefined,
		altKey: event instanceof MouseEvent ? event.altKey : undefined,
		shiftKey: event instanceof MouseEvent ? event.shiftKey : undefined,
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

function describeHoverLinkPayload(payload: unknown): Record<string, unknown> {
	const hoverPayload = payload as {
		event?: Event;
		targetEl?: HTMLElement | ShadowRoot | null;
		source?: string;
		linktext?: string;
		sourcePath?: string;
		state?: unknown;
		hoverParent?: unknown;
	};
	const event = hoverPayload?.event instanceof Event ? hoverPayload.event : undefined;
	return {
		source: hoverPayload?.source ?? null,
		linktext: hoverPayload?.linktext ?? null,
		sourcePath: hoverPayload?.sourcePath ?? null,
		targetEl: describeTargetEl(hoverPayload?.targetEl ?? null),
		hoverParentType:
			hoverPayload?.hoverParent &&
			typeof hoverPayload.hoverParent === "object" &&
			"constructor" in hoverPayload.hoverParent
				? ((
						hoverPayload.hoverParent as {
							constructor?: { name?: string };
						}
					).constructor?.name ?? null)
				: typeof hoverPayload?.hoverParent,
		state: hoverPayload?.state ?? null,
		...describeHoverEvent(event),
	};
}

export function initPagePreviewShadowDomPatcher(
	plugin: PluginHost,
	patchRegistry: PatchRegistry,
): void {
	plugin.register(() => {
		disposeShadowHoverPopoverProxies();
	});

	plugin.app.workspace.onLayoutReady(() => {
		patchPagePreviewInstance(plugin, patchRegistry);
		patchWorkspaceHoverLinkTrigger(plugin, patchRegistry);
	});
}

function patchPagePreviewInstance(
	plugin: PluginHost,
	patchRegistry: PatchRegistry,
): void {
	const capability = new ObsidianInternalFacade(
		plugin.app,
	).getPagePreviewOnLinkHover();
	if (!capability.ok) {
		if (enableLogging)
			logger(
				`[PagePreviewShadowDomPatcher] Skipped page-preview patch: ${capability.reason}.`,
			);
		return;
	}

	const applied = patchRegistry.apply(plugin, {
		id: "page-preview:onLinkHover",
		target: capability.value.instance,
		method: "onLinkHover",
		risk: capability.risk,
		enabled: true,
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
				const eventArg = args.find(
					(entry): entry is Event => entry instanceof Event,
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

	if (applied) {
		if (enableLogging)
			logger(
				"[PagePreviewShadowDomPatcher] Patched page-preview onLinkHover for Shadow DOM anchors.",
			);
	}
}

function patchWorkspaceHoverLinkTrigger(
	plugin: PluginHost,
	patchRegistry: PatchRegistry,
): void {
	const workspace = plugin.app.workspace as WorkspaceLike;
	if (typeof workspace.trigger !== "function") {
		if (enableLogging)
			logger(
				"[PagePreviewShadowDomPatcher] Skipped workspace hover-link patch: workspace.trigger unavailable.",
			);
		return;
	}
	const applied = patchRegistry.apply(plugin, {
		id: "workspace:hover-link-diagnostics",
		target: workspace,
		method: "trigger",
		risk: "low",
		enabled: true,
		wrap: (next) =>
			function (this: WorkspaceLike, name: string, ...args: unknown[]) {
				if (name === "hover-link") {
					const triggerId = ++hoverTriggerSequence;
					if (enableLogging)
						logger(
							"[PagePreviewShadowDomPatcher] workspace.trigger('hover-link')",
							{
								triggerId,
								stack: describeShortStack(),
								...describeHoverLinkPayload(args[0]),
							},
						);
				}
				return next.call(this, name, ...args);
			},
	});

	if (applied) {
		if (enableLogging)
			logger(
				"[PagePreviewShadowDomPatcher] Patched workspace.trigger for hover-link diagnostics.",
			);
	}
}
