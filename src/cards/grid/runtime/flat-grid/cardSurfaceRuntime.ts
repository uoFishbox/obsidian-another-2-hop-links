import type { CardPreviewRequest } from "card-preview/pipeline/cardPreviewRequest";
import type { VirtualPreviewSurface } from "card-preview/scheduling/virtualPreviewSurface";
import type {
	InteractionHandle,
	ItemInteractionDescriptor,
} from "cards/interactions/interactionTypes";
import type { InteractionDescriptorResolverProvider } from "cards/interactions/interactionRegistry";
import { createVirtualCardInteractionController } from "cards/interactions/virtualCardInteractionController";
import type { RowRange } from "cards/virtualization/public";
import { createPreviewPrefetchRangeTracker } from "card-preview/prefetch/previewPrefetchRange";
import { createFlatGridCardBindingsMemo } from "./mountedCardBindings";
import type { MountedFlatGridBuild } from "./mountedRows";

export interface FlatGridCardSurfaceRuntimeOptions<T> {
	readonly previewSurface: VirtualPreviewSurface;
	getRowCount(): number;
	getPreviewCardDimensions(): { readonly widthPx: number; readonly heightPx: number };
	getPreviewRequestResolver():
		| ((item: T, index: number) => CardPreviewRequest | null)
		| undefined;
	getInteractionDescriptorResolver():
		| ((item: T, index: number) => ItemInteractionDescriptor | null)
		| undefined;
}

export interface FlatGridCardSurfaceRuntime<T> {
	readonly previewSurface: VirtualPreviewSurface;
	readonly interactionDescriptorResolverProvider: InteractionDescriptorResolverProvider;
	publish(mountedBuild: MountedFlatGridBuild<T> | null, visibleRange: RowRange): void;
	getInteractionHandle(physicalCellSlot: number): InteractionHandle;
	dispose(): void;
}

/** Owns preview, prefetch, and interaction publication for one flat grid. */
export function createFlatGridCardSurfaceRuntime<T>(
	options: FlatGridCardSurfaceRuntimeOptions<T>,
): FlatGridCardSurfaceRuntime<T> {
	const previewPrefetchRangeTracker = createPreviewPrefetchRangeTracker();
	const resolveCardBindings = createFlatGridCardBindingsMemo<T>();
	const interactionController = createVirtualCardInteractionController();

	function publish(
		mountedBuild: MountedFlatGridBuild<T> | null,
		visibleRange: RowRange,
	): void {
		const bindingsResult = resolveCardBindings({
			mountedBuild,
			previewCardDimensions: options.getPreviewCardDimensions(),
			resolvePreviewRequest: options.getPreviewRequestResolver(),
			resolveInteractionDescriptor: options.getInteractionDescriptorResolver(),
		});
		options.previewSurface.publish({
			bindings: bindingsResult.bindings.previewBindings,
			visibleRange,
			prefetchRange: previewPrefetchRangeTracker.resolve(
				visibleRange,
				options.getRowCount(),
			),
			active: true,
		});
		if (bindingsResult.changed) {
			interactionController.syncCards(
				bindingsResult.bindings.interactionBindings,
			);
		}
	}

	return {
		previewSurface: options.previewSurface,
		interactionDescriptorResolverProvider: interactionController,
		publish,
		getInteractionHandle: (physicalCellSlot) =>
			interactionController.getInteractionHandle(String(physicalCellSlot)),
		dispose(): void {
			options.previewSurface.dispose();
			interactionController.clear();
		},
	};
}
