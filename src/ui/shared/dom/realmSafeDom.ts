export function isEventLike(value: unknown): value is Event {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as Event).type === "string" &&
		typeof (value as Event).composedPath === "function" &&
		"target" in value
	);
}

export function isNodeLike(value: unknown): value is Node {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as Node).nodeType === "number" &&
		typeof (value as Node).nodeName === "string"
	);
}

export function isElementLike(value: unknown): value is Element {
	return (
		isNodeLike(value) &&
		(value as Node).nodeType === 1 &&
		typeof (value as Element).matches === "function" &&
		typeof (value as Element).closest === "function"
	);
}

export function isHTMLElementLike(value: unknown): value is HTMLElement {
	return (
		isElementLike(value) &&
		"dataset" in value &&
		"style" in value &&
		"classList" in value
	);
}

export function isShadowRootLike(value: unknown): value is ShadowRoot {
	return (
		isNodeLike(value) &&
		(value as Node).nodeType === 11 &&
		"host" in value &&
		typeof (value as ShadowRoot).contains === "function"
	);
}

export function isDocumentLike(value: unknown): value is Document {
	return (
		isNodeLike(value) &&
		(value as Node).nodeType === 9 &&
		"documentElement" in value
	);
}

export function isMouseEventLike(value: unknown): value is MouseEvent {
	return (
		isEventLike(value) &&
		"button" in value &&
		"buttons" in value &&
		"ctrlKey" in value &&
		"metaKey" in value &&
		"clientX" in value &&
		"clientY" in value
	);
}

export function getOwnerWindow(node: Node | null | undefined): Window {
	return node?.ownerDocument?.defaultView ?? window;
}

export function getOptionalOwnerWindow(node: Node | null | undefined): Window | null {
	return (
		node?.ownerDocument?.defaultView ??
		(typeof window === "undefined" ? null : window)
	);
}

type WindowEventConstructors = Window & {
	MouseEvent: typeof MouseEvent;
	PointerEvent?: typeof PointerEvent;
	FocusEvent: typeof FocusEvent;
};

export function getWindowEventConstructors(win: Window): WindowEventConstructors {
	return win as WindowEventConstructors;
}

export function createOwnerMouseEvent(
	node: Node | null | undefined,
	type: string,
	init?: MouseEventInit,
): MouseEvent {
	const constructors = getWindowEventConstructors(getOwnerWindow(node));
	return new constructors.MouseEvent(type, init);
}

export function createOwnerPointerEvent(
	node: Node | null | undefined,
	type: string,
	init?: PointerEventInit,
): PointerEvent | MouseEvent {
	const constructors = getWindowEventConstructors(getOwnerWindow(node));
	if (constructors.PointerEvent) {
		return new constructors.PointerEvent(type, init);
	}
	return new constructors.MouseEvent(type, init);
}

export function createOwnerFocusEvent(
	node: Node | null | undefined,
	type: string,
	init?: FocusEventInit,
): FocusEvent {
	const constructors = getWindowEventConstructors(getOwnerWindow(node));
	return new constructors.FocusEvent(type, init);
}
