import type { AppContext } from "cards/context/linkContext";
import type { InteractionRegistry } from "cards/interactions/interactionRegistry";
import {
	INTERACTION_SELECTOR,
	getInteractionHandleFromElement,
	type InteractionHandle,
} from "cards/interactions/interactionTypes";
import { buildShadowHoverLinkSpec } from "./shadowHoverLinkSpec";
import {
	findClosestComposed,
	findMatchingElementInComposedPath,
} from "shared/ui/dom/shadowDom";
import {
	ShadowHoverControllerImpl,
	type ShadowPopoverLaunchRequest,
} from "hover-popover/shadow-hover/controller";
import { createRequestHoverParent } from "hover-popover/shadow-hover/session";
import type { HoverLinkPayloadLike } from "hover-popover/shadow-hover/internal-types";
import { COSENSE_CARD_LINKS_HOVER_SOURCE_ID } from "hover-popover/hoverPopoverLinkSpec";
import { isHTMLElementLike, isNodeLike } from "shared/ui/dom/realmSafeDom";
import { VIRTUAL_CELL_WILL_REBIND_EVENT } from "cards/interactions/virtualCellRebind";
import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "shared/ui/scroll/scrollActivity";

interface ShadowHoverPopoverBridgeOptions {
	shadowRoot: ShadowRoot;
	registry: InteractionRegistry;
	appContext?: AppContext;
}

interface SharedShadowHoverBridgeHandle {
	shadowRoot: ShadowRoot;
	registry: InteractionRegistry;
	appContext?: AppContext;
	refCount: number;
	controller: ShadowHoverControllerImpl;
	hoveredAnchorEl: HTMLElement | null;
	activeAnchorEl: HTMLElement | null;
	activeInteractionHandle: InteractionHandle | null;
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
		handle.activeInteractionHandle = null;
		handle.activeInteractionId = null;
		handle.lastPointerModState = null;
		return;
	}

	delete handle.activeAnchorEl.dataset.cclHovered;
	handle.controller.handleDelegatedLeave(handle.activeAnchorEl);
	handle.activeAnchorEl = null;
	handle.activeInteractionHandle = null;
	handle.activeInteractionId = null;
	handle.lastPointerModState = null;
}

