<script lang="ts">
	interface UseVirtualizerHarnessProps {
		initialize(): void;
	}

	const { initialize }: UseVirtualizerHarnessProps = $props();
	initialize();
</script>
