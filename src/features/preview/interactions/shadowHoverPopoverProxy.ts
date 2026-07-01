const SHADOW_PROXY_ATTRIBUTE = "data-ccl-shadow-hover-proxy";
const SHADOW_PROXY_SOURCE_PROPERTY = "__cclShadowHoverPopoverProxySourceRef";
const SHADOW_PROXY_MAP_PROPERTY = "__cclShadowHoverPopoverProxyMap";
const SHADOW_PROXY_SET_PROPERTY = "__cclShadowHoverPopoverProxySet";
const SHADOW_PROXY_RECT_PROPERTY = "__cclShadowHoverPopoverProxyRect";
const ACTIVE_PROXY_Z_INDEX = "2147483646";
import {
	createOwnerFocusEvent,
	createOwnerMouseEvent,
	createOwnerPointerEvent,
	isHTMLElementLike,
	isMouseEventLike,
	isShadowRootLike,
} from "ui/utils/realmSafeDom";
import { getInteractionIdFromElement } from "ui/interactions/interactionTypes";

type ShadowHoverPopoverSourceRef = {
	deref(): HTMLElement | undefined;
};

type ShadowHoverPopoverProxyEl = HTMLDivElement & {
	[SHADOW_PROXY_SOURCE_PROPERTY]?: ShadowHoverPopoverSourceRef | null;
	[SHADOW_PROXY_RECT_PROPERTY]?: ShadowHoverProxyRect | null;
};

type ShadowHoverProxyDocument = Document & {
	[SHADOW_PROXY_MAP_PROPERTY]?: WeakMap<HTMLElement, ShadowHoverPopoverProxyEl>;
	[SHADOW_PROXY_SET_PROPERTY]?: Set<ShadowHoverPopoverProxyEl>;
};

type ShadowHoverProxyRect = {
	left: number;
	top: number;
	width: number;
	height: number;
};

function getShadowRootForTarget(
	targetEl: HTMLElement | ShadowRoot | null,
): ShadowRoot | null {
	if (!targetEl) {
		return null;
	}

	if (isShadowRootLike(targetEl)) {
		return targetEl.mode === "open" ? targetEl : null;
	}

	const root = targetEl.getRootNode?.();
	return isShadowRootLike(root) && root.mode === "open" ? root : null;
}

function getProxyMap(
	documentRef: ShadowHoverProxyDocument,
): WeakMap<HTMLElement, ShadowHoverPopoverProxyEl> {
	if (!documentRef[SHADOW_PROXY_MAP_PROPERTY]) {
		documentRef[SHADOW_PROXY_MAP_PROPERTY] = new WeakMap<
			HTMLElement,
			ShadowHoverPopoverProxyEl
		>();
	}

	return documentRef[SHADOW_PROXY_MAP_PROPERTY] as WeakMap<
		HTMLElement,
		ShadowHoverPopoverProxyEl
	>;
}

function getProxySet(
	documentRef: ShadowHoverProxyDocument,
): Set<ShadowHoverPopoverProxyEl> {
	if (!documentRef[SHADOW_PROXY_SET_PROPERTY]) {
		documentRef[SHADOW_PROXY_SET_PROPERTY] = new Set<ShadowHoverPopoverProxyEl>();
	}

	return documentRef[SHADOW_PROXY_SET_PROPERTY] as Set<ShadowHoverPopoverProxyEl>;
}

function updateProxyRect(proxyEl: HTMLDivElement, sourceEl: HTMLElement): void {
	const rect = sourceEl.getBoundingClientRect();
	const nextRect: ShadowHoverProxyRect = {
		left: Math.round(rect.left),
		top: Math.round(rect.top),
		width: Math.max(1, Math.round(rect.width)),
		height: Math.max(1, Math.round(rect.height)),
	};
	const typedProxyEl = proxyEl as ShadowHoverPopoverProxyEl;
	const lastRect = typedProxyEl[SHADOW_PROXY_RECT_PROPERTY];
	if (
		lastRect &&
		lastRect.left === nextRect.left &&
		lastRect.top === nextRect.top &&
		lastRect.width === nextRect.width &&
		lastRect.height === nextRect.height
	) {
		return;
	}

	proxyEl.style.left = `${nextRect.left}px`;
	proxyEl.style.top = `${nextRect.top}px`;
	proxyEl.style.width = `${nextRect.width}px`;
	proxyEl.style.height = `${nextRect.height}px`;
	typedProxyEl[SHADOW_PROXY_RECT_PROPERTY] = nextRect;
}

function createSourceRef(sourceEl: HTMLElement): ShadowHoverPopoverSourceRef {
	const weakRefConstructor = (
		globalThis as {
			WeakRef?: new <T extends object>(value: T) => ShadowHoverPopoverSourceRef;
		}
	).WeakRef;
	if (weakRefConstructor) {
		return new weakRefConstructor(sourceEl);
	}

	return {
		deref: () => (sourceEl.isConnected ? sourceEl : undefined),
	};
}

function getProxySource(proxyEl: ShadowHoverPopoverProxyEl): HTMLElement | null {
	return proxyEl[SHADOW_PROXY_SOURCE_PROPERTY]?.deref() ?? null;
}