function releaseActiveAnchor(handle: SharedShadowHoverBridgeHandle): void {
	if (handle.activeAnchorEl) {
		delete handle.activeAnchorEl.dataset.cclHovered;
	}
	handle.controller.releaseActivePopover();
	handle.activeAnchorEl = null;
	handle.activeInteractionHandle = null;
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
	interactionHandle: InteractionHandle,
	interactionId: string,
	event: MouseEvent,
): void {
	releaseActiveAnchor(handle);
	enterLogicalHover(handle, anchorEl);
	handle.activeAnchorEl = anchorEl;
	handle.activeInteractionHandle = interactionHandle;
	handle.activeInteractionId = interactionId;
	handle.lastPointerModState = getModifierState(event);
	handle.controller.handleDelegatedEnter(anchorEl, interactionHandle, event);
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
	const interactionHandle = handle.activeInteractionHandle;
	if (!activeAnchorEl || !interactionHandle) {
		return;
	}

	if (!activeAnchorEl.isConnected || !handle.shadowRoot.contains(activeAnchorEl)) {
		leaveActiveAnchor(handle);
		return;
	}

	handle.controller.handleDelegatedModifierKey(
		activeAnchorEl,
		interactionHandle,
		event,
	);
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

	const nextInteractionHandle = getInteractionHandleFromElement(nextAnchorEl);
	if (!nextInteractionHandle) {
		return;
	}
	if (isRelatedTargetWithinAnchor(nextAnchorEl, event)) {
		return;
	}
	enterLogicalHover(handle, nextAnchorEl);

	const nextDescriptor = handle.registry.resolve(nextInteractionHandle);
	if (!nextDescriptor || nextDescriptor.hoverPreviewEnabled === false) {
		if (handle.activeAnchorEl === nextAnchorEl) {
			leaveActiveAnchor(handle);
		}
		return;
	}

	if (handle.activeAnchorEl === nextAnchorEl) {
		handle.lastPointerModState = getModifierState(event);
		if (handle.activeInteractionHandle === nextInteractionHandle) {
			handle.controller.handleDelegatedAnchorSync(
				nextAnchorEl,
				nextInteractionHandle,
				event,
			);
		} else {
			relaunchActiveAnchorForInteraction(
				handle,
				nextAnchorEl,
				nextInteractionHandle,
				nextDescriptor.interactionId,
				event,
			);
		}
		return;
	}

	if (handle.activeInteractionId === nextDescriptor.interactionId) {
		if (handle.activeAnchorEl && handle.activeAnchorEl !== nextAnchorEl) {
			delete handle.activeAnchorEl.dataset.cclHovered;
		}
		enterLogicalHover(handle, nextAnchorEl);
		handle.activeAnchorEl = nextAnchorEl;
		handle.activeInteractionHandle = nextInteractionHandle;
		handle.activeInteractionId = nextDescriptor.interactionId;
		handle.lastPointerModState = getModifierState(event);
		handle.controller.handleDelegatedAnchorSync(
			nextAnchorEl,
			nextInteractionHandle,
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
	handle.activeInteractionHandle = nextInteractionHandle;
	handle.activeInteractionId = nextDescriptor.interactionId;
	handle.lastPointerModState = getModifierState(event);
	handle.controller.handleDelegatedEnter(nextAnchorEl, nextInteractionHandle, event);
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

	const currentInteractionHandle = getInteractionHandleFromElement(currentAnchorEl);
	const currentInteractionId = currentInteractionHandle
		? handle.registry.resolve(currentInteractionHandle)?.interactionId
		: null;
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
	const nextInteractionHandle = getInteractionHandleFromElement(nextAnchorEl);
	const nextInteractionId = nextInteractionHandle
		? handle.registry.resolve(nextInteractionHandle)?.interactionId
		: null;
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
	const interactionHandle = handle.activeInteractionHandle;
	if (!activeAnchorEl || !interactionHandle) {
		return;
	}

	if (!isEventTargetWithinAnchor(activeAnchorEl, event.target)) {
		const anchorEl = resolveInteractionElementFromEvent(handle.shadowRoot, event);
		if (anchorEl !== activeAnchorEl) {
			return;
		}
	}

	const currentInteractionHandle = getInteractionHandleFromElement(activeAnchorEl);
	if (!currentInteractionHandle) {
		leaveActiveAnchor(handle);
		return;
	}

	const currentDescriptor = handle.registry.resolve(currentInteractionHandle);
	if (!currentDescriptor || currentDescriptor.hoverPreviewEnabled === false) {
		leaveActiveAnchor(handle);
		return;
	}

	if (currentInteractionHandle !== interactionHandle) {
		relaunchActiveAnchorForInteraction(
			handle,
			activeAnchorEl,
			currentInteractionHandle,
			currentDescriptor.interactionId,
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

	handle.controller.handleDelegatedPointerMove(
		activeAnchorEl,
		interactionHandle,
		event,
	);
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
	appContext,
}: ShadowHoverPopoverBridgeOptions): SharedShadowHoverBridgeHandle | null {
	const app = appContext?.app;
	if (!app) {
		return null;
	}

	let handle: SharedShadowHoverBridgeHandle;
	const resolveLink = (interactionHandle: string) =>
		buildShadowHoverLinkSpec(
			handle.registry.resolve(interactionHandle as InteractionHandle),
			handle.appContext,
		);
	const launchPopover = (request: ShadowPopoverLaunchRequest): void => {
		const hoverParent = createRequestHoverParent(
			request.session,
			request.requestSeq,
			request.proxyAnchorEl,
			request.actualAnchorEl,
		);
		const payload: HoverLinkPayloadLike = {
			event: request.event,
			source: COSENSE_CARD_LINKS_HOVER_SOURCE_ID,
			hoverParent,
			targetEl: request.proxyAnchorEl,
			linktext: request.link.linktext,
			sourcePath: request.link.sourcePath,
			state: {
				...(request.link.state as Record<string, unknown> | undefined),
				__cclShadowHoverRequestSeq: request.requestSeq,
			},
		};
		app.workspace.trigger("hover-link", payload);
	};
	const controller = new ShadowHoverControllerImpl(launchPopover, resolveLink);
	handle = {
		shadowRoot,
		registry,
		appContext,
		refCount: 1,
		controller,
		hoveredAnchorEl: null,
		activeAnchorEl: null,
		activeInteractionHandle: null,
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
	});
	const onVirtualCellWillRebind: EventListener = (event) => {
		const target = event.target;
		if (!isHTMLElementLike(target)) return;

		if (handle.hoveredAnchorEl && target.contains(handle.hoveredAnchorEl)) {
			handle.hoveredAnchorEl = null;
		}
		if (handle.activeAnchorEl && target.contains(handle.activeAnchorEl)) {
			releaseActiveAnchor(handle);
		}
	};
	let boundDocument: Document | null = null;
	let boundWindow: Window | null = null;
	const unbindRealmListeners = (): void => {
		boundDocument?.removeEventListener("keydown", onKeyDown, true);
		boundDocument?.removeEventListener("keyup", onKeyUp, true);
		boundWindow?.removeEventListener("blur", onWindowBlur);
		boundDocument = null;
		boundWindow = null;
	};
	const bindRealmListeners = (): void => {
		unbindRealmListeners();
		boundDocument = shadowRoot.ownerDocument;
		boundWindow = boundDocument.defaultView;
		boundDocument.addEventListener("keydown", onKeyDown, true);
		boundDocument.addEventListener("keyup", onKeyUp, true);
		boundWindow?.addEventListener("blur", onWindowBlur);
	};

	shadowRoot.addEventListener("mouseover", onMouseOver);
	shadowRoot.addEventListener("mouseout", onMouseOut);
	shadowRoot.addEventListener("pointermove", onPointerMove);
	shadowRoot.addEventListener(
		VIRTUAL_CELL_WILL_REBIND_EVENT,
		onVirtualCellWillRebind,
	);
	bindRealmListeners();
	const shadowHost = isHTMLElementLike(shadowRoot.host) ? shadowRoot.host : null;
	const unregisterWindowMigration =
		shadowHost && typeof shadowHost.onWindowMigrated === "function"
			? shadowHost.onWindowMigrated(() => {
					if (handle.hoveredAnchorEl) {
						delete handle.hoveredAnchorEl.dataset.cclHovered;
						handle.hoveredAnchorEl = null;
					}
					releaseActiveAnchor(handle);
					bindRealmListeners();
				})
			: null;

	handle.disposeListeners = () => {
		unsubscribeScrollActivity();
		unregisterWindowMigration?.();
		shadowRoot.removeEventListener("mouseover", onMouseOver);
		shadowRoot.removeEventListener("mouseout", onMouseOut);
		shadowRoot.removeEventListener("pointermove", onPointerMove);
		shadowRoot.removeEventListener(
			VIRTUAL_CELL_WILL_REBIND_EVENT,
			onVirtualCellWillRebind,
		);
		unbindRealmListeners();
	};
	return handle;
}

export function installShadowHoverPopoverBridge({
	shadowRoot,
	registry,
	appContext,
}: ShadowHoverPopoverBridgeOptions): () => void {
	const existingHandle = sharedShadowHoverBridgeHandles.get(shadowRoot);
	if (existingHandle) {
		existingHandle.refCount += 1;
		existingHandle.registry = registry;
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
