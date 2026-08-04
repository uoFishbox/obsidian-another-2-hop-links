import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewActivationScheduler } from "features/card-preview/scheduling/previewActivationScheduler";
import { createVirtualPreviewSurface } from "features/card-preview/scheduling/virtualPreviewSurface";
import type { CardPreviewRenderer } from "features/card-preview/ui/cardPreviewRenderer";
import type { CardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";

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
	it("disposes multiple logical slots after their hosts and bindings are released", async () => {
		const harness = createSurface();
		const firstLease = harness.surface.registerHost(
			"logical-slot",
			document.createElement("div"),
		);
		const secondLease = harness.surface.registerHost(
			"logical-slot-2",
			document.createElement("div"),
		);
		harness.surface.beginBindings();
		harness.surface.bindSlot("logical-slot", 0, "owner-a", request);
		harness.surface.bindSlot("logical-slot-2", 1, "owner-b", request);
		harness.surface.endBindings();
		harness.surface.setActiveRange(0, 2, true);
		await vi.advanceTimersByTimeAsync(32);
		firstLease.dispose();
		secondLease.dispose();

		expect(harness.disposedSlotIds).toEqual([]);

		harness.surface.beginBindings();
		harness.surface.endBindings();
		harness.surface.setActiveRange(0, 0, true);
		await vi.advanceTimersByTimeAsync(32);

		expect(harness.disposedSlotIds).toEqual(["logical-slot", "logical-slot-2"]);
		harness.dispose();
	});
});
