import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";

interface TwoHopProgressiveSurfacePageStubProps {
	readonly documentIdentity: string;
	readonly applicationStore: ApplicationStore;
	readonly previewDependencies: TwoHopPreviewDependencies | undefined;
	readonly previewActive: boolean;
	readonly offscreenBootstrapPreviewRows: number;
}

let latestProps: TwoHopProgressiveSurfacePageStubProps | undefined;

export function captureTwoHopProgressiveSurfacePageStubProps(
	props: TwoHopProgressiveSurfacePageStubProps,
): void {
	latestProps = props;
}

export function getTwoHopProgressiveSurfacePageStubProps():
	| TwoHopProgressiveSurfacePageStubProps
	| undefined {
	return latestProps;
}

export function resetTwoHopProgressiveSurfacePageStubProps(): void {
	latestProps = undefined;
}
