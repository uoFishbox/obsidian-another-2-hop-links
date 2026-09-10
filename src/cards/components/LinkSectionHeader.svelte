<script lang="ts">
	import { Menu } from "obsidian";
	import Icon from "shared/ui/primitives/Icon.svelte";
	import type { Snippet } from "svelte";
	import { useAppContext } from "cards/context/linkContext";
	import type { CardSectionVariant } from "./cardPresentation";
	import { getMainUiTranslations } from "shared/i18n/mainUiTranslations";
	import type { Language } from "settings/model";

	interface Props {
		title: string;
		totalCount?: number;
		iconSize?: number;
		iconClass?: string;
		containerClass?: string;
		icon?: Snippet;
		sectionVariant?: CardSectionVariant;
		language?: Language;
	}

	let {
		title,
		totalCount,
		iconSize = 26,
		iconClass = "twohop-links-icon",
		containerClass = "cosense-card-links__connected-links-header",
		icon,
		sectionVariant,
		language = "en",
	}: Props = $props();

	const appContext = useAppContext();
	const tooltip = $derived(
		totalCount !== undefined
			? getMainUiTranslations(language).noteCount(totalCount)
			: undefined,
	);

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
			item.setTitle(
				getMainUiTranslations(
					appContext.applicationStore.settings.language,
				).useMergedLinksSection,
			)
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class={`cosense-card-links__box ${containerClass}`}
	aria-label={tooltip}
	oncontextmenu={handleContextMenu}
	data-ccl-section-variant={sectionVariant}
>
	<div class="cosense-card-links__title-container">
		<span class="cosense-card-links__header-title">{title}</span>
		{@render icon?.()}
		{#if !icon}
			<Icon name="Link" width={iconSize} height={iconSize} class={iconClass} />
		{/if}
	</div>
</div>
