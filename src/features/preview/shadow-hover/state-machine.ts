import type {
	HoverAnchorTarget,
	HoverSessionEvent,
	HoverSessionInteractionEvent,
	HoverSessionInteractionState,
	HoverSessionOpenPopover,
	HoverSessionState,
} from "./internal-types";

export function createInitialHoverSessionState(): HoverSessionState {
	return {
		type: "idle",
		requestSeq: 0,
	};
}

export function createInitialHoverSessionInteractionState(): HoverSessionInteractionState {
	return {
		overAnchor: false,
		overPopover: false,
		outsideInteractionUntil: 0,
	};
}

// Hot path: this reducer mutates `state` in place.
// `HoverSessionInteractionState` is a fixed-shape flag bag (three scalar fields)
// shared across all hover/pointermove events. Returning a fresh object here
// (via object spread on every interaction event) was the dominant allocation
// source during hover/scroll bursts. Mutating in place eliminates the per-event
// allocation while keeping the public surface (`\`return state\``) stable so
// existing `expect(...).toEqual(...)` tests still pass.
//
// Unlike `transitionHoverSession` below, this reducer never switches its
// `type` discriminant, so the object's V8 HiddenClass stays stable across
// updates.
export function transitionHoverSessionInteraction(
	state: HoverSessionInteractionState,
	event: HoverSessionInteractionEvent,
): HoverSessionInteractionState {
	switch (event.type) {
		case "interaction-sync":
			state.overAnchor = event.overAnchor;
			state.overPopover = event.overPopover;
			return state;
		case "anchor-hover-sync":
			state.overAnchor = event.overAnchor;
			return state;
		case "popover-hover-sync":
			state.overPopover = event.overPopover;
			return state;
		case "outside-interaction":
			state.outsideInteractionUntil = event.until;
			return state;
		case "interaction-reset":
			state.overAnchor = false;
			state.overPopover = false;
			state.outsideInteractionUntil = 0;
			return state;
		default: {
			const _exhaustive: never = event;
			return _exhaustive;
		}
	}
}

export function transitionHoverSession(
	state: HoverSessionState,
	event: HoverSessionEvent,
): HoverSessionState {
	if (state.type === "destroyed") {
		return state;
	}

	switch (event.type) {
		case "anchor-sync":
			return syncAnchor(state, event.anchor);
		case "request-open":
			return {
				type: "opening",
				anchor: event.anchor,
				requestSeq: event.requestSeq,
				previous: getSessionOpenPopover(state),
			};
		case "request-cancel":
			if (
				state.type !== "opening" ||
				state.requestSeq !== event.requestSeq
			) {
				return state;
			}
			return state.previous
				? {
						type: "open",
						anchor: state.anchor,
						requestSeq: state.requestSeq,
						assigned: state.previous,
					}
				: {
						type: "hovering-anchor",
						anchor: state.anchor,
						requestSeq: state.requestSeq,
					};
		case "handoff-start":
			return {
				type: "handoff",
				from: {
					anchor: event.fromAnchor,
					popover: event.fromPopover,
					hoverParent: event.fromHoverParent,
				},
				to: event.toAnchor,
				requestSeq: event.requestSeq,
			};
		case "popover-assigned":
			if (
				state.requestSeq !== event.requestSeq ||
				getSessionAnchor(state)?.proxyEl !== event.anchor.proxyEl
			) {
				return state;
			}
			return {
				type: "open",
				anchor: event.anchor,
				requestSeq: event.requestSeq,
				assigned: {
					popover: event.popover,
					hoverParent: event.hoverParent,
				},
			};
		case "popover-cleared":
			return clearAssignedPopover(state, event.popover, event.hoverParent);
		case "handoff-timeout":
			if (
				state.type !== "handoff" ||
				state.requestSeq !== event.requestSeq
			) {
				return state;
			}
			return {
				type: "closing",
				anchor: state.to,
				requestSeq: state.requestSeq,
				popover: state.from.popover,
				hoverParent: state.from.hoverParent,
				reason: "handoff-timeout",
			};
		case "close-start":
			if (getSessionPopover(state) !== event.popover) {
				return state;
			}
			if (state.type === "closing") {
				return {
					...state,
					reason: event.reason,
				};
			}
			return {
				type: "closing",
				anchor: getSessionAnchor(state),
				requestSeq: state.requestSeq,
				popover: event.popover,
				hoverParent: getSessionOpenPopover(state)?.hoverParent ?? null,
				reason: event.reason,
			};
		case "close-finish":
			if (state.type !== "closing" || state.popover !== event.popover) {
				return state;
			}
			return state.anchor
				? {
						type: "hovering-anchor",
						anchor: state.anchor,
						requestSeq: state.requestSeq,
					}
				: {
						type: "idle",
						requestSeq: state.requestSeq,
					};
		case "destroy":
			return {
				type: "destroyed",
				requestSeq: state.requestSeq,
			};
		default: {
			const _exhaustive: never = event;
			return _exhaustive;
		}
	}
}

