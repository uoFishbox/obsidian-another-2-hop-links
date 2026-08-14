import {
	createVirtualListRuntime,
	type CreateVirtualListRuntimeOptions,
	type VirtualListRuntimeState,
} from "../core/virtualListRuntime";
import type {
	MountedVirtualCellsBuild,
	VirtualListReconciliationState,
	VirtualListSnapshot,
} from "../core/virtualListEngine";
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

const hasSameMode = (current: VirtualListMode, next: VirtualListMode): boolean => {
	if (current.kind !== next.kind) {
		return false;
	}

	switch (current.kind) {
		case "uninitialized":
			return true;
		case "bootstrapped":
		case "empty":
		case "skipped":
			return next.kind === current.kind && current.reason === next.reason;
		case "stable":
			return next.kind === "stable" && current.scrolling === next.scrolling;
	}
};

export function useVirtualList<
	TCell,
	TRowModel extends VirtualRowModel<TCell>,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(options: UseVirtualListOptions<TCell, TRowModel, TMountedCell, TMountedBuild>) {
	let latestSnapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild> | null =
		null;
	let mountedBuildState = $state.raw<VirtualListReconciliationState<TMountedBuild>>({
		mountedBuild: null,
	});
	let totalHeightState = $state<number | null>(null);
	let modeState = $state.raw<VirtualListMode>({ kind: "uninitialized" });

	const publishSurfaceState = (
		nextState: VirtualListRuntimeState<TCell, TMountedCell, TMountedBuild>,
	): void => {
		latestSnapshot = nextState.snapshot;

		const nextMountedBuild = nextState.reconciliationState.mountedBuild;
		if (mountedBuildState.mountedBuild !== nextMountedBuild) {
			mountedBuildState = nextState.reconciliationState;
		}

		const nextTotalHeight = nextState.snapshot?.totalHeight ?? null;
		if (totalHeightState !== nextTotalHeight) {
			totalHeightState = nextTotalHeight;
		}

		if (!hasSameMode(modeState, nextState.mode)) {
			modeState = nextState.mode;
		}
	};

	const runtime = createVirtualListRuntime<
		TCell,
		TRowModel,
		TMountedCell,
		TMountedBuild
	>({
		...options,
		onStateChanged: publishSurfaceState,
	});
	$effect(() => () => runtime.dispose());

	return {
		getSnapshot() {
			void mountedBuildState;
			void totalHeightState;
			void modeState;
			return latestSnapshot;
		},
		getMountedCells() {
			void mountedBuildState;
			return modeState.kind === "empty" || modeState.kind === "uninitialized"
				? []
				: (latestSnapshot?.mountedCells ?? []);
		},
		getReconciliationState() {
			return mountedBuildState;
		},
		getTotalHeight(fallback: number) {
			return totalHeightState ?? fallback;
		},
		bootstrap: runtime.bootstrap,
		applyMeasurement: runtime.applyMeasurement,
		recompute: runtime.recompute,
		setEmpty: runtime.setEmpty,
	};
}
