import { Platform } from "obsidian";
import { CANVAS_NOTE_DRAG_FORMAT } from "../../appConstants";
import { dispatchItemClick, dispatchItemHover } from "ui/handlers/linkItemHandlers";
import type { AppContext, LinkContext } from "ui/context/linkContext";
import { handleKeyboardActivation } from "ui/utils/keyboard";
import { createHoverPreviewMouseEvent } from "features/preview/interactions/hoverPopoverTarget";
import type { InteractionRegistry } from "./interactionRegistry";
import {
	clearInteractionLongPressed,
	consumeInteractionLongPressed,
	dispatchSyntheticMouseOver,
	getInteractionElement,
	getInteractionIdFromElement,
	getInteractionLastTouchAt,
	isSyntheticInteractionHoverEvent,
	markInteractionLongPressed,
	markInteractionTouched,
	resolveDescriptorInteractionOptions,
	type InteractionDescriptor,
} from "./interactionTypes";
import { installNativeDragSelectionShim } from "./cardDragState";
import { getOwnerWindow, isNodeLike } from "ui/utils/realmSafeDom";

interface DelegatedDispatcherDeps {
	registry: InteractionRegistry;
	linkContext?: LinkContext;
	appContext?: AppContext;
	markInteractionDirty?: (element: HTMLElement) => void;
}

const MOBILE_TOUCH_MOUSEOVER_SUPPRESSION_MS = 900;
const LONG_PRESS_DURATION = 500;
const TOUCH_SLOP = 10;
const VIBRATION_DURATION = 50;

function resolveDragData(
	descriptor: InteractionDescriptor,
	linkContext: LinkContext | undefined,
): string | null {
	if (!descriptor.dragRawText || !linkContext) {
		return null;
	}

	return linkContext.buildWikiLink(descriptor.targetFile, descriptor.dragRawText);
}

function resolveInteractionDescriptor(
	registry: InteractionRegistry,
	element: HTMLElement,
): InteractionDescriptor | null {
	const interactionId = getInteractionIdFromElement(element);
	if (!interactionId) {
		return null;
	}

	return registry.resolve(interactionId) ?? null;
}

function isRelatedTargetWithinElement(
	event: MouseEvent,
	element: HTMLElement,
): boolean {
	const relatedTarget = event.relatedTarget;
	return (
		isNodeLike(relatedTarget) &&
		(relatedTarget === element || element.contains(relatedTarget))
	);
}

function dispatchActivation(
	event: MouseEvent | KeyboardEvent,
	descriptor: InteractionDescriptor,
	linkContext: LinkContext | undefined,
	appContext: AppContext | undefined,
): void {
	if (!linkContext) {
		return;
	}

	const options = resolveDescriptorInteractionOptions(descriptor, appContext);
	if (descriptor.kind === "item") {
		dispatchItemClick(descriptor.item, linkContext, event, options);
		return;
	}

	linkContext.onHop1Click(event, descriptor.link, options);
}

function dispatchHover(
	element: HTMLElement,
	descriptor: InteractionDescriptor,
	linkContext: LinkContext | undefined,
	appContext: AppContext | undefined,
	originalEvent?: MouseEvent,
): boolean {
	if (!linkContext) {
		return false;
	}

	if (descriptor.hoverPreviewEnabled === false) {
		return false;
	}

	const options = resolveDescriptorInteractionOptions(descriptor, appContext);
	const interactionEvent = createHoverPreviewMouseEvent(element, originalEvent);

	if (descriptor.kind === "item") {
		if (!descriptor.targetFile) {
			return false;
		}

		dispatchItemHover(
			descriptor.item,
			linkContext,
			descriptor.targetFile,
			interactionEvent,
			options,
		);
		return true;
	}

	if (!descriptor.targetFile) {
		return false;
	}

	linkContext.onLinkHover?.(
		interactionEvent,
		descriptor.link,
		descriptor.targetFile,
		descriptor.isOutgoingLink,
		options,
	);
	return true;
}

