import {
	type HoverTargetAugmentedMouseEvent,
	createHoverPreviewMouseEvent,
	resolveHoverPreviewTargetElement,
} from "./hoverPopoverEvents";
import { createShadowGeometryProxyStore } from "./shadow-hover/geometry-proxy";
import {
	isHTMLElementLike,
	isMouseEventLike,
	isShadowRootLike,
} from "ui/shared/dom/realmSafeDom";

const hoverTargetProxyStore = createShadowGeometryProxyStore();

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
};

export function getShadowHoverPopoverProxyElement(
	actual: HTMLElement,
): HTMLElement | null {
	return hoverTargetProxyStore.get(actual);
}

export function disposeShadowHoverPopoverProxies(documentRef?: Document): void {
	hoverTargetProxyStore.destroy(documentRef);
}

function resolveShadowHoverPopoverTarget(resolvedTarget: HTMLElement): HTMLElement {
	const root = resolvedTarget.getRootNode();
	if (!isShadowRootLike(root)) {
		return resolvedTarget;
	}
	return hoverTargetProxyStore.sync(resolvedTarget);
}

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
