import { describe, expect, it } from "vitest";
import {
	createMountedRangeTransitionScratch,
	planMountedRangeTransition,
	type MountedRangeTransitionInput,
} from "../twoHopMountedRangeTransition";

type Operation = `bind:${number}` | `clear:${number}` | "clear-all";

function collectPlannedOperations(input: MountedRangeTransitionInput): Operation[] {
	const transition = planMountedRangeTransition(
		createMountedRangeTransitionScratch(),
		input,
	);
	if (!transition.shouldCommit) return [];
	if (transition.clearAll) return ["clear-all"];
	if (transition.rebindAll) {
		const operations: Operation[] = [];
		if (transition.clearOutsideNextRange) operations.push("clear-all");
		for (let row = input.next.start; row < input.next.end; row += 1) {
			operations.push(`bind:${row}`);
		}
		return operations;
	}

	const operations: Operation[] = [];
	appendRange(
		operations,
		"bind",
		transition.enteringLeadingStart,
		transition.enteringLeadingEnd,
	);
	appendRange(
		operations,
		"bind",
		transition.enteringTrailingStart,
		transition.enteringTrailingEnd,
	);
	appendRange(operations, "bind", transition.dirtyStart, transition.dirtyEnd);
	appendRange(
		operations,
		"clear",
		transition.leavingLeadingStart,
		transition.leavingLeadingEnd,
	);
	appendRange(
		operations,
		"clear",
		transition.leavingTrailingStart,
		transition.leavingTrailingEnd,
	);
	return operations;
}

function collectLegacyOperations(input: MountedRangeTransitionInput): Operation[] {
	const hasDirtyRows =
		input.dirty.start < input.dirty.end &&
		input.dirty.start < input.next.end &&
		input.dirty.end > input.next.start;
	const rangeChanged =
		input.previous.start !== input.next.start ||
		input.previous.end !== input.next.end;
	if (!input.planChanged && !input.poolChanged && !rangeChanged && !hasDirtyRows) {
		return [];
	}
	if (input.capacity === 0) return ["clear-all"];
	if (input.planChanged || input.poolChanged) {
		const operations: Operation[] = [];
		if (input.planChanged && !input.poolChanged) operations.push("clear-all");
		for (let row = input.next.start; row < input.next.end; row += 1) {
			operations.push(`bind:${row}`);
		}
		return operations;
	}

	const operations: Operation[] = [];
	appendRange(
		operations,
		"bind",
		input.next.start,
		Math.min(input.next.end, input.previous.start),
	);
	appendRange(
		operations,
		"bind",
		Math.max(input.next.start, input.previous.end),
		input.next.end,
	);
	if (hasDirtyRows) {
		appendRange(
			operations,
			"bind",
			Math.max(input.next.start, input.dirty.start),
			Math.min(input.next.end, input.dirty.end),
		);
	}
	appendRange(
		operations,
		"clear",
		input.previous.start,
		Math.min(input.previous.end, input.next.start),
	);
	appendRange(
		operations,
		"clear",
		Math.max(input.previous.start, input.next.end),
		input.previous.end,
	);
	return operations;
}

function appendRange(
	operations: Operation[],
	kind: "bind" | "clear",
	start: number,
	end: number,
): void {
	for (let row = start; row < end; row += 1) operations.push(`${kind}:${row}`);
}

function createRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1_664_525 + 1_013_904_223) >>> 0;
		return state / 0x1_0000_0000;
	};
}

describe("mounted-range transition planner", () => {
	it("reuses the caller-owned scratch object", () => {
		const scratch = createMountedRangeTransitionScratch();
		expect(
			planMountedRangeTransition(scratch, {
				previous: { start: 4, end: 8 },
				next: { start: 5, end: 9 },
				dirty: {
					start: Number.POSITIVE_INFINITY,
					end: Number.NEGATIVE_INFINITY,
				},
				planChanged: false,
				poolChanged: false,
				capacity: 4,
			}),
		).toBe(scratch);
		expect(scratch.enteringTrailingStart).toBe(8);
		expect(scratch.enteringTrailingEnd).toBe(9);
		expect(scratch.leavingLeadingStart).toBe(4);
		expect(scratch.leavingLeadingEnd).toBe(5);
	});

	it("matches the legacy branch decisions for seeded range sequences", () => {
		const random = createRandom(0xc0ffee);
		for (let index = 0; index < 5_000; index += 1) {
			const previousStart = Math.floor(random() * 80);
			const previousLength = Math.floor(random() * 12);
			const nextStart = Math.floor(random() * 80);
			const nextLength = Math.floor(random() * 12);
			const dirtyStart = Math.floor(random() * 90);
			const dirtyLength = Math.floor(random() * 8);
			const input: MountedRangeTransitionInput = {
				previous: { start: previousStart, end: previousStart + previousLength },
				next: { start: nextStart, end: nextStart + nextLength },
				dirty: { start: dirtyStart, end: dirtyStart + dirtyLength },
				planChanged: random() < 0.08,
				poolChanged: random() < 0.1,
				capacity: random() < 0.05 ? 0 : Math.max(1, nextLength),
			};
			expect(collectPlannedOperations(input)).toEqual(
				collectLegacyOperations(input),
			);
		}
	});
});