export function setLightweightCardDragImage(
	event: DragEvent,
	sourceEl: HTMLElement,
	descriptor: InteractionDescriptor,
): void {
	const dataTransfer = event.dataTransfer;
	if (!dataTransfer?.setDragImage) {
		return;
	}

	const title =
		sourceEl
			.querySelector<HTMLElement>(
				".cosense-card-links__box-title, .cosense-card-links__header-title",
			)
			?.textContent?.trim() ||
		descriptor.targetFile?.basename ||
		sourceEl.getAttribute("aria-label") ||
		"Card";
	const rect = sourceEl.getBoundingClientRect();
	const width = Math.max(180, Math.min(rect.width || 260, 320));
	const rawOffsetX = event.clientX - rect.left;
	const rawOffsetY = event.clientY - rect.top;
	const pointerOffsetX = Number.isFinite(rawOffsetX) ? rawOffsetX : 16;
	const pointerOffsetY = Number.isFinite(rawOffsetY) ? rawOffsetY : 16;
	const offsetX = Math.min(Math.max(pointerOffsetX, 16), width - 8);
	const offsetY = Math.min(Math.max(pointerOffsetY, 16), 40);
	const doc = sourceEl.ownerDocument;
	const ghost = doc.createElement("div");

	ghost.textContent = title;
	Object.assign(ghost.style, {
		position: "fixed",
		left: "-10000px",
		top: "-10000px",
		width: `${width}px`,
		boxSizing: "border-box",
		padding: "10px 12px",
		borderRadius: "8px",
		border: "1px solid var(--background-modifier-border)",
		background: "var(--background-primary)",
		color: "var(--text-normal)",
		fontSize: "13px",
		fontWeight: "600",
		lineHeight: "1.3",
		whiteSpace: "nowrap",
		overflow: "hidden",
		textOverflow: "ellipsis",
		pointerEvents: "none",
		zIndex: "2147483647",
		contain: "layout paint style",
		boxShadow: "var(--shadow-s)",
	});

	(doc.body ?? doc.documentElement).appendChild(ghost);
	dataTransfer.setDragImage(ghost, offsetX, offsetY);

	const cleanup = () => ghost.remove();
	const win = getOwnerWindow(sourceEl);
	if (typeof win.requestAnimationFrame === "function") {
		win.requestAnimationFrame(() => win.requestAnimationFrame(cleanup));
		return;
	}

	win.setTimeout(cleanup, 0);
}

