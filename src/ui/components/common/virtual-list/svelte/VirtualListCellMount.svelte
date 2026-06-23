<script lang="ts" generics="TMountedCell">
	import { IS_PROD } from "../../../../../appConstants";
	import { onDestroy, onMount, type Snippet } from "svelte";
	import type { LogicalCellKey, RenderSlotKey } from "../types";

	interface Props {
		logicalKey: LogicalCellKey;
		left?: number;
		top?: number;
		width?: number;
		height?: number;
		className?: string;
		dataTestId?: string;
		renderSlotKey?: RenderSlotKey;
		cellSlotKey?: number;
		rowIndex?: number;
		columnIndex?: number;
		mountedCell?: TMountedCell;
		lifecycleMode?: "dom" | "logical";
		onMountCell?: (cell: TMountedCell) => void;
		onDestroyCell?: (cell: TMountedCell) => void;
		children?: Snippet;
	}

	let {
		logicalKey,
		left,
		top,
		width,
		height,
		className = "",
		dataTestId,
		renderSlotKey,
		cellSlotKey,
		rowIndex,
		columnIndex,
		mountedCell,
		lifecycleMode = "dom",
		onMountCell,
		onDestroyCell,
		children,
	}: Props = $props();

	let lifecycleCell: TMountedCell | undefined = undefined;
	let lifecycleLogicalKey: string | undefined = undefined;

	const hasPosition = $derived(
		left !== undefined &&
			top !== undefined &&
			width !== undefined &&
			height !== undefined,
	);

	const logicalKeyAttribute = $derived(String(logicalKey));
	const renderSlotKeyAttribute = $derived(
		renderSlotKey !== undefined ? String(renderSlotKey) : undefined,
	);

	const positionStyle = $derived(
		hasPosition
			? `left:${left}px; transform:translateY(${top}px); width:${width}px; height:${height}px;`
			: undefined,
	);

	const handleMount = (): void => {
		if (lifecycleMode !== "dom") {
			return;
		}

		lifecycleCell = mountedCell;
		if (lifecycleCell !== undefined) {
			onMountCell?.(lifecycleCell);
		}
	};

	const handleDestroy = (): void => {
		if (lifecycleMode !== "dom") {
			return;
		}

		if (lifecycleCell !== undefined) {
			onDestroyCell?.(lifecycleCell);
		}
	};

	$effect(() => {
		if (lifecycleMode !== "logical") {
			return;
		}

		const nextLogicalKey = String(logicalKey);
		const previousLogicalKey = lifecycleLogicalKey;
		const previousCell = lifecycleCell;

		if (
			previousCell !== undefined &&
			previousLogicalKey !== undefined &&
			previousLogicalKey !== nextLogicalKey
		) {
			onDestroyCell?.(previousCell);
		}

		if (mountedCell !== undefined && previousLogicalKey !== nextLogicalKey) {
			onMountCell?.(mountedCell);
		}

		lifecycleLogicalKey = nextLogicalKey;
		lifecycleCell = mountedCell;
	});

	onDestroy(() => {
		if (lifecycleMode !== "logical" || lifecycleCell === undefined) {
			return;
		}

		onDestroyCell?.(lifecycleCell);
		lifecycleCell = undefined;
		lifecycleLogicalKey = undefined;
	});

	if (onMountCell) {
		onMount(handleMount);
	}

	if (onDestroyCell) {
		onDestroy(handleDestroy);
	}
</script>

<div
	class={className}
	data-ccl-logical-key={logicalKeyAttribute}
	data-ccl-render-slot={!IS_PROD ? renderSlotKeyAttribute : undefined}
	data-ccl-cell-slot={!IS_PROD && cellSlotKey !== undefined ? cellSlotKey : undefined}
	data-testid={!IS_PROD ? dataTestId : undefined}
	data-ccl-row-index={rowIndex}
	data-ccl-column-index={columnIndex}
	style={positionStyle}
>
	{@render children?.()}
</div>
