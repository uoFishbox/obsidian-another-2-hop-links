<script lang="ts">
	import { Menu } from "obsidian";
	import { svgAttrs, ICON_PATHS } from "ui/utils/icons";
	import type { Snippet } from "svelte";
	import { useAppContext } from "ui/context/linkContext";

	interface Props {
		title: string;
		totalCount?: number;
		iconSize?: number;
		iconClass?: string;
		containerClass?: string;
		icon?: Snippet;
	}

	let {
		title,
		totalCount,
		iconSize = 26,
		iconClass = "twohop-links-icon",
		containerClass = "cosense-card-links__connected-links-header",
		icon,
	}: Props = $props();

	const tooltip = $derived(
		totalCount !== undefined ? `${totalCount} notes` : undefined,
	);

	const appContext = useAppContext();

	async function updateMergedLinksSection(
		useMergedLinksSection: boolean,
	): Promise<void> {
		const currentSettings = appContext.applicationStore.settings;
		if (currentSettings.useMergedLinksSection === useMergedLinksSection) {
			return;
		}

		appContext.applicationStore.setSettings({
			...currentSettings,
			useMergedLinksSection,
		});

		await appContext.updateSetting?.(
			"useMergedLinksSection",
			useMergedLinksSection,
		);
	}

	function reportSettingsUpdateError(error: unknown): void {
		console.error("設定の更新に失敗しました:", error);
	}

	function handleContextMenu(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();

		const mergedEnabled =
			appContext.applicationStore.settings.useMergedLinksSection;
		const menu = new Menu();

		menu.addItem((item) => {
			item.setTitle("Use merged links section")
				.setChecked(mergedEnabled)
				.onClick(() => {
					void updateMergedLinksSection(!mergedEnabled).catch(
						reportSettingsUpdateError,
					);
					menu.hide();
				});
		});

		menu.showAtMouseEvent(event);
	}
</script>

<div
	class={`cosense-card-links__box ${containerClass}`}
	aria-label={tooltip}
	role="button"
	tabindex="0"
	oncontextmenu={handleContextMenu}
>
	<div class="cosense-card-links__title-container">
		<span class="cosense-card-links__header-title">{title}</span>
		{@render icon?.()}
		{#if !icon}
			<svg
				{...svgAttrs}
				width={iconSize}
				height={iconSize}
				stroke="currentColor"
				class={iconClass}
			>
				{@html ICON_PATHS.Link}
			</svg>
		{/if}
	</div>
</div>
