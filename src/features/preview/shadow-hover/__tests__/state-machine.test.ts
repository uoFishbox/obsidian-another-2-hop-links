import { describe, expect, it } from "vitest";
import type { HoverAnchorTarget } from "../internal-types";
import {
	createInitialHoverSessionState,
	createInitialHoverSessionInteractionState,
	getSessionPopover,
	transitionHoverSession,
	transitionHoverSessionInteraction,
} from "../state-machine";

describe("transitionHoverSession", () => {
	it("moves from idle through opening and open states", () => {
		const anchor = createAnchor();
		const hoverParent = {};
		const popover = {};
		const hovering = transitionHoverSession(createInitialHoverSessionState(), {
			type: "anchor-sync",
			anchor,
		});
		const opening = transitionHoverSession(hovering, {
			type: "request-open",
			anchor,
			requestSeq: 1,
		});
		const open = transitionHoverSession(opening, {
			type: "popover-assigned",
			anchor,
			hoverParent,
			popover,
			requestSeq: 1,
		});

		expect(hovering.type).toBe("hovering-anchor");
		expect(opening.type).toBe("opening");
		expect(open.type).toBe("open");
		expect(getSessionPopover(open)).toBe(popover);
	});

	it("ignores stale popover assignments", () => {
		const anchor = createAnchor();
		const opening = transitionHoverSession(createInitialHoverSessionState(), {
			type: "request-open",
			anchor,
			requestSeq: 2,
		});

		const stale = transitionHoverSession(opening, {
			type: "popover-assigned",
			anchor,
			hoverParent: {},
			popover: {},
			requestSeq: 1,
		});

		expect(stale).toBe(opening);
	});

	it("moves a current handoff timeout into closing", () => {
		const from = createAnchor();
		const to = createAnchor();
		const popover = {};
		const handoff = transitionHoverSession(createInitialHoverSessionState(), {
			type: "handoff-start",
			fromAnchor: from,
			fromHoverParent: {},
			fromPopover: popover,
			toAnchor: to,
			requestSeq: 3,
		});
		const staleTimeout = transitionHoverSession(handoff, {
			type: "handoff-timeout",
			requestSeq: 2,
		});
		const closing = transitionHoverSession(handoff, {
			type: "handoff-timeout",
			requestSeq: 3,
		});

		expect(staleTimeout).toBe(handoff);
		expect(closing).toEqual({
			type: "closing",
			anchor: to,
			requestSeq: 3,
			popover,
			hoverParent: {},
			reason: "handoff-timeout",
		});
	});

	it("does not leave destroyed state", () => {
		const destroyed = transitionHoverSession(
			createInitialHoverSessionState(),
			{ type: "destroy" },
		);
		const next = transitionHoverSession(destroyed, {
			type: "anchor-sync",
			anchor: createAnchor(),
		});

		expect(next).toBe(destroyed);
	});
});

describe("transitionHoverSessionInteraction", () => {
	// `transitionHoverSessionInteraction` mutates its `state` argument in place
	// and returns the same object reference (allocation-free hot path for
	// hover/pointermove events). Verify each transition by inspecting the
	// shared state after every event rather than holding independent snapshots.
	it("tracks hover and outside interaction state independently", () => {
		const state = createInitialHoverSessionInteractionState();

		transitionHoverSessionInteraction(state, {
			type: "interaction-sync",
			overAnchor: true,
			overPopover: false,
		});
		expect(state).toEqual({
			overAnchor: true,
			overPopover: false,
			outsideInteractionUntil: 0,
		});

		transitionHoverSessionInteraction(state, {
			type: "outside-interaction",
			until: 120,
		});
		expect(state).toEqual({
			overAnchor: true,
			overPopover: false,
			outsideInteractionUntil: 120,
		});

		transitionHoverSessionInteraction(state, {
			type: "interaction-reset",
		});
		expect(state).toEqual(createInitialHoverSessionInteractionState());
	});
});

function createAnchor(): HoverAnchorTarget {
	return {
		actualEl: {} as HTMLElement,
		proxyEl: {} as HTMLElement,
	};
}
