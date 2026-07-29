<script lang="ts" generics="TMountedCell">
	import { IS_PROD } from "appConstants";
	import type { Snippet } from "svelte";
	import type { LogicalCellKey } from "../types";
	import type {
		VirtualCellRegistry,
		VirtualCellRegistrationOwner,
	} from "./VirtualCellRegistry";
	import type { VirtualGridSurfaceTransaction } from "./VirtualGridSurfaceTransaction";
	import { bindVirtualGridCell } from "./VirtualGridSurfaceTransaction";

	interface Props {
		logicalKey?: LogicalCellKey;
		className?: string;
		dataTestId?: string;
		cellSlotKey?: number;
		rowIndex?: number;
		columnIndex?: number;
		ariaHidden?: boolean;
		mountedCell?: TMountedCell;
		onLogicalCellAttach?: (cell: TMountedCell) => void;
		onLogicalCellDetach?: (cell: TMountedCell) => void;
		children?: Snippet;
		cellRegistry?: VirtualCellRegistry;
		cellRegistrationOwner?: VirtualCellRegistrationOwner;
		surfaceTransaction: VirtualGridSurfaceTransaction;
	}

	let {
		logicalKey,
		className = "",
		dataTestId,
		cellSlotKey,
		rowIndex,
		columnIndex,
		ariaHidden = false,
		mountedCell,
		onLogicalCellAttach,
		onLogicalCellDetach,
		children,
		cellRegistry,
		cellRegistrationOwner,
		surfaceTransaction,
	}: Props = $props();

	const logicalKeyAttribute = $derived(
		logicalKey === undefined ? undefined : String(logicalKey),
	);
</script>

<div
	use:bindVirtualGridCell={logicalKeyAttribute === undefined
		? undefined
		: {
				transaction: surfaceTransaction,
				nextLogicalKey: logicalKeyAttribute,
				rowIndex,
				columnIndex,
				lifecycleValue: mountedCell,
				onAttach: mountedCell === undefined ? undefined : onLogicalCellAttach,
				onDetach: mountedCell === undefined ? undefined : onLogicalCellDetach,
				cellRegistry,
				cellRegistrationOwner,
			}}
	class={className}
	data-ccl-logical-key={!IS_PROD ? logicalKeyAttribute : undefined}
	data-ccl-cell-slot={!IS_PROD ? cellSlotKey : undefined}
	data-testid={!IS_PROD ? dataTestId : undefined}
	data-ccl-row-index={!IS_PROD ? rowIndex : undefined}
	data-ccl-column-index={!IS_PROD ? columnIndex : undefined}
	aria-hidden={ariaHidden ? "true" : undefined}
>
	{@render children?.()}
</div>
