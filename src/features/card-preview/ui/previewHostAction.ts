import type { ActionReturn } from "svelte/action";
import type { PreviewHostLease } from "features/card-preview/scheduling/virtualPreviewSurface";
import { getVirtualPreviewSurface } from "features/card-preview/ui/virtualPreviewSurfaceContext";

/**
 * Registers the bound element as the host for one logical card preview.
 *
 * The action follows the logical preview key rather than a physical virtual
 * slot, so a card can move between reused DOM cells without changing preview
 * identity.
 */
export function previewHost(node: HTMLElement, key: string): ActionReturn<string> {
	const surface = getVirtualPreviewSurface();
	let currentKey = key;
	let lease: PreviewHostLease = surface.registerHost(currentKey, node);

	return {
		update(nextKey: string): void {
			if (nextKey === currentKey) return;
			lease.dispose();
			currentKey = nextKey;
			lease = surface.registerHost(currentKey, node);
		},
		destroy(): void {
			lease.dispose();
		},
	};
}
