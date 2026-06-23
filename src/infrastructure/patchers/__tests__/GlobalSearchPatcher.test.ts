import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TaggedNote } from "types/domain";

const { openTagNotesView } = vi.hoisted(() => ({
	openTagNotesView: vi.fn(),
}));

vi.mock("ui/views/TagNotesView", () => ({
	openTagNotesView,
}));

import { initGlobalSearchPatcher } from "../GlobalSearchPatcher";
import { PatchRegistry } from "infrastructure/capabilities/PatchRegistry";

function createPlugin(getNotesWithTag: (tag: string) => Promise<TaggedNote[]>) {
	const originalOpenGlobalSearch = vi.fn();
	const instance = {
		openGlobalSearch: originalOpenGlobalSearch,
	};
	const plugin = {
		settings: {
			enableGlobalSearchTagModal: true,
		},
		indexingService: {
			getNotesWithTag: vi.fn(getNotesWithTag),
		},
		app: {
			workspace: {
				onLayoutReady: vi.fn((callback: () => void) => callback()),
				getActiveFile: vi.fn(() => ({ path: "source.md" })),
				revealLeaf: vi.fn(),
			},
			internalPlugins: {
				getPluginById: vi.fn(() => ({ instance })),
			},
		},
		register: vi.fn(),
	};

	initGlobalSearchPatcher(plugin as any, new PatchRegistry());

	return {
		instance,
		originalOpenGlobalSearch,
		indexingService: plugin.indexingService,
	};
}

async function flushAsyncTasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("GlobalSearchPatcher", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("tag: search opens TagNotesView after async tag index check", async () => {
		let resolveNotes: ((notes: TaggedNote[]) => void) | undefined;
		const { instance, originalOpenGlobalSearch, indexingService } = createPlugin(
			() =>
				new Promise<TaggedNote[]>((resolve) => {
					resolveNotes = resolve;
				}),
		);

		instance.openGlobalSearch("tag:shared");

		expect(originalOpenGlobalSearch).not.toHaveBeenCalled();

		resolveNotes?.([{ path: "note.md" } as TaggedNote]);
		await flushAsyncTasks();

		expect(indexingService.getNotesWithTag).toHaveBeenCalledWith("shared");
		expect(openTagNotesView).toHaveBeenCalledWith(
			expect.anything(),
			"shared",
			"source.md",
			false,
		);
		expect(originalOpenGlobalSearch).not.toHaveBeenCalled();
	});

	test("tag: falls back to original Global Search when tag results are empty", async () => {
		const { instance, originalOpenGlobalSearch, indexingService } = createPlugin(
			async () => [],
		);

		instance.openGlobalSearch("tag:missing");
		await flushAsyncTasks();

		expect(indexingService.getNotesWithTag).toHaveBeenCalledWith("missing");
		expect(openTagNotesView).not.toHaveBeenCalled();
		expect(originalOpenGlobalSearch).toHaveBeenCalledWith("tag:missing");
	});
});
