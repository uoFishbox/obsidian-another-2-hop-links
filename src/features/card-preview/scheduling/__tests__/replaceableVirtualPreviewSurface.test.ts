import { describe, expect, it, vi } from "vitest";
import type { VirtualPreviewSurface } from "features/card-preview/scheduling/virtualPreviewSurface";
import { createReplaceableVirtualPreviewSurface } from "features/card-preview/scheduling/replaceableVirtualPreviewSurface";

function createSurfaceProbe() {
	const hostLease = { dispose: vi.fn() };
	const surface: VirtualPreviewSurface = {
		registerHost: vi.fn(() => hostLease),
		commit: vi.fn(),
		beginBindings: vi.fn(),
		bindSlot: vi.fn(),
		endBindings: vi.fn(),
		setActiveRange: vi.fn(),
		dispose: vi.fn(),
	};
	return { hostLease, surface };
}

describe("createReplaceableVirtualPreviewSurface", () => {
	it("moves existing hosts and subsequent publications to the replacement", () => {
		const first = createSurfaceProbe();
		const second = createSurfaceProbe();
		const facade = createReplaceableVirtualPreviewSurface(first.surface);
		const host = {} as HTMLElement;
		const lease = facade.registerHost("slot", host);

		facade.replace(second.surface);
		facade.setActiveRange(2, 4, true);

		expect(first.hostLease.dispose).toHaveBeenCalledOnce();
		expect(first.surface.dispose).toHaveBeenCalledOnce();
		expect(second.surface.registerHost).toHaveBeenCalledWith("slot", host);
		expect(second.surface.setActiveRange).toHaveBeenCalledWith(2, 4, true);

		lease.dispose();
		expect(second.hostLease.dispose).toHaveBeenCalledOnce();
	});
});
