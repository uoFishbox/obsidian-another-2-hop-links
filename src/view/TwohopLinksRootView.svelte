<script lang="ts">
	import { TFile } from "obsidian";

	interface Props {
		file: TFile;
	}

	let { file: initialFile }: Props = $props();
	let file = $state(initialFile);

	export function updateView(newFile: TFile) {
		file = newFile;
	}
</script>

<div class="another-two-hop-links-root">
	{file.name}
</div>

<style>
</style>
