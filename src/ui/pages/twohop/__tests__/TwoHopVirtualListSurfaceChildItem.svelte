<script module lang="ts">
	let nextInstanceId = 0;
</script>

<script lang="ts">
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtual-list/types";
	import type { TwoHopVirtualListItem } from "../twoHopVirtualListModel";

	interface Props {
		item: TwoHopVirtualListItem;
		rowIndex: number;
		visibilityState: VirtualizedItemVisibilityState;
	}

	let { item, rowIndex, visibilityState }: Props = $props();
	const instanceId = String((nextInstanceId += 1));
	const renderedKey = $derived(`${item.virtualKey}:${rowIndex}`);
</script>

<div
	data-testid="twohop-child-item-cell"
	data-index={item.virtualKey}
	data-row-index={rowIndex}
	data-rendered-key={renderedKey}
	data-visibility={visibilityState.visibility}
	data-instance-id={instanceId}
>
	{item.virtualKey}
</div>