export function createDelegatedInteractionDispatcher({
	registry,
	linkContext,
	appContext,
	markInteractionDirty,
}: DelegatedDispatcherDeps) {
	const resolvedLinkContext = linkContext ?? appContext?.linkContext;
	let activeHoverInteractionId: string | null = null;
	let longPressTimer: number | undefined = undefined;
	let longPressElement: HTMLElement | null = null;
	let longPressStartX = 0;
	let longPressStartY = 0;

	function clearLongPressTimer(): void {
		if (longPressTimer !== undefined) {
			clearTimeout(longPressTimer);
			longPressTimer = undefined;
		}
	}

	function resetLongPressState(): void {
		clearLongPressTimer();
		longPressElement = null;
	}

	function resetTransientState(): void {
		resetLongPressState();
		activeHoverInteractionId = null;
	}

	return {
		clearLongPressTimer: resetLongPressState,
		resetTransientState,

		handleClick(event: MouseEvent): void {
			const element = getInteractionElement(event);
			if (!element) {
				return;
			}

			const descriptor = resolveInteractionDescriptor(registry, element);
			if (!descriptor) {
				return;
			}

			if (consumeInteractionLongPressed(element, event)) {
				return;
			}

			dispatchActivation(event, descriptor, resolvedLinkContext, appContext);
		},

		handleMouseDown(event: MouseEvent): void {
			if (event.button !== 1) {
				return;
			}

			const element = getInteractionElement(event);
			if (!element) {
				return;
			}

			const descriptor = resolveInteractionDescriptor(registry, element);
			if (!descriptor) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			if (consumeInteractionLongPressed(element, event)) {
				return;
			}

			dispatchActivation(event, descriptor, resolvedLinkContext, appContext);
		},

		handleContextMenu(event: MouseEvent): void {
			const element = getInteractionElement(event);
			if (!element) {
				return;
			}

			const descriptor = resolveInteractionDescriptor(registry, element);
			const onShowFileMenu = appContext?.linkContext.onShowFileMenu;
			const isMobile = Platform?.isMobile ?? false;

			if (!descriptor?.targetFile || !onShowFileMenu) {
				return;
			}

			if (isMobile && descriptor.settings?.mobileLongPressAction === "preview") {
				event.preventDefault();
				event.stopPropagation();
				return;
			}

			event.preventDefault();
			onShowFileMenu(event, descriptor.targetFile);
		},

		handleMouseOver(event: MouseEvent): void {
			const element = getInteractionElement(event);
			if (!element) {
				return;
			}

			if (isRelatedTargetWithinElement(event, element)) {
				return;
			}

			const descriptor = resolveInteractionDescriptor(registry, element);
			if (!descriptor) {
				return;
			}

			const isMobile = Platform?.isMobile ?? false;

			if (isMobile && !isSyntheticInteractionHoverEvent(event)) {
				const lastTouchAt = getInteractionLastTouchAt(element);
				if (
					lastTouchAt !== null &&
					Date.now() - lastTouchAt < MOBILE_TOUCH_MOUSEOVER_SUPPRESSION_MS
				) {
					return;
				}
			}

			const relatedElement = getInteractionElement(event.relatedTarget);
			const relatedInteractionId = getInteractionIdFromElement(relatedElement);
			if (
				relatedInteractionId &&
				relatedInteractionId === descriptor.interactionId
			) {
				return;
			}

			if (activeHoverInteractionId === descriptor.interactionId) {
				return;
			}

			if (
				dispatchHover(
					element,
					descriptor,
					resolvedLinkContext,
					appContext,
					event,
				)
			) {
				activeHoverInteractionId = descriptor.interactionId;
			}
		},

		handleMouseOut(event: MouseEvent): void {
			const element = getInteractionElement(event);
			if (!element) {
				return;
			}

			if (isRelatedTargetWithinElement(event, element)) {
				return;
			}

			const descriptor = resolveInteractionDescriptor(registry, element);
			if (!descriptor) {
				return;
			}

			const relatedElement = getInteractionElement(event.relatedTarget);
			const relatedInteractionId = getInteractionIdFromElement(relatedElement);
			if (
				relatedInteractionId &&
				relatedInteractionId === descriptor.interactionId
			) {
				return;
			}

			if (activeHoverInteractionId === descriptor.interactionId) {
				activeHoverInteractionId = null;
			}
		},

		handleMouseLeave(): void {
			activeHoverInteractionId = null;
		},

		handleKeyDown(event: KeyboardEvent): void {
			const element = getInteractionElement(event);
			if (!element) {
				return;
			}

			const descriptor = resolveInteractionDescriptor(registry, element);
			if (!descriptor) {
				return;
			}

			handleKeyboardActivation(event, (keyboardEvent) => {
				dispatchActivation(
					keyboardEvent,
					descriptor,
					resolvedLinkContext,
					appContext,
				);
			});
		},

		handleTouchStart(event: TouchEvent): void {
			resetLongPressState();

			const element = getInteractionElement(event);
			const isMobile = Platform?.isMobile ?? false;
			if (!isMobile || !element) {
				return;
			}

			const descriptor = resolveInteractionDescriptor(registry, element);
			if (!descriptor || descriptor.settings?.mobileLongPressAction === "menu") {
				return;
			}

			const touch = event.touches[0];
			if (!touch) {
				return;
			}

			longPressElement = element;
			longPressStartX = touch.clientX;
			longPressStartY = touch.clientY;
			markInteractionDirty?.(element);
			markInteractionTouched(element);
			clearInteractionLongPressed(element);

			longPressTimer = window.setTimeout(() => {
				longPressTimer = undefined;
				const targetElement = longPressElement;
				if (!targetElement?.isConnected) {
					return;
				}

				markInteractionLongPressed(targetElement);
				dispatchSyntheticMouseOver(targetElement, {
					clientX: touch.clientX,
					clientY: touch.clientY,
					screenX: touch.screenX,
					screenY: touch.screenY,
				});

				if (navigator.vibrate) {
					navigator.vibrate(VIBRATION_DURATION);
				}
			}, LONG_PRESS_DURATION);
		},

		handleTouchMove(event: TouchEvent): void {
			if (longPressTimer === undefined) {
				return;
			}

			const touch = event.touches[0];
			if (!touch) {
				return;
			}

			const diffX = Math.abs(touch.clientX - longPressStartX);
			const diffY = Math.abs(touch.clientY - longPressStartY);
			if (diffX > TOUCH_SLOP || diffY > TOUCH_SLOP) {
				clearLongPressTimer();
			}
		},

		handleTouchEnd(event: TouchEvent): void {
			clearLongPressTimer();

			const targetElement = longPressElement ?? getInteractionElement(event);
			longPressElement = null;
			if (!targetElement || targetElement.dataset.cclLongPressed !== "1") {
				return;
			}

			markInteractionTouched(targetElement);
			event.preventDefault();
			event.stopPropagation();
		},

		handleDragStart(event: DragEvent): void {
			const element = getInteractionElement(event);
			if (!element || !event.dataTransfer) {
				return;
			}

			const descriptor = resolveInteractionDescriptor(registry, element);
			if (!descriptor) {
				return;
			}

			const dragData = resolveDragData(descriptor, resolvedLinkContext);
			installNativeDragSelectionShim(element.ownerDocument);

			setLightweightCardDragImage(event, element, descriptor);

			if (dragData) {
				event.dataTransfer.setData("text/plain", dragData);
			}

			if (descriptor.filePathForDrag) {
				event.dataTransfer.setData(
					CANVAS_NOTE_DRAG_FORMAT,
					descriptor.filePathForDrag,
				);
			}
		},
	};
}
