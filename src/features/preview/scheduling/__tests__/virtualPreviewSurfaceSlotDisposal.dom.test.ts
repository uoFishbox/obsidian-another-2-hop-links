import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewActivationScheduler } from "features/preview/scheduling/previewActivationScheduler";
import { createVirtualPreviewSurface } from "features/preview/scheduling/virtualPreviewSurface";
import type { CardPreviewRenderer } from "features/preview/ui/cardPreviewRenderer";
import type { CardPreviewRequest } from "features/preview/core/cardPreviewRequest";

const request = {
	renderKey: "preview-key",
} as CardPreviewRequest;

function createSurface() {
	const activationScheduler = createPreviewActivationScheduler();
	const renderer: CardPreviewRenderer = () => () => {};
	const disposedSlotIds: string[] = [];
	const surface = createVirtualPreviewSurface({
		activationScheduler,
		createRenderer: () => renderer,
		onSlotDisposed: (slotId) => disposedSlotIds.push(slotId),
	});
	return {
		surface,
		disposedSlotIds,
		dispose: () => {
			surface.dispose();
			activationScheduler.dispose();
		},
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) => setTimeout(() => callback(16), 16)),
	);
	vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("VirtualPreviewSurface slot disposal", () => {
	it("disposes a logical slot after both its host and binding are released", async () => {
		const harness = createSurface();
		const lease = harness.surface.registerHost(
			"logical-slot",
			document.createElement("div"),
		);
		harness.surface.publish({
			previewBindingsBySlot: new Map([
				[
					"logical-slot",
					{
						slotId: "logical-slot",
						rowIndex: 0,
						request,
						ownerToken: {},
					},
				],
			]),
			previewWindow: {
				previewRange: { start: 0, end: 1 },
				active: true,
			},
		});
		await vi.advanceTimersByTimeAsync(32);
		lease.dispose();

		expect(harness.disposedSlotIds).toEqual([]);

		harness.surface.publish({
			previewBindingsBySlot: new Map(),
			previewWindow: {
				previewRange: { start: 0, end: 0 },
				active: true,
			},
		});
		await vi.advanceTimersByTimeAsync(32);

		expect(harness.disposedSlotIds).toEqual(["logical-slot"]);
		harness.dispose();
	});
});
