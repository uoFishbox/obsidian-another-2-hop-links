import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";

interface TwoHopSurfacePageStubProps {
	readonly applicationStore: ApplicationStore;
	readonly previewDependencies: TwoHopPreviewDependencies | undefined;
	readonly previewActive: boolean;
}

let latestProps: TwoHopSurfacePageStubProps | undefined;

export function captureTwoHopSurfacePageStubProps(
	props: TwoHopSurfacePageStubProps,
): void {
	latestProps = props;
}

export function getTwoHopSurfacePageStubProps():
	| TwoHopSurfacePageStubProps
	| undefined {
	return latestProps;
}

export function resetTwoHopSurfacePageStubProps(): void {
	latestProps = undefined;
}
