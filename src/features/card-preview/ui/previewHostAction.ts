import type { ActionReturn } from "svelte/action";
import type { PreviewHostLease } from "features/card-preview/scheduling/virtualPreviewSurface";
import { getVirtualPreviewSurface } from "features/card-preview/ui/virtualPreviewSurfaceContext";

/**
 * Registers the bound element as a preview host on the virtual preview surface.
 *
 * Replaces the {@link PreviewHost} component on hot paths where mounting a
 * Svelte component per host is avoidable. The host element is registered on
 * mount, re-registered only when the slot ID changes, and released on destroy.
 */
export function previewHost(node: HTMLElement, slotId: string): ActionReturn<string> {
	const surface = getVirtualPreviewSurface();
	let currentSlotId = slotId;
	let lease: PreviewHostLease = surface.registerHost(currentSlotId, node);

	return {
		update(nextSlotId: string): void {
			if (nextSlotId === currentSlotId) return;
			lease.dispose();
			currentSlotId = nextSlotId;
			lease = surface.registerHost(currentSlotId, node);
		},
		destroy(): void {
			lease.dispose();
		},
	};
}
