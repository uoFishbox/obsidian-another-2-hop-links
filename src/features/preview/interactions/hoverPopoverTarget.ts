import {
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
