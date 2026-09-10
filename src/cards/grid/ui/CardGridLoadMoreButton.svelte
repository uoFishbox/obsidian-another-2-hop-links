<script lang="ts">
	import Icon from "shared/ui/primitives/Icon.svelte";
	import type { Language } from "settings/model";
	import { getMainUiTranslations } from "shared/i18n/mainUiTranslations";

	interface CardGridLoadMoreButtonProps {
		onClick: () => void;
		testId?: string;
		language?: Language;
	}

	let { onClick, testId = undefined, language = "en" }: CardGridLoadMoreButtonProps =
		$props();
	const text = $derived(getMainUiTranslations(language));
</script>

<button
	type="button"
	class="cosense-card-links__load-more-button cosense-card-links__box"
	aria-label={text.loadMore}
	{...testId ? { "data-testid": testId } : {}}
	onclick={onClick}
>
	<Icon name="Ellipsis" width={28} height={28} />
</button>
