import { enableLogging, logger } from "utils/logger";
import {
	describeHoverEventTarget,
	type HoverTargetAugmentedMouseEvent,
	createHoverPreviewMouseEvent,
	resolveHoverPreviewTargetElement,
} from "./hoverPopoverEvents";
import {
	deactivateShadowHoverPopoverProxyElement,
	disposeShadowHoverPopoverProxies,
	getShadowHoverPopoverProxyElement,
	relayShadowHoverPopoverLeave,
	resolveShadowHoverPopoverTarget,
} from "./shadowHoverPopoverProxy";
import {
	isHTMLElementLike,
	isMouseEventLike,
	isShadowRootLike,
} from "ui/utils/realmSafeDom";

function describeElement(element: HTMLElement | null | undefined): string {
	if (!element) {
		return "<null>";
	}

	const tag = element.tagName.toLowerCase();
	const id = element.id ? `#${element.id}` : "";
	const className =
		typeof element.className === "string" && element.className.trim().length > 0
			? `.${element.className.trim().replace(/\s+/g, ".")}`
			: "";
	const interactionId = element.dataset.cclInteractionId
		? `[${element.dataset.cclInteractionId}]`
		: "";
	return `${tag}${id}${className}${interactionId}`;
}

function describeEventTarget(target: EventTarget | null | undefined): string {
	return isHTMLElementLike(target)
		? describeElement(target)
		: describeHoverEventTarget(target);
}

function describeHoverEvent(event: Event | undefined): Record<string, unknown> {
	if (!event) {
		return { eventType: null };
	}

	return {
		eventType: event.type,
		target: describeEventTarget(event.target),
		currentTarget: describeEventTarget(event.currentTarget),
		relatedTarget:
			"relatedTarget" in event
				? describeEventTarget((event as MouseEvent | FocusEvent).relatedTarget)
				: undefined,
		ctrlKey: isMouseEventLike(event) ? event.ctrlKey : undefined,
		metaKey: isMouseEventLike(event) ? event.metaKey : undefined,
		altKey: isMouseEventLike(event) ? event.altKey : undefined,
		shiftKey: isMouseEventLike(event) ? event.shiftKey : undefined,
		isTrusted: event.isTrusted,
	};
}

function describeIncomingTarget(
	targetEl: HTMLElement | ShadowRoot | null | undefined,
): string {
	return isHTMLElementLike(targetEl)
		? describeElement(targetEl)
		: isShadowRootLike(targetEl)
			? `<shadow-root:${targetEl.host.tagName.toLowerCase()}>`
			: String(targetEl ?? "<null>");
}

function resolveCandidateTarget(
	targetEl: HTMLElement | ShadowRoot | null | undefined,
	event?: Event,
): HTMLElement | null {
	if (isHTMLElementLike(targetEl)) {
		return targetEl;
	}

	if (isMouseEventLike(event)) {
		return resolveHoverPreviewTargetElement(event);
	}

	return null;
}

export {
	createHoverPreviewMouseEvent,
	resolveHoverPreviewTargetElement,
	type HoverTargetAugmentedMouseEvent,
	getShadowHoverPopoverProxyElement,
	deactivateShadowHoverPopoverProxyElement,
	relayShadowHoverPopoverLeave,
	disposeShadowHoverPopoverProxies,
};

export function normalizeHoverPopoverTargetEl(
	targetEl: HTMLElement | ShadowRoot | null | undefined,
	event?: Event,
): HTMLElement | null {
	if (!targetEl && !event) {
		return null;
	}
	const resolvedTarget = resolveCandidateTarget(targetEl, event);

	if (!resolvedTarget) {
		if (isShadowRootLike(targetEl) && isHTMLElementLike(targetEl.host)) {
			return targetEl.host;
		}

		return null;
	}

	const normalizedTarget = resolveShadowHoverPopoverTarget(resolvedTarget);
	if (!normalizedTarget) {
		return null;
	}

	if (normalizedTarget === resolvedTarget) {
		return resolvedTarget;
	}
	return normalizedTarget;
}

export function resolveHoverPopoverTargetElement(
	targetEl: HTMLElement | ShadowRoot | null | undefined,
): HTMLElement | null {
	return normalizeHoverPopoverTargetEl(targetEl);
}
