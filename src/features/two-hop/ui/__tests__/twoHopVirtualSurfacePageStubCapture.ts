import type { TwoHopPreviewDependencies } from "features/two-hop/ui/useTwoHopVirtualList.svelte";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";

interface TwoHopVirtualSurfacePageStubProps {
	readonly documentIdentity: string;
	readonly applicationStore: ApplicationStore;
	readonly loadMoreSection: ((sectionId: string) => void) | undefined;
	readonly previewDependencies: TwoHopPreviewDependencies | undefined;
	readonly previewActive: boolean;
	readonly offscreenBootstrapPreviewRows: number;
}

let latestProps: TwoHopVirtualSurfacePageStubProps | undefined;

export function captureTwoHopVirtualSurfacePageStubProps(
	props: TwoHopVirtualSurfacePageStubProps,
): void {
	latestProps = props;
}

export function getTwoHopVirtualSurfacePageStubProps():
	| TwoHopVirtualSurfacePageStubProps
	| undefined {
	return latestProps;
}

export function resetTwoHopVirtualSurfacePageStubProps(): void {
	latestProps = undefined;
}
