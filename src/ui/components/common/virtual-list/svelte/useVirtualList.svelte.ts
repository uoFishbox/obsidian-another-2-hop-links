import {
	createVirtualListRuntime,
	type CreateVirtualListRuntimeOptions,
	type VirtualListRuntimeState,
} from "../core/virtualListRuntime";
import type { MountedVirtualCellsBuild } from "../core/virtualListEngine";
import type { VirtualListMode } from "../core/VirtualListMode";
import type { MountedVirtualCell, VirtualRowModel } from "../types";

export type UseVirtualListOptions<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
> = Omit<
	CreateVirtualListRuntimeOptions<TCell, TRowModel, TMountedCell, TMountedBuild>,
	"onStateChanged"
>;

export function useVirtualList<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(options: UseVirtualListOptions<TCell, TRowModel, TMountedCell, TMountedBuild>) {
	let runtimeState = $state.raw<
		VirtualListRuntimeState<TCell, TMountedCell, TMountedBuild>
	>(null as unknown as VirtualListRuntimeState<TCell, TMountedCell, TMountedBuild>);
	const runtime = createVirtualListRuntime<
		TCell,
		TRowModel,
		TMountedCell,
		TMountedBuild
	>({
		...options,
		onStateChanged: (nextState) => {
			runtimeState = nextState;
		},
	});
	runtimeState = runtime.getState();

	return {
		getSnapshot() {
			return runtimeState.snapshot;
		},
		getMode(): VirtualListMode {
			return runtimeState.mode;
		},
		getMountedCells() {
			return runtimeState.mode.kind === "empty" ||
				runtimeState.mode.kind === "uninitialized"
				? []
				: (runtimeState.snapshot?.mountedCells ?? []);
		},
		getMountedCellsForChange() {
			return runtimeState.mountedCellsForChange;
		},
		getReconciliationState() {
			return runtimeState.reconciliationState;
		},
		getTotalHeight(fallback: number) {
			return runtimeState.snapshot?.totalHeight ?? fallback;
		},
		applyMeasurement: runtime.applyMeasurement,
		recompute: runtime.recompute,
		setEmpty: runtime.setEmpty,
	};
}