export function getSessionAnchor(
	state: HoverSessionState,
): HoverAnchorTarget | null {
	switch (state.type) {
		case "hovering-anchor":
		case "opening":
		case "open":
			return state.anchor;
		case "handoff":
			return state.to;
		case "closing":
			return state.anchor;
		case "idle":
		case "destroyed":
			return null;
		default: {
			const _exhaustive: never = state;
			return _exhaustive;
		}
	}
}

export function getSessionOpenPopover(
	state: HoverSessionState,
): HoverSessionOpenPopover | null {
	switch (state.type) {
		case "opening":
			return state.previous;
		case "open":
			return state.assigned;
		case "handoff":
			return state.from;
		case "idle":
		case "hovering-anchor":
		case "closing":
		case "destroyed":
			return null;
		default: {
			const _exhaustive: never = state;
			return _exhaustive;
		}
	}
}

export function getSessionPopover(
	state: HoverSessionState,
): HoverSessionOpenPopover["popover"] | null {
	if (state.type === "closing") {
		return state.popover;
	}
	return getSessionOpenPopover(state)?.popover ?? null;
}

export function getSessionPopoverHoverParent(
	state: HoverSessionState,
	popover: HoverSessionOpenPopover["popover"],
): HoverSessionOpenPopover["hoverParent"] {
	if (state.type === "closing") {
		return state.popover === popover ? state.hoverParent : null;
	}
	const openPopover = getSessionOpenPopover(state);
	return openPopover?.popover === popover ? openPopover.hoverParent : null;
}

function syncAnchor(
	state: Exclude<HoverSessionState, { type: "destroyed" }>,
	anchor: HoverAnchorTarget,
): HoverSessionState {
	switch (state.type) {
		case "idle":
		case "hovering-anchor":
			return {
				type: "hovering-anchor",
				anchor,
				requestSeq: state.requestSeq,
			};
		case "opening":
		case "open":
			return {
				...state,
				anchor,
			};
		case "handoff":
			return {
				...state,
				to: anchor,
			};
		case "closing":
			return {
				...state,
				anchor,
			};
		default: {
			const _exhaustive: never = state;
			return _exhaustive;
		}
	}
}

function clearAssignedPopover(
	state: HoverSessionState,
	popover: HoverSessionOpenPopover["popover"],
	hoverParent: HoverSessionOpenPopover["hoverParent"],
): HoverSessionState {
	switch (state.type) {
		case "open":
			if (
				state.assigned.popover !== popover ||
				state.assigned.hoverParent !== hoverParent
			) {
				return state;
			}
			return {
				type: "hovering-anchor",
				anchor: state.anchor,
				requestSeq: state.requestSeq,
			};
		case "opening":
			if (
				state.previous?.popover !== popover ||
				state.previous.hoverParent !== hoverParent
			) {
				return state;
			}
			return {
				...state,
				previous: null,
			};
		case "handoff":
			if (
				state.from.popover !== popover ||
				state.from.hoverParent !== hoverParent
			) {
				return state;
			}
			return {
				type: "hovering-anchor",
				anchor: state.to,
				requestSeq: state.requestSeq,
			};
		case "idle":
		case "hovering-anchor":
		case "closing":
		case "destroyed":
			return state;
		default: {
			const _exhaustive: never = state;
			return _exhaustive;
		}
	}
}
