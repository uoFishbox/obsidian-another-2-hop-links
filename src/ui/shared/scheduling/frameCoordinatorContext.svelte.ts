import { getContext, onDestroy, setContext } from "svelte";
import {
	createVirtualFrameCoordinator,
	type VirtualFrameCoordinator,
} from "ui/shared/scheduling/frameCoordinator";

export const VIRTUAL_FRAME_COORDINATOR_CONTEXT_KEY = Symbol(
	"virtual-frame-coordinator",
);

/** Creates and provides the coordinator owned by one rendered surface. */
export function provideVirtualFrameCoordinator(): VirtualFrameCoordinator {
	const coordinator = createVirtualFrameCoordinator();
	setContext(VIRTUAL_FRAME_COORDINATOR_CONTEXT_KEY, coordinator);
	onDestroy(() => coordinator.dispose());
	return coordinator;
}

export function getVirtualFrameCoordinatorContext():
	| VirtualFrameCoordinator
	| undefined {
	return getContext<VirtualFrameCoordinator | undefined>(
		VIRTUAL_FRAME_COORDINATOR_CONTEXT_KEY,
	);
}
