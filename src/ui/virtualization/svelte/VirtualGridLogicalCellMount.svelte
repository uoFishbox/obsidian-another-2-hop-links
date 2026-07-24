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
		logicalKey: LogicalCellKey;
		className?: string;
		dataTestId?: string;
		cellSlotKey?: number;
		rowIndex?: number;
		columnIndex?: number;
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
		mountedCell,
		onLogicalCellAttach,
		onLogicalCellDetach,
		children,
		cellRegistry,
		cellRegistrationOwner,
		surfaceTransaction,
	}: Props = $props();

	const logicalKeyAttribute = $derived(String(logicalKey));
</script>

<div
	use:bindVirtualGridCell={{
		transaction: surfaceTransaction,
		rebind: {
			nextLogicalKey: logicalKeyAttribute,
			rowIndex,
			columnIndex,
			lifecycle:
				mountedCell === undefined
					? undefined
					: {
							attach: () => onLogicalCellAttach?.(mountedCell),
							detach: () => onLogicalCellDetach?.(mountedCell),
						},
			cellRegistry,
			cellRegistrationOwner,
		},
	}}
	class={className}
	data-ccl-logical-key={!IS_PROD ? logicalKeyAttribute : undefined}
	data-ccl-cell-slot={!IS_PROD ? cellSlotKey : undefined}
	data-testid={!IS_PROD ? dataTestId : undefined}
	data-ccl-row-index={!IS_PROD ? rowIndex : undefined}
	data-ccl-column-index={!IS_PROD ? columnIndex : undefined}
>
	{@render children?.()}
</div>
