<script lang="ts">
	import { TFile } from "obsidian";

	interface Props {
		file: TFile;
	}

	let { file }: Props = $props();
</script>

<div class="another-two-hop-links-root">
	{file.name}
</div>

<style>
</style>