function activateProxyElement(proxyEl: ShadowHoverPopoverProxyEl): void {
	proxyEl.setAttribute("data-ccl-shadow-hover-proxy-active", "1");
	proxyEl.style.pointerEvents = "auto";
	proxyEl.style.zIndex = ACTIVE_PROXY_Z_INDEX;
	proxyEl.style.cursor = "pointer";
}

function deactivateProxyElement(proxyEl: ShadowHoverPopoverProxyEl): void {
	proxyEl.removeAttribute("data-ccl-shadow-hover-proxy-active");
	proxyEl.style.pointerEvents = "none";
	proxyEl.style.zIndex = "-1";
	proxyEl.style.cursor = "auto";
}

function buildRelayedMouseEvent(event: MouseEvent): MouseEvent {
	return createOwnerMouseEvent(event.currentTarget as Node | null, event.type, {
		bubbles: true,
		cancelable: true,
		composed: true,
		button: event.button,
		buttons: event.buttons,
		clientX: event.clientX,
		clientY: event.clientY,
		screenX: event.screenX,
		screenY: event.screenY,
		ctrlKey: event.ctrlKey,
		metaKey: event.metaKey,
		altKey: event.altKey,
		shiftKey: event.shiftKey,
		detail: event.detail,
	});
}

function relayPointerActivation(event: MouseEvent): void {
	const proxyEl = event.currentTarget;
	if (!isHTMLElementLike(proxyEl) || proxyEl.tagName !== "DIV") {
		return;
	}

	const typedProxy = proxyEl as ShadowHoverPopoverProxyEl;
	const sourceEl = getProxySource(typedProxy);
	if (!sourceEl || !sourceEl.isConnected) {
		removeProxyElement(
			typedProxy.ownerDocument as ShadowHoverProxyDocument,
			typedProxy,
		);
		return;
	}

	const relayedEvent = buildRelayedMouseEvent(event);
	const notCancelled = sourceEl.dispatchEvent(relayedEvent);
	if (!notCancelled || relayedEvent.defaultPrevented) {
		event.preventDefault();
	}
}

function removeProxyElement(
	documentRef: ShadowHoverProxyDocument,
	proxyEl: ShadowHoverPopoverProxyEl,
): void {
	getProxySet(documentRef).delete(proxyEl);
	proxyEl[SHADOW_PROXY_SOURCE_PROPERTY] = null;
	proxyEl[SHADOW_PROXY_RECT_PROPERTY] = null;
	proxyEl.remove();
}

function pruneDisconnectedProxies(documentRef: ShadowHoverProxyDocument): void {
	for (const proxyEl of getProxySet(documentRef)) {
		const sourceEl = getProxySource(proxyEl);
		if (!proxyEl.isConnected || !sourceEl || !sourceEl.isConnected) {
			removeProxyElement(documentRef, proxyEl);
		}
	}
}

function releaseProxyForSource(
	documentRef: ShadowHoverProxyDocument,
	sourceEl: HTMLElement,
): boolean {
	const proxyEl = getProxyMap(documentRef).get(sourceEl);
	if (!proxyEl) {
		return false;
	}

	getProxyMap(documentRef).delete(sourceEl);
	removeProxyElement(documentRef, proxyEl);
	return true;
}

function createProxyElement(
	documentRef: ShadowHoverProxyDocument,
	sourceEl: HTMLElement,
): ShadowHoverPopoverProxyEl {
	const proxyEl = documentRef.createElement("div") as ShadowHoverPopoverProxyEl;
	proxyEl.setAttribute(SHADOW_PROXY_ATTRIBUTE, "1");
	proxyEl.setAttribute("aria-hidden", "true");

	const interactionId = getInteractionIdFromElement(sourceEl);
	if (interactionId) {
		proxyEl.setAttribute("data-ccl-shadow-hover-proxy-for", interactionId);
	}

	Object.assign(proxyEl.style, {
		position: "fixed",
		pointerEvents: "none",
		opacity: "0",
		zIndex: "-1",
		margin: "0",
		padding: "0",
		border: "0",
		background: "transparent",
		contain: "strict",
	});

	proxyEl[SHADOW_PROXY_SOURCE_PROPERTY] = createSourceRef(sourceEl);
	updateProxyRect(proxyEl, sourceEl);
	activateProxyElement(proxyEl);
	proxyEl.addEventListener("mousedown", relayPointerActivation);
	proxyEl.addEventListener("click", relayPointerActivation);
	(documentRef.body ?? documentRef.documentElement).appendChild(proxyEl);
	getProxySet(documentRef).add(proxyEl);
	return proxyEl;
}

function getOrCreateProxyForSource(
	documentRef: ShadowHoverProxyDocument,
	sourceEl: HTMLElement,
): ShadowHoverPopoverProxyEl {
	pruneDisconnectedProxies(documentRef);
	const proxyMap = getProxyMap(documentRef);
	const existingProxy = proxyMap.get(sourceEl);
	if (existingProxy?.isConnected) {
		existingProxy[SHADOW_PROXY_SOURCE_PROPERTY] = createSourceRef(sourceEl);
		updateProxyRect(existingProxy, sourceEl);
		activateProxyElement(existingProxy);
		return existingProxy;
	}

	const proxyEl = createProxyElement(documentRef, sourceEl);
	proxyMap.set(sourceEl, proxyEl);
	return proxyEl;
}

