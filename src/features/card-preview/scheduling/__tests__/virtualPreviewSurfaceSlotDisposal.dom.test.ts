import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewActivationScheduler } from "features/card-preview/scheduling/previewActivationScheduler";
import { createVirtualPreviewSurface } from "features/card-preview/scheduling/virtualPreviewSurface";
import type { CardPreviewRenderer } from "features/card-preview/ui/cardPreviewRenderer";
import type { CardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";

const request = {
	renderKey: "preview-key",
} as CardPreviewRequest;

function publishBinding(
	surface: ReturnType<typeof createVirtualPreviewSurface>,
	bound: boolean,
	range: { start: number; end: number },
): void {
	surface.syncBindings(bound ? [{ key: "logical-slot", rowIndex: 0, request }] : []);
	surface.setActiveRange(range.start, range.end, true);
}

function createSurface() {
	const activationScheduler = createPreviewActivationScheduler();
	const renderer: CardPreviewRenderer = () => () => {};
	const disposedSlotIds: string[] = [];
	const surface = createVirtualPreviewSurface({
		activationScheduler,
		createRenderer: () => renderer,
		onEntryDisposed: (slotId) => disposedSlotIds.push(slotId),
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
		harness.surface.syncBindings([
			{ key: "logical-slot", rowIndex: 0, request },
			{ key: "logical-slot-2", rowIndex: 1, request },
		]);
		harness.surface.setActiveRange(0, 2, true);
		await vi.advanceTimersByTimeAsync(32);
		firstLease.dispose();
		secondLease.dispose();

		expect(harness.disposedSlotIds).toEqual([]);

		harness.surface.syncBindings([]);
		harness.surface.setActiveRange(0, 0, true);
		await vi.advanceTimersByTimeAsync(32);

		expect(harness.disposedSlotIds).toEqual(["logical-slot", "logical-slot-2"]);
		harness.dispose();
	});

	it("releases an unbound runtime while retaining its stable host registration", async () => {
		const harness = createSurface();
		const hostLease = harness.surface.registerHost(
			"logical-slot",
			document.createElement("div"),
		);

		publishBinding(harness.surface, true, { start: 0, end: 1 });
		await vi.advanceTimersByTimeAsync(32);

		publishBinding(harness.surface, false, { start: 1, end: 2 });
		await vi.advanceTimersByTimeAsync(32);

		expect(harness.disposedSlotIds).toEqual(["logical-slot"]);

		publishBinding(harness.surface, true, { start: 0, end: 1 });
		await vi.advanceTimersByTimeAsync(32);

		expect(harness.disposedSlotIds).toEqual(["logical-slot"]);
		hostLease.dispose();
		harness.dispose();
	});
});
