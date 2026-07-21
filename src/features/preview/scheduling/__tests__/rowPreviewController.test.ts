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
	it("updates the preview window without rebinding physical slots", async () => {
		const controller = createRowPreviewController();
		const snapshot = createPreviewSnapshot("preview-a", "notes/a.md");

		controller.syncBindings([binding("slot-0", 2, snapshot)]);
		const slotState = controller.getSlotState("slot-0");
		expect(slotState?.snapshot).toBeUndefined();

		controller.setPreviewWindow({
			previewRange: { start: 2, end: 3 },
			active: true,
		});
		await flushAnimationFrame();
		await flushAnimationFrame();
		expect(controller.getSlotState("slot-0")).toBe(slotState);
		expect(slotState?.snapshot).toBe(snapshot);

		controller.setPreviewWindow({
			previewRange: { start: 3, end: 4 },
			active: true,
		});
		expect(controller.getSlotState("slot-0")).toBe(slotState);
		expect(slotState?.snapshot).toBeUndefined();
		controller.dispose();
	});

	it("reconciles new bindings against the current preview window", async () => {
		const controller = createRowPreviewController();
		const snapshot = createPreviewSnapshot("preview-a", "notes/a.md");

		controller.setPreviewWindow({
			previewRange: { start: 4, end: 5 },
			active: true,
		});
		controller.syncBindings([binding("slot-0", 4, snapshot)]);
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(controller.getSlotState("slot-0")?.snapshot).toBe(snapshot);
		controller.dispose();
	});
	it("activates slots inside the preview range and clears them outside", async () => {
		const controller = createRowPreviewController();
		const snapshot = createPreviewSnapshot("preview-a", "notes/a.md");

		controller.commit({
			cards: [binding("slot-0", 2, snapshot)],
			previewRange: { start: 2, end: 3 },
			active: true,
		});
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(controller.getSlotState("slot-0")?.snapshot).toBe(snapshot);

		controller.commit({
			cards: [binding("slot-0", 2, snapshot)],
			previewRange: { start: 0, end: 0 },
			active: true,
		});
		expect(controller.getSlotState("slot-0")?.snapshot).toBeUndefined();
		controller.dispose();
	});

	it("activates only the current logical card after a physical slot rebind", async () => {
		const controller = createRowPreviewController();
		const first = createPreviewSnapshot("preview-a", "notes/a.md");
		const second = createPreviewSnapshot("preview-b", "notes/b.md");

		controller.commit({
			cards: [binding("slot-0", 0, first)],
			previewRange: { start: 0, end: 1 },
			active: true,
		});
		controller.commit({
			cards: [binding("slot-0", 1, second)],
			previewRange: { start: 1, end: 2 },
			active: true,
		});
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(controller.getSlotState("slot-0")?.snapshot).toBe(second);
		controller.dispose();
	});

	it("activates a slot only when its row is inside the preview range", async () => {
		const controller = createRowPreviewController();
		const snapshot = createPreviewSnapshot("preview-a", "notes/a.md");
		const cards = [binding("slot-0", 0, snapshot)];

		controller.commit({
			cards,
			previewRange: { start: 5, end: 6 },
			active: true,
		});
		await flushAnimationFrame();
		await flushAnimationFrame();
		expect(controller.getSlotState("slot-0")?.snapshot).toBeUndefined();

		controller.commit({
			cards,
			previewRange: { start: 0, end: 1 },
			active: true,
		});
		await flushAnimationFrame();
		await flushAnimationFrame();
		expect(controller.getSlotState("slot-0")?.snapshot).toBe(snapshot);
		controller.dispose();
	});

	it("activates every slot sharing the same activation identity", async () => {
		const controller = createRowPreviewController();
		const snapshotA = createPreviewSnapshot("shared", "notes/a.md");
		const snapshotB = createPreviewSnapshot("shared", "notes/b.md");

		controller.commit({
			cards: [binding("slot-0", 1, snapshotA), binding("slot-1", 5, snapshotB)],
			previewRange: { start: 0, end: 10 },
			active: true,
		});
		await flushAnimationFrame();
		await flushAnimationFrame();

		expect(controller.getSlotState("slot-0")?.snapshot).toBe(snapshotA);
		expect(controller.getSlotState("slot-1")?.snapshot).toBe(snapshotB);
		controller.dispose();
	});

	it("keeps the pending activation when a slot moves with the same identity", async () => {
		const controller = createRowPreviewController();
		const snapshot = createPreviewSnapshot("shared", "notes/a.md");

		controller.commit({
			cards: [binding("slot-0", 0, snapshot)],
			previewRange: { start: 0, end: 2 },
			active: true,
		});
		controller.commit({
			cards: [binding("slot-0", 1, snapshot)],
			previewRange: { start: 0, end: 3 },
			active: true,
		});

		await flushAnimationFrame();
		await flushAnimationFrame();
		expect(controller.getSlotState("slot-0")?.snapshot).toBe(snapshot);
		controller.dispose();
	});

	it("releases snapshots when a surface becomes inactive or unbound", async () => {
		const controller = createRowPreviewController();
		const snapshot = createPreviewSnapshot("preview-a", "notes/a.md");
		const cards = [binding("slot-0", 0, snapshot)];

		controller.commit({
			cards,
			previewRange: { start: 0, end: 1 },
			active: true,
		});
		await flushAnimationFrame();
		await flushAnimationFrame();
		expect(controller.getSlotState("slot-0")?.snapshot).toBe(snapshot);

		controller.commit({
			cards,
			previewRange: { start: 0, end: 1 },
			active: false,
		});
		expect(controller.getSlotState("slot-0")?.snapshot).toBeUndefined();

		controller.commit({
			cards: [],
			previewRange: { start: 0, end: 1 },
			active: true,
		});
		expect(controller.getSlotState("slot-0")).toBeUndefined();
		controller.dispose();
	});
});
