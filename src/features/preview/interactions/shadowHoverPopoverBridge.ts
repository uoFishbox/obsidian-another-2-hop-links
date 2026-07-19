import type { AppContext, LinkContext } from "ui/context/linkContext";
import type { InteractionRegistry } from "ui/interactions/interactionRegistry";
import {
	INTERACTION_SELECTOR,
	getInteractionIdFromElement,
} from "ui/interactions/interactionTypes";
import { buildShadowHoverLinkSpec } from "./shadowHoverLinkSpec";
import {
	findClosestComposed,
	findMatchingElementInComposedPath,
} from "ui/shared/dom/shadowDom";
import { enableLogging, logger } from "shared/logging/logger";
import { ShadowHoverControllerImpl } from "features/preview/shadow-hover/controller";
import { WorkspaceTriggerPopoverLauncher } from "features/preview/shadow-hover/launcher";
import { COSENSE_CARD_LINKS_HOVER_SOURCE_ID } from "features/preview/interactions/hoverPopoverLinkSpec";
import { isHTMLElementLike, isNodeLike } from "ui/shared/dom/realmSafeDom";
import { VIRTUAL_CELL_WILL_REBIND_EVENT } from "ui/interactions/virtualCellRebind";
import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "ui/virtualization/scheduling/scrollActivity";

interface ShadowHoverPopoverBridgeOptions {
	shadowRoot: ShadowRoot;
	registry: InteractionRegistry;
	linkContext?: LinkContext;
	appContext?: AppContext;
}

interface SharedShadowHoverBridgeHandle {
	shadowRoot: ShadowRoot;
	registry: InteractionRegistry;
	linkContext?: LinkContext;
	appContext?: AppContext;
	refCount: number;
	controller: ShadowHoverControllerImpl;
	hoveredAnchorEl: HTMLElement | null;
	activeAnchorEl: HTMLElement | null;
	activeInteractionId: string | null;
	lastPointerModState: boolean | null;
	disposeListeners: () => void;
	disposed: boolean;
}

const sharedShadowHoverBridgeHandles = new WeakMap<
	ShadowRoot,
	SharedShadowHoverBridgeHandle
>();

function isInteractionElementWithinShadowRoot(
	shadowRoot: ShadowRoot,
	element: HTMLElement | null,
): element is HTMLElement {
	return (
		isHTMLElementLike(element) &&
		element.matches(INTERACTION_SELECTOR) &&
		shadowRoot.contains(element)
	);
}

function resolveInteractionElementFromEvent(
	shadowRoot: ShadowRoot,
	event: Event,
): HTMLElement | null {
	const element = findMatchingElementInComposedPath(event, INTERACTION_SELECTOR);
	return isInteractionElementWithinShadowRoot(shadowRoot, element) ? element : null;
}

function resolveInteractionElementFromRelatedTarget(
	shadowRoot: ShadowRoot,
	target: EventTarget | null,
): HTMLElement | null {
	const element = findClosestComposed(target, INTERACTION_SELECTOR);
	return isInteractionElementWithinShadowRoot(shadowRoot, element) ? element : null;
}

function getModifierState(event: MouseEvent | PointerEvent | KeyboardEvent): boolean {
	return Boolean(event.ctrlKey || event.metaKey);
}

function isEventTargetWithinAnchor(
	anchorEl: HTMLElement,
	target: EventTarget | null,
): boolean {
	return isNodeLike(target) && anchorEl.contains(target);
}

function isRelatedTargetWithinAnchor(
	anchorEl: HTMLElement,
	event: MouseEvent,
): boolean {
	const relatedTarget = event.relatedTarget;
	return (
		isNodeLike(relatedTarget) &&
		(relatedTarget === anchorEl || anchorEl.contains(relatedTarget))
	);
}

function leaveActiveAnchor(handle: SharedShadowHoverBridgeHandle): void {
	if (!handle.activeAnchorEl) {
		handle.activeInteractionId = null;
		handle.lastPointerModState = null;
		return;
	}

	delete handle.activeAnchorEl.dataset.cclHovered;
	handle.controller.handleDelegatedLeave(handle.activeAnchorEl);
	handle.activeAnchorEl = null;
	handle.activeInteractionId = null;
	handle.lastPointerModState = null;
}

