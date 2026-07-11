<script lang="ts" generics="TMountedCell">
	import { IS_PROD } from "../../../../../appConstants";
	import { onDestroy, type Snippet } from "svelte";
	import type { LogicalCellKey } from "../types";
	import {
		createVirtualCellElementRegistration,
		type VirtualCellRegistry,
		type VirtualCellElementRegistration,
		type VirtualCellRegistrationOwner,
	} from "./VirtualCellRegistry";

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
	}: Props = $props();

	let lifecycleCell: TMountedCell | undefined = undefined;
	let lifecycleLogicalKey: string | undefined = undefined;
	let cellElement = $state<HTMLDivElement | undefined>(undefined);
	let cellRegistration = $state.raw<VirtualCellElementRegistration | undefined>(
		undefined,
	);

	const logicalKeyAttribute = $derived(String(logicalKey));

	$effect(() => {
		const nextLogicalKey = logicalKeyAttribute;
		const previousLogicalKey = lifecycleLogicalKey;
		const previousCell = lifecycleCell;

		if (!onLogicalCellAttach && !onLogicalCellDetach) {
			lifecycleLogicalKey = nextLogicalKey;
			lifecycleCell = mountedCell;
			return;
		}

		if (
			previousCell !== undefined &&
			previousLogicalKey !== undefined &&
			previousLogicalKey !== nextLogicalKey
		) {
			onLogicalCellDetach?.(previousCell);
		}

		if (mountedCell !== undefined && previousLogicalKey !== nextLogicalKey) {
			onLogicalCellAttach?.(mountedCell);
		}

		lifecycleLogicalKey = nextLogicalKey;
		lifecycleCell = mountedCell;
	});

	$effect(() => {
		if (!cellElement) {
			return;
		}
		const element = cellElement;
		if (cellRegistrationOwner && cellRegistry) {
			cellRegistrationOwner.attachElement(element, cellRegistry);
			return () => cellRegistrationOwner.detachElement(element);
		}

		const registration = cellRegistry
			? cellRegistry.createRegistration(element)
			: createVirtualCellElementRegistration(element);
		cellRegistration = registration;

		return () => {
			registration.unregister();
			if (cellRegistration === registration) {
				cellRegistration = undefined;
			}
		};
	});

	$effect(() => {
		if (cellRegistrationOwner) return;
		cellRegistration?.update(logicalKeyAttribute, rowIndex, columnIndex);
	});

	onDestroy(() => {
		if (lifecycleCell === undefined) {
			return;
		}

		onLogicalCellDetach?.(lifecycleCell);
		lifecycleCell = undefined;
		lifecycleLogicalKey = undefined;
	});
</script>

<div
	bind:this={cellElement}
	class={className}
	data-ccl-logical-key={!IS_PROD ? logicalKeyAttribute : undefined}
	data-ccl-cell-slot={!IS_PROD ? cellSlotKey : undefined}
	data-testid={!IS_PROD ? dataTestId : undefined}
	data-ccl-row-index={!IS_PROD ? rowIndex : undefined}
	data-ccl-column-index={!IS_PROD ? columnIndex : undefined}
>
	{@render children?.()}
</div>
