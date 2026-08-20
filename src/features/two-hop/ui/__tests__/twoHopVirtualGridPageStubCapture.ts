import type { TwoHopPreviewDependencies } from "features/two-hop/runtime/virtual-grid/useTwoHopVirtualGrid.svelte";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";

/** Last props received by the mocked TwoHopVirtualGrid component. */
interface TwoHopVirtualGridPageStubProps {
	readonly applicationStore: ApplicationStore;
	readonly loadMoreSection: ((sectionId: string) => void) | undefined;
	readonly previewDependencies: TwoHopPreviewDependencies | undefined;
	readonly previewActive: boolean;
}

let latestProps: TwoHopVirtualGridPageStubProps | undefined;

export function captureTwoHopVirtualGridPageStubProps(
	props: TwoHopVirtualGridPageStubProps,
): void {
	latestProps = props;
}

export function getTwoHopVirtualGridPageStubProps():
	| TwoHopVirtualGridPageStubProps
	| undefined {
	return latestProps;
}

export function resetTwoHopVirtualGridPageStubProps(): void {
	latestProps = undefined;
}