function buildSyntheticLeaveEvent(
	type: string,
	originalEvent?: MouseEvent | FocusEvent,
): Event {
	const commonInit = {
		bubbles: true,
		cancelable: true,
		composed: true,
		relatedTarget: originalEvent?.relatedTarget ?? null,
	};

	if (type === "mouseout" || type === "mouseleave" || type === "mouseover") {
		return createOwnerMouseEvent(originalEvent?.target as Node | null, type, {
			...commonInit,
			clientX: isMouseEventLike(originalEvent) ? originalEvent.clientX : 0,
			clientY: isMouseEventLike(originalEvent) ? originalEvent.clientY : 0,
			screenX: isMouseEventLike(originalEvent) ? originalEvent.screenX : 0,
			screenY: isMouseEventLike(originalEvent) ? originalEvent.screenY : 0,
		});
	}

	if (type === "pointerout" || type === "pointerleave") {
		return createOwnerPointerEvent(originalEvent?.target as Node | null, type, {
			...commonInit,
			clientX: isMouseEventLike(originalEvent) ? originalEvent.clientX : 0,
			clientY: isMouseEventLike(originalEvent) ? originalEvent.clientY : 0,
			screenX: isMouseEventLike(originalEvent) ? originalEvent.screenX : 0,
			screenY: isMouseEventLike(originalEvent) ? originalEvent.screenY : 0,
		});
	}

	return createOwnerFocusEvent(originalEvent?.target as Node | null, type, {
		bubbles: true,
		cancelable: false,
		composed: true,
		relatedTarget: originalEvent?.relatedTarget ?? null,
	});
}

function dispatchLeaveRelay(
	proxyEl: HTMLDivElement,
	originalEvent?: MouseEvent | FocusEvent,
): void {
	for (const type of ["mouseout", "mouseleave", "pointerout", "pointerleave"]) {
		proxyEl.dispatchEvent(buildSyntheticLeaveEvent(type, originalEvent));
	}
}

export function getShadowHoverPopoverProxyElement(
	sourceEl: HTMLElement | null | undefined,
): HTMLDivElement | null {
	if (!sourceEl) {
		return null;
	}

	const documentRef = sourceEl.ownerDocument as ShadowHoverProxyDocument;
	if (!sourceEl.isConnected) {
		releaseProxyForSource(documentRef, sourceEl);
		return null;
	}

	pruneDisconnectedProxies(documentRef);
	return getProxyMap(documentRef).get(sourceEl) ?? null;
}

export function resolveShadowHoverPopoverTarget(
	targetEl: HTMLElement | ShadowRoot | null,
): HTMLElement | null {
	if (!targetEl) {
		return null;
	}

	if (isShadowRootLike(targetEl)) {
		return isHTMLElementLike(targetEl.host) ? targetEl.host : null;
	}

	const shadowRoot = getShadowRootForTarget(targetEl);
	if (!shadowRoot) {
		return targetEl;
	}

	const documentRef = targetEl.ownerDocument as ShadowHoverProxyDocument;
	return getOrCreateProxyForSource(documentRef, targetEl);
}

export function deactivateShadowHoverPopoverProxyElement(
	sourceEl: HTMLElement | null | undefined,
): boolean {
	if (!sourceEl) {
		return false;
	}

	const documentRef = sourceEl.ownerDocument as ShadowHoverProxyDocument;
	if (!sourceEl.isConnected) {
		return releaseProxyForSource(documentRef, sourceEl);
	}

	const proxyEl = getShadowHoverPopoverProxyElement(sourceEl);
	if (!proxyEl) {
		return false;
	}

	deactivateProxyElement(proxyEl as ShadowHoverPopoverProxyEl);
	return true;
}

export function relayShadowHoverPopoverLeave(
	sourceEl: HTMLElement | null | undefined,
	originalEvent?: MouseEvent | FocusEvent,
): boolean {
	const proxyEl = getShadowHoverPopoverProxyElement(sourceEl);
	if (!proxyEl || !proxyEl.isConnected) {
		return false;
	}

	dispatchLeaveRelay(proxyEl, originalEvent);
	return true;
}

export function disposeShadowHoverPopoverProxies(
	documentRef: Document = document,
): void {
	const typedDocument = documentRef as ShadowHoverProxyDocument;
	documentRef
		.querySelectorAll(`div[${SHADOW_PROXY_ATTRIBUTE}]`)
		.forEach((proxyEl) =>
			removeProxyElement(typedDocument, proxyEl as ShadowHoverPopoverProxyEl),
		);

	typedDocument[SHADOW_PROXY_MAP_PROPERTY] = new WeakMap<
		HTMLElement,
		ShadowHoverPopoverProxyEl
	>();
	typedDocument[SHADOW_PROXY_SET_PROPERTY] = new Set<ShadowHoverPopoverProxyEl>();
}
