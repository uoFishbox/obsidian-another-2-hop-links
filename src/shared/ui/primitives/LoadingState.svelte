<script lang="ts">
	interface Props {
		message?: string;
	}

	let { message }: Props = $props();
</script>

<div
	class="cosense-card-links__loading-container"
	role="status"
	aria-live="polite"
	aria-busy="true"
>
	<div class="cosense-card-links__loading-spinner"></div>
	{#if message}
		<p class="cosense-card-links__loading-message">{message}</p>
	{/if}
</div>
