import { describe, expect, it } from "vitest";
import { PreviewRevisionState } from "preview/PreviewRevisionState.svelte";

describe("PreviewRevisionState", () => {
	it("increments only the invalidated path revision", () => {
		const state = new PreviewRevisionState();

		state.invalidate(new Set(["note.md"]));

		expect(state.getRenderVersion("note.md")).toBe("0:1");
		expect(state.getRenderVersion("other.md")).toBe("0:0");
	});

	it("increments the global revision for a full invalidation", () => {
		const state = new PreviewRevisionState();

		state.invalidate("all");

		expect(state.getRenderVersion("note.md")).toBe("1:0");
	});

	it("resets global and path revisions", () => {
		const state = new PreviewRevisionState();
		state.invalidate("all");
		state.invalidate(new Set(["note.md"]));

		state.reset();

		expect(state.getRenderVersion("note.md")).toBe("0:0");
	});
});
