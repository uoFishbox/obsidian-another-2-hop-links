import { describe, expect, it } from "vitest";
import {
	hasRelevantStructureMutation,
	shouldIgnoreStructureMutationNode,
} from "../structureMutationObserver";

const createMutationRecord = (params: {
	target: Node;
	addedNodes?: readonly Node[];
	removedNodes?: readonly Node[];
}): MutationRecord =>
	({
		type: "childList",
		target: params.target,
		addedNodes: params.addedNodes ?? [],
		removedNodes: params.removedNodes ?? [],
	}) as unknown as MutationRecord;

describe("structureMutationObserver", () => {
	it("ignores known transient popover and preview nodes", () => {
		const proxy = document.createElement("div");
		proxy.dataset.cclShadowHoverProxy = "true";

		expect(shouldIgnoreStructureMutationNode(proxy)).toBe(true);
	});

	it("detects relevant added structure", () => {
		const target = document.createElement("div");
		const added = document.createElement("section");

		expect(
			hasRelevantStructureMutation(
				createMutationRecord({
					target,
					addedNodes: [added],
				}),
			),
		).toBe(true);
	});

	it("ignores mutations scoped under ignored elements", () => {
		const target = document.createElement("div");
		const ignored = document.createElement("div");
		const child = document.createElement("span");
		ignored.classList.add("popover");
		ignored.append(child);

		expect(
			hasRelevantStructureMutation(
				createMutationRecord({
					target,
					addedNodes: [child],
				}),
			),
		).toBe(false);
	});
});
