<script lang="ts">
	import { IS_PROD } from "appConstants";
	import type { Snippet } from "svelte";
	import type { LogicalCellKey } from "../types";
	import type { VirtualGridSurfaceTransaction } from "./VirtualGridSurfaceTransaction";
	import { bindVirtualGridCell } from "./VirtualGridSurfaceTransaction";

	interface Props {
		logicalKey?: LogicalCellKey;
		className?: string;
		dataTestId?: string;
		renderSlotIndex?: number;
		rowIndex?: number;
		columnIndex?: number;
		ariaHidden?: boolean;
		children?: Snippet;
		surfaceTransaction: VirtualGridSurfaceTransaction;
	}

	let {
		logicalKey,
		className = "",
		dataTestId,
		renderSlotIndex,
		rowIndex,
		columnIndex,
		ariaHidden = false,
		children,
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
			}}
	class={className}
	data-ccl-logical-key={!IS_PROD ? logicalKeyAttribute : undefined}
	data-ccl-cell-slot={!IS_PROD ? renderSlotIndex : undefined}
	data-testid={!IS_PROD ? dataTestId : undefined}
	data-ccl-row-index={!IS_PROD ? rowIndex : undefined}
	data-ccl-column-index={!IS_PROD ? columnIndex : undefined}
	aria-hidden={ariaHidden ? "true" : undefined}
>
	{@render children?.()}
</div>
