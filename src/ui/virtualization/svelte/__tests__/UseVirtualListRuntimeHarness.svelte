<script lang="ts">
	interface Props {
		initialize(): void;
	}

	const { initialize }: Props = $props();
	initialize();
</script>