function enterLogicalHover(
	handle: SharedShadowHoverBridgeHandle,
	element: HTMLElement,
): void {
	if (handle.hoveredAnchorEl && handle.hoveredAnchorEl !== element) {
		delete handle.hoveredAnchorEl.dataset.cclHovered;
	}
	element.dataset.cclHovered = "true";
	handle.hoveredAnchorEl = element;
}

function relaunchActiveAnchorForInteraction(
	handle: SharedShadowHoverBridgeHandle,
	anchorEl: HTMLElement,
	interactionId: string,
	event: MouseEvent,
): void {
	handle.controller.closeActivePopover();
	if (handle.activeAnchorEl && handle.activeAnchorEl !== anchorEl) {
		delete handle.activeAnchorEl.dataset.cclHovered;
	}
	enterLogicalHover(handle, anchorEl);
	handle.activeAnchorEl = anchorEl;
	handle.activeInteractionId = interactionId;
	handle.lastPointerModState = getModifierState(event);
	handle.controller.handleDelegatedEnter(anchorEl, interactionId, event);
}

function handleModifierStateChange(
	handle: SharedShadowHoverBridgeHandle,
	event: KeyboardEvent,
): void {
	const modState = getModifierState(event);
	const shouldRetrigger = modState && !handle.lastPointerModState;
	handle.lastPointerModState = modState;
	if (!shouldRetrigger) {
		return;
	}

	const activeAnchorEl = handle.activeAnchorEl;
	const interactionId = handle.activeInteractionId;
	if (!activeAnchorEl || !interactionId) {
		return;
	}

	if (!activeAnchorEl.isConnected || !handle.shadowRoot.contains(activeAnchorEl)) {
		leaveActiveAnchor(handle);
		return;
	}

	handle.controller.handleDelegatedModifierKey(activeAnchorEl, interactionId, event);
}

function handleMouseOver(
	handle: SharedShadowHoverBridgeHandle,
	event: MouseEvent,
): void {
	if (isScrollActivityActive()) {
		return;
	}

	const nextAnchorEl = resolveInteractionElementFromEvent(handle.shadowRoot, event);
	if (!nextAnchorEl) {
		return;
	}

	const nextInteractionId = getInteractionIdFromElement(nextAnchorEl);
	if (!nextInteractionId) {
		return;
	}
	if (isRelatedTargetWithinAnchor(nextAnchorEl, event)) {
		return;
	}
	enterLogicalHover(handle, nextAnchorEl);

	const nextDescriptor = handle.registry.resolve(nextInteractionId);
	if (nextDescriptor?.hoverPreviewEnabled === false) {
		if (handle.activeAnchorEl === nextAnchorEl) {
			leaveActiveAnchor(handle);
		}
		return;
	}

	if (handle.activeAnchorEl === nextAnchorEl) {
		handle.lastPointerModState = getModifierState(event);
		if (handle.activeInteractionId === nextInteractionId) {
			handle.controller.handleDelegatedAnchorSync(
				nextAnchorEl,
				nextInteractionId,
				event,
			);
		} else {
			relaunchActiveAnchorForInteraction(
				handle,
				nextAnchorEl,
				nextInteractionId,
				event,
			);
		}
		return;
	}

	if (handle.activeInteractionId === nextInteractionId) {
		if (handle.activeAnchorEl && handle.activeAnchorEl !== nextAnchorEl) {
			delete handle.activeAnchorEl.dataset.cclHovered;
		}
		enterLogicalHover(handle, nextAnchorEl);
		handle.activeAnchorEl = nextAnchorEl;
		handle.activeInteractionId = nextInteractionId;
		handle.lastPointerModState = getModifierState(event);
		handle.controller.handleDelegatedAnchorSync(
			nextAnchorEl,
			nextInteractionId,
			event,
		);
		return;
	}

	const relatedAnchorEl = resolveInteractionElementFromRelatedTarget(
		handle.shadowRoot,
		event.relatedTarget,
	);
	if (relatedAnchorEl === nextAnchorEl) {
		return;
	}

	if (handle.activeAnchorEl && handle.activeAnchorEl !== nextAnchorEl) {
		const wantsPreview = getModifierState(event);
		if (!wantsPreview) {
			return;
		}
	}

	if (handle.activeAnchorEl && handle.activeAnchorEl !== nextAnchorEl) {
		delete handle.activeAnchorEl.dataset.cclHovered;
	}
	enterLogicalHover(handle, nextAnchorEl);
	handle.activeAnchorEl = nextAnchorEl;
	handle.activeInteractionId = nextInteractionId;
	handle.lastPointerModState = getModifierState(event);
	handle.controller.handleDelegatedEnter(nextAnchorEl, nextInteractionId, event);
}

