import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createRowPreviewController,
	type RowPreviewCardBinding,
} from "../rowPreviewController.svelte";
import { resetPreviewActivationSchedulerForTests } from "../previewActivationScheduler";
import type { CardPreviewSnapshot } from "features/preview/ui/cardPreviewSnapshot";
import type { TFile } from "obsidian";

const FRAME_INTERVAL_MS = 1000 / 60;

function createPreviewSnapshot(identity: string, path: string): CardPreviewSnapshot {
	return {
		identity,
		file: { path, extension: "md" } as TFile,
		searchQuery: "",
		previewRefreshToken: 0,
		previewOverride: null,
	};
}

function binding(
	slotId: string,
	rowIndex: number,
	snapshot: CardPreviewSnapshot,
): RowPreviewCardBinding {
	return { slotId, rowIndex, snapshot };
}

async function flushAnimationFrame(): Promise<void> {
	await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS);
	await Promise.resolve();
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) =>
			setTimeout(() => {
				callback(FRAME_INTERVAL_MS);
			}, FRAME_INTERVAL_MS),
		),
	);
	vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
		clearTimeout(handle);
	});
});

afterEach(() => {
	resetPreviewActivationSchedulerForTests();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("rowPreviewController", () => {
	it("activates slots inside the preview range and clears them outside", async () => {
		const controller = createRowPreviewController();
		const snapshot = createPreviewSnapshot("preview-a", "notes/a.md");

		controller.syncCards([binding("slot-0", 2, snapshot)]);
		controller.setPreviewRange({ start: 2, end: 3 });
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(controller.getSlotState("slot-0")?.snapshot).toBe(snapshot);

		controller.setPreviewRange({ start: 0, end: 0 });
		expect(controller.getSlotState("slot-0")?.snapshot).toBeUndefined();
		controller.dispose();
	});

	it("activates only the current logical card after a physical slot rebind", async () => {
		const controller = createRowPreviewController();
		const first = createPreviewSnapshot("preview-a", "notes/a.md");
		const second = createPreviewSnapshot("preview-b", "notes/b.md");

		controller.syncCards([binding("slot-0", 0, first)]);
		controller.setPreviewRange({ start: 0, end: 1 });
		controller.syncCards([binding("slot-0", 1, second)]);
		controller.setPreviewRange({ start: 1, end: 2 });
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(controller.getSlotState("slot-0")?.snapshot).toBe(second);
		controller.dispose();
	});

	it("activates a slot only when its row is inside the preview range", async () => {
		const controller = createRowPreviewController();
		const snapshot = createPreviewSnapshot("preview-a", "notes/a.md");

		controller.syncCards([binding("slot-0", 0, snapshot)]);
		controller.setPreviewRange({ start: 5, end: 6 });
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(controller.getSlotState("slot-0")?.snapshot).toBeUndefined();

		controller.setPreviewRange({ start: 0, end: 1 });
		await flushAnimationFrame();
		await flushAnimationFrame();
		expect(controller.getSlotState("slot-0")?.snapshot).toBe(snapshot);
		controller.dispose();
	});

	it("activates every slot sharing the same activation identity", async () => {
		const controller = createRowPreviewController();
		const snapshotA = createPreviewSnapshot("shared", "notes/a.md");
		const snapshotB = createPreviewSnapshot("shared", "notes/b.md");

		controller.syncCards([
			binding("slot-0", 1, snapshotA),
			binding("slot-1", 5, snapshotB),
		]);
		controller.setPreviewRange({ start: 0, end: 10 });
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(controller.getSlotState("slot-0")?.snapshot).toBe(snapshotA);
		expect(controller.getSlotState("slot-1")?.snapshot).toBe(snapshotB);
		controller.dispose();
	});

	it("keeps the pending activation when a slot moves between rows with the same identity", async () => {
		const controller = createRowPreviewController();
		const snapshot = createPreviewSnapshot("shared", "notes/a.md");

		controller.syncCards([binding("slot-0", 0, snapshot)]);
		controller.setPreviewRange({ start: 0, end: 2 });
		controller.syncCards([binding("slot-0", 1, snapshot)]);
		controller.setPreviewRange({ start: 0, end: 3 });

		await flushAnimationFrame();
		await flushAnimationFrame();
		expect(controller.getSlotState("slot-0")?.snapshot).toBe(snapshot);
		controller.dispose();
	});

	it("releases the slot snapshot when the card is unbound", async () => {
		const controller = createRowPreviewController();
		const snapshot = createPreviewSnapshot("preview-a", "notes/a.md");

		controller.syncCards([binding("slot-0", 0, snapshot)]);
		controller.setPreviewRange({ start: 0, end: 1 });
		await flushAnimationFrame();
		await flushAnimationFrame();
		expect(controller.getSlotState("slot-0")?.snapshot).toBe(snapshot);

		controller.syncCards([]);
		expect(controller.getSlotState("slot-0")).toBeUndefined();
		controller.dispose();
	});
});
