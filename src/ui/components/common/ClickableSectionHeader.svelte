<script lang="ts">
	import ClickableHeader, { type Props } from "./ClickableHeader.svelte";

	let props: Props = $props();
</script>

<ClickableHeader {...props} />