function handleMouseOut(
	handle: SharedShadowHoverBridgeHandle,
	event: MouseEvent,
): void {
	const currentAnchorEl = resolveInteractionElementFromEvent(
		handle.shadowRoot,
		event,
	);
	if (!currentAnchorEl) {
		return;
	}

	if (isRelatedTargetWithinAnchor(currentAnchorEl, event)) {
		return;
	}
	delete currentAnchorEl.dataset.cclHovered;
	if (handle.hoveredAnchorEl === currentAnchorEl) {
		handle.hoveredAnchorEl = null;
	}

	const currentInteractionId = getInteractionIdFromElement(currentAnchorEl);
	if (
		currentAnchorEl !== handle.activeAnchorEl &&
		currentInteractionId !== handle.activeInteractionId
	) {
		return;
	}

	const nextAnchorEl = resolveInteractionElementFromRelatedTarget(
		handle.shadowRoot,
		event.relatedTarget,
	);
	const nextInteractionId = getInteractionIdFromElement(nextAnchorEl);
	const wantsPreview = getModifierState(event);
	if (
		nextAnchorEl === currentAnchorEl ||
		nextAnchorEl === handle.activeAnchorEl ||
		(nextInteractionId !== null && nextInteractionId === handle.activeInteractionId)
	) {
		return;
	}

	if (
		nextAnchorEl &&
		nextInteractionId &&
		nextInteractionId !== currentInteractionId &&
		wantsPreview
	) {
		return;
	}

	leaveActiveAnchor(handle);
}

function handlePointerMove(
	handle: SharedShadowHoverBridgeHandle,
	event: PointerEvent,
): void {
	if (isScrollActivityActive()) {
		return;
	}

	const activeAnchorEl = handle.activeAnchorEl;
	const interactionId = handle.activeInteractionId;
	if (!activeAnchorEl || !interactionId) {
		return;
	}

	if (!isEventTargetWithinAnchor(activeAnchorEl, event.target)) {
		const anchorEl = resolveInteractionElementFromEvent(handle.shadowRoot, event);
		if (anchorEl !== activeAnchorEl) {
			return;
		}
	}

	const currentInteractionId = getInteractionIdFromElement(activeAnchorEl);
	if (!currentInteractionId) {
		leaveActiveAnchor(handle);
		return;
	}

	const currentDescriptor = handle.registry.resolve(currentInteractionId);
	if (currentDescriptor?.hoverPreviewEnabled === false) {
		leaveActiveAnchor(handle);
		return;
	}

	if (currentInteractionId !== interactionId) {
		relaunchActiveAnchorForInteraction(
			handle,
			activeAnchorEl,
			currentInteractionId,
			event,
		);
		return;
	}

	const modState = getModifierState(event);
	const shouldRetrigger = modState && !handle.lastPointerModState;
	handle.lastPointerModState = modState;
	if (!shouldRetrigger) {
		return;
	}

	handle.controller.handleDelegatedPointerMove(activeAnchorEl, interactionId, event);
}

function disposeHandle(handle: SharedShadowHoverBridgeHandle): void {
	if (handle.disposed) {
		return;
	}

	handle.disposed = true;
	handle.disposeListeners();
	handle.controller.destroy();
}

