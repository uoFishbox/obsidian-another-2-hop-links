<script lang="ts">
	interface Props {
		message?: string;
	}

	let { message }: Props = $props();
</script>

<div class="loading-container" role="status" aria-live="polite" aria-busy="true">
	<div class="loading-spinner"></div>
	{#if message}
		<p class="loading-message">{message}</p>
	{/if}
</div>
