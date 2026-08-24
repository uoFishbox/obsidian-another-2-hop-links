import { findMatchingElementInComposedPath } from "shared/ui/dom/shadowDom";
import {
	getOwnerWindow,
	getWindowEventConstructors,
	isDocumentLike,
	isHTMLElementLike,
	isShadowRootLike,
} from "shared/ui/dom/realmSafeDom";

const HOVER_TARGET_EVENT_PROPERTY = "__cclHoverTargetEl";

export type HoverTargetAugmentedMouseEvent = MouseEvent & {
	[HOVER_TARGET_EVENT_PROPERTY]?: HTMLElement;
};

function defineReadonlyEventProperty<T>(event: Event, key: string, value: T): void {
	Object.defineProperty(event, key, {
		value,
		configurable: true,
	});
}

export function describeHoverEventTarget(
	target: EventTarget | null | undefined,
): string {
	return isHTMLElementLike(target)
		? [
				target.tagName.toLowerCase(),
				target.id ? `#${target.id}` : "",
				target.dataset.cclInteractionId
					? `[${target.dataset.cclInteractionId}]`
					: "",
			].join("")
		: isShadowRootLike(target)
			? `<shadow-root:${target.host.tagName.toLowerCase()}>`
			: isDocumentLike(target)
				? "<document>"
				: String(target ?? "<null>");
}

export function createHoverPreviewMouseEvent(
	element: HTMLElement,
	originalEvent?: MouseEvent,
): HoverTargetAugmentedMouseEvent {
	const interactionEvent = new (getWindowEventConstructors(
		getOwnerWindow(element),
	).MouseEvent)("mouseover", {
		bubbles: true,
		cancelable: true,
		composed: true,
		clientX: originalEvent?.clientX ?? 0,
		clientY: originalEvent?.clientY ?? 0,
		screenX: originalEvent?.screenX ?? 0,
		screenY: originalEvent?.screenY ?? 0,
		ctrlKey: originalEvent?.ctrlKey ?? false,
		shiftKey: originalEvent?.shiftKey ?? false,
		altKey: originalEvent?.altKey ?? false,
		metaKey: originalEvent?.metaKey ?? false,
		button: originalEvent?.button ?? 0,
		relatedTarget: originalEvent?.relatedTarget ?? null,
	}) as HoverTargetAugmentedMouseEvent;

	defineReadonlyEventProperty(interactionEvent, "target", element);
	defineReadonlyEventProperty(interactionEvent, "currentTarget", element);
	defineReadonlyEventProperty(interactionEvent, HOVER_TARGET_EVENT_PROPERTY, element);

	if (originalEvent?.composedPath) {
		const originalPath = originalEvent.composedPath();
		defineReadonlyEventProperty(interactionEvent, "composedPath", () => {
			const seen = new Set<EventTarget>();
			const mergedPath: EventTarget[] = [];

			const push = (entry: EventTarget | null | undefined) => {
				if (!entry || seen.has(entry)) {
					return;
				}

				seen.add(entry);
				mergedPath.push(entry);
			};

			push(element);
			for (const entry of originalPath) {
				push(entry);
			}
			return mergedPath;
		});
	} else {
		defineReadonlyEventProperty(interactionEvent, "composedPath", () => [element]);
	}

	return interactionEvent;
}

export function resolveHoverPreviewTargetElement(
	event: MouseEvent,
): HTMLElement | null {
	const augmentedEvent = event as HoverTargetAugmentedMouseEvent;
	const explicitTarget = augmentedEvent[HOVER_TARGET_EVENT_PROPERTY];
	if (isHTMLElementLike(explicitTarget)) {
		return explicitTarget;
	}

	const composedMatch = findMatchingElementInComposedPath(
		event,
		"[data-ccl-interaction-id]",
	);
	if (composedMatch) {
		return composedMatch;
	}

	if (isHTMLElementLike(event.currentTarget)) {
		return event.currentTarget;
	}

	if (isHTMLElementLike(event.target)) {
		return event.target;
	}

	for (const entry of event.composedPath()) {
		if (isHTMLElementLike(entry)) {
			return entry;
		}
	}

	return null;
}