function createHandle({
	shadowRoot,
	registry,
	linkContext,
	appContext,
}: ShadowHoverPopoverBridgeOptions): SharedShadowHoverBridgeHandle | null {
	const app = appContext?.app;
	if (!app) {
		if (enableLogging)
			logger("[ShadowHoverBridge] Bridge install skipped: app context missing.", {
				host: shadowRoot.host.tagName,
			});
		return null;
	}

	let handle: SharedShadowHoverBridgeHandle;
	const resolveLink = (interactionId: string) =>
		buildShadowHoverLinkSpec(
			handle.registry.resolve(interactionId),
			handle.appContext,
		);
	const controller = new ShadowHoverControllerImpl(
		new WorkspaceTriggerPopoverLauncher(app, COSENSE_CARD_LINKS_HOVER_SOURCE_ID),
		resolveLink,
	);
	handle = {
		shadowRoot,
		registry,
		linkContext,
		appContext,
		refCount: 1,
		controller,
		hoveredAnchorEl: null,
		activeAnchorEl: null,
		activeInteractionId: null,
		lastPointerModState: null,
		disposeListeners: () => {},
		disposed: false,
	};
	const onMouseOver: EventListener = (event) =>
		handleMouseOver(handle, event as MouseEvent);
	const onMouseOut: EventListener = (event) =>
		handleMouseOut(handle, event as MouseEvent);
	const onPointerMove: EventListener = (event) =>
		handlePointerMove(handle, event as PointerEvent);
	const onKeyDown: EventListener = (event) =>
		handleModifierStateChange(handle, event as KeyboardEvent);
	const onKeyUp: EventListener = (event) => {
		handle.lastPointerModState = getModifierState(event as KeyboardEvent);
	};
	const onWindowBlur = () => {
		handle.lastPointerModState = null;
	};
	const unsubscribeScrollActivity = subscribeScrollActivity((isActive) => {
		if (!isActive || handle.disposed) return;

		if (handle.hoveredAnchorEl) {
			delete handle.hoveredAnchorEl.dataset.cclHovered;
			handle.hoveredAnchorEl = null;
		}
		leaveActiveAnchor(handle);
		handle.controller.closeActivePopover();
	});
	const onVirtualCellWillRebind: EventListener = (event) => {
		const target = event.target;
		if (!isHTMLElementLike(target)) return;

		if (handle.hoveredAnchorEl && target.contains(handle.hoveredAnchorEl)) {
			handle.hoveredAnchorEl = null;
		}
		if (handle.activeAnchorEl && target.contains(handle.activeAnchorEl)) {
			leaveActiveAnchor(handle);
		}
	};
	const doc = shadowRoot.ownerDocument;
	const win = doc.defaultView;
	shadowRoot.addEventListener("mouseover", onMouseOver);
	shadowRoot.addEventListener("mouseout", onMouseOut);
	shadowRoot.addEventListener("pointermove", onPointerMove);
	shadowRoot.addEventListener(
		VIRTUAL_CELL_WILL_REBIND_EVENT,
		onVirtualCellWillRebind,
	);
	doc.addEventListener("keydown", onKeyDown, true);
	doc.addEventListener("keyup", onKeyUp, true);
	win?.addEventListener("blur", onWindowBlur);
	handle.disposeListeners = () => {
		unsubscribeScrollActivity();
		shadowRoot.removeEventListener("mouseover", onMouseOver);
		shadowRoot.removeEventListener("mouseout", onMouseOut);
		shadowRoot.removeEventListener("pointermove", onPointerMove);
		shadowRoot.removeEventListener(
			VIRTUAL_CELL_WILL_REBIND_EVENT,
			onVirtualCellWillRebind,
		);
		doc.removeEventListener("keydown", onKeyDown, true);
		doc.removeEventListener("keyup", onKeyUp, true);
		win?.removeEventListener("blur", onWindowBlur);
	};
	return handle;
}

export function installShadowHoverPopoverBridge({
	shadowRoot,
	registry,
	linkContext,
	appContext,
}: ShadowHoverPopoverBridgeOptions): () => void {
	const existingHandle = sharedShadowHoverBridgeHandles.get(shadowRoot);
	if (existingHandle) {
		existingHandle.refCount += 1;
		existingHandle.registry = registry;
		existingHandle.linkContext = linkContext;
		existingHandle.appContext = appContext;
		return () => {
			existingHandle.refCount = Math.max(0, existingHandle.refCount - 1);
			if (existingHandle.refCount === 0) {
				disposeHandle(existingHandle);
				sharedShadowHoverBridgeHandles.delete(shadowRoot);
			}
		};
	}

	const handle = createHandle({
		shadowRoot,
		registry,
		linkContext,
		appContext,
	});
	if (!handle) {
		return () => {};
	}

	sharedShadowHoverBridgeHandles.set(shadowRoot, handle);
	return () => {
		handle.refCount = Math.max(0, handle.refCount - 1);
		if (handle.refCount === 0) {
			disposeHandle(handle);
			sharedShadowHoverBridgeHandles.delete(shadowRoot);
		}
	};
}
