import type { WorkspaceLeaf } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VIEW_TYPE_ALL_NOTES } from "search/all-notes/AllNotesView";
import { createEmptyViewController } from "../emptyViewController";

vi.mock("search/all-notes/AllNotesView", () => ({
	VIEW_TYPE_ALL_NOTES: "cosense-card-links-all-notes-view",
}));

interface EmptyViewTestHarness {
	controller: ReturnType<typeof createEmptyViewController>;
	workspace: {
		rootSplit: object;
		getMostRecentLeaf: ReturnType<typeof vi.fn>;
	};
	setCurrentMainLeaf: (leaf: WorkspaceLeaf | null) => void;
}

function createLeaf(id: string, type: string): WorkspaceLeaf {
	return {
		id,
		getViewState: vi.fn(() => ({ type })),
		setViewState: vi.fn(() => Promise.resolve()),
	} as unknown as WorkspaceLeaf;
}

function createHarness(initialMainLeaf: WorkspaceLeaf | null): EmptyViewTestHarness {
	let currentMainLeaf = initialMainLeaf;
	const rootSplit = {};
	const workspace = {
		rootSplit,
		getMostRecentLeaf: vi.fn(() => currentMainLeaf),
		getLeavesOfType: vi.fn(() => []),
	};
	const controller = createEmptyViewController(
		{ workspace } as never,
		{
			settings: { enableEmptyViewAllNotesInNewTab: true },
		} as never,
	);

	return {
		controller,
		workspace,
		setCurrentMainLeaf: (leaf) => {
			currentMainLeaf = leaf;
		},
	};
}

describe("createEmptyViewController", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("does not replace a custom view in the main area", () => {
		const customLeaf = createLeaf("custom", "custom-view");
		const { controller, workspace } = createHarness(customLeaf);

		controller.sync();

		expect(workspace.getMostRecentLeaf).toHaveBeenCalledWith(workspace.rootSplit);
		expect(customLeaf.setViewState).not.toHaveBeenCalled();

		controller.destroy();
	});

	it("replaces a still-empty main leaf after the settle delay", () => {
		const emptyLeaf = createLeaf("empty", "empty");
		const { controller } = createHarness(emptyLeaf);

		controller.sync();
		vi.advanceTimersByTime(149);
		expect(emptyLeaf.setViewState).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(emptyLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_ALL_NOTES,
		});

		controller.destroy();
	});

	it("does not replace an empty leaf after the main leaf changes", () => {
		const emptyLeaf = createLeaf("empty", "empty");
		const otherLeaf = createLeaf("other", "markdown");
		const { controller, setCurrentMainLeaf } = createHarness(emptyLeaf);

		controller.sync();
		setCurrentMainLeaf(otherLeaf);
		vi.advanceTimersByTime(150);

		expect(emptyLeaf.setViewState).not.toHaveBeenCalled();

		controller.destroy();
	});
});
