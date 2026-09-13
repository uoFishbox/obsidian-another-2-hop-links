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
import {
	createFlatGridCardBindingsMemo,
	isMountedFlatGridItemCell,
} from "./mountedCardBindings";
import type { MountedFlatGridBuild, MountedFlatGridCell } from "./mountedRows";

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
	let lastInteractionMountedBuild: MountedFlatGridBuild<T> | null | undefined;
	let lastInteractionResolver:
		| ((item: T, index: number) => ItemInteractionDescriptor | null)
		| undefined;

	function resolveInteractionDescriptor(
		mountedCell: MountedFlatGridCell<T>,
	): ItemInteractionDescriptor | null | undefined {
		if (!isMountedFlatGridItemCell(mountedCell)) return undefined;
		return (
			lastInteractionResolver?.(
				mountedCell.cell.item,
				mountedCell.cell.itemIndex,
			) ?? null
		);
	}

	function publish(
		mountedBuild: MountedFlatGridBuild<T> | null,
		visibleRange: RowRange,
	): void {
		const interactionResolver = options.getInteractionDescriptorResolver();
		const bindings = resolveCardBindings({
			mountedBuild,
			previewCardDimensions: options.getPreviewCardDimensions(),
			resolvePreviewRequest: options.getPreviewRequestResolver(),
		});
		options.previewSurface.publish({
			bindings: bindings.previewBindings,
			visibleRange,
			prefetchRange: previewPrefetchRangeTracker.resolve(
				visibleRange,
				options.getRowCount(),
			),
			active: true,
		});
		if (
			mountedBuild !== lastInteractionMountedBuild ||
			interactionResolver !== lastInteractionResolver
		) {
			lastInteractionMountedBuild = mountedBuild;
			lastInteractionResolver = interactionResolver;
			interactionController.syncMountedRows(
				mountedBuild?.rowsInMountedRange ?? [],
				resolveInteractionDescriptor,
			);
		}
	}

	return {
		previewSurface: options.previewSurface,
		interactionDescriptorResolverProvider: interactionController,
		publish,
		getInteractionHandle: (physicalCellSlot) =>
			interactionController.getInteractionHandle(physicalCellSlot),
		dispose(): void {
			options.previewSurface.dispose();
			interactionController.clear();
		},
	};
}
