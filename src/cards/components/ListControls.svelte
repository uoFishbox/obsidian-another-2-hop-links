<script lang="ts">
	import { ARIA_LABELS } from "cards/ariaLabels";
	import type { ResultFocusDirection } from "cards/navigation/resultFocus";
	import type { SortOption } from "cards/sorting";

	const SORT_OPTIONS: Record<SortOption, string> = {
		alphabetical: "タイトル (A-Z)",
		"alphabetical-reverse": "タイトル (Z-A)",
		"backlink-count-reverse": "被リンク数 (多い順)",
		"backlink-count": "被リンク数 (少ない順)",
		"created-date-reverse": "作成日時 (新しい順)",
		"created-date": "作成日時 (古い順)",
		"modified-date-reverse": "更新日時 (新しい順)",
		"modified-date": "更新日時 (古い順)",
		"file-size-reverse": "ファイルサイズ (大きい順)",
		"file-size": "ファイルサイズ (小さい順)",
	};

	interface Props {
		searchInputValue?: string;
		sortOption: SortOption;
		onSortChange: (option: SortOption) => void;
		onSearchInput?: (value: string) => void;
		onSearchSubmit?: (value: string) => void | Promise<void>;
		onMoveFocusToResults?: (
			direction: ResultFocusDirection,
		) => void | Promise<void>;
		contentSearchEnabled?: boolean;
		onToggleContentSearch?: () => void;
		autofocus?: boolean;
		showSearchInput?: boolean;
		showContentSearchToggle?: boolean;
		searchPlaceholder?: string;
	}

	let {
		searchInputValue = "",
		sortOption,
		onSortChange,
		onSearchInput = () => {},
		onSearchSubmit = () => {},
		onMoveFocusToResults = () => {},
		contentSearchEnabled = false,
		onToggleContentSearch = () => {},
		autofocus = false,
		showSearchInput = true,
		showContentSearchToggle = true,
		searchPlaceholder = "Search...",
	}: Props = $props();

	function handleSortChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		onSortChange(target.value as SortOption);
	}

	function handleSearchInput(e: Event) {
		const target = e.target as HTMLInputElement;
		onSearchInput(target.value);
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.isComposing) {
			return;
		}

		if (e.key === "Enter" && e.ctrlKey && !e.altKey && !e.metaKey) {
			const target = e.currentTarget as HTMLInputElement;
			const query = target.value.trim();
			if (!query) {
				return;
			}

			e.preventDefault();
			void onSearchSubmit(query);
			return;
		}

		if (e.altKey || e.ctrlKey || e.metaKey) {
			return;
		}

		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			void onMoveFocusToResults(e.key === "ArrowDown" ? "down" : "up");
		}
	}

	function handleClearSearch() {
		onSearchInput("");
	}

	function handleClickableDecoratorKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onToggleContentSearch();
		}
	}

	function handleClearButtonKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			handleClearSearch();
		}
	}

	function focusInput(inputEl: HTMLInputElement | undefined) {
		if (autofocus && inputEl) {
			inputEl.focus();
		}
	}

	const contentSearchAriaLabel = $derived(
		contentSearchEnabled ? "Disable full-text search" : "Enable full-text search",
	);
</script>

<div class="twohop-header" class:twohop-header--no-search={!showSearchInput}>
	{#if showSearchInput}
		<div class="twohop-header-search">
			<div class="search-input-container global-search-input-container">
				<input
					enterkeyhint="search"
					type="search"
					class="twohop-search-input"
					value={searchInputValue}
					oninput={handleSearchInput}
					onkeydown={handleSearchKeydown}
					placeholder={searchPlaceholder}
					aria-label="Find cards"
					spellcheck={false}
					use:focusInput
				/>
				<div
					class="search-input-clear-button"
					role="button"
					tabindex="0"
					aria-label="Clear search"
					hidden={searchInputValue.length === 0}
					onclick={handleClearSearch}
					onkeydown={handleClearButtonKeydown}
				></div>
				{#if showContentSearchToggle}
					<div
						class="input-right-decorator clickable-icon"
						class:is-active={contentSearchEnabled}
						role="button"
						tabindex="0"
						aria-label={contentSearchAriaLabel}
						aria-pressed={contentSearchEnabled}
						onclick={onToggleContentSearch}
						onkeydown={handleClickableDecoratorKeydown}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="lucide lucide-text-search-icon lucide-text-search svg-icon"
							aria-hidden="true"
							focusable="false"
						>
							<path d="M21 5H3" />
							<path d="M10 12H3" />
							<path d="M10 19H3" />
							<circle cx="17" cy="15" r="3" />
							<path d="m21 19-1.9-1.9" />
						</svg>
					</div>
				{/if}
			</div>
		</div>
	{/if}
	<div class="twohop-header-controls">
		<select
			class="dropdown"
			value={sortOption}
			onchange={handleSortChange}
			aria-label={ARIA_LABELS.SORT_SELECT}
		>
			{#each Object.entries(SORT_OPTIONS) as [value, label]}
				<option {value}>{label}</option>
			{/each}
		</select>
	</div>
</div>

<style>
	.twohop-header {
		container-type: inline-size;
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		padding: 16px 0px;
	}

	.twohop-header--no-search {
		justify-content: flex-end;
	}

	.twohop-header-search {
		flex: 1 1 220px;
		min-width: 180px;
		order: 1;
	}

	.search-input-container {
		position: relative;
		width: 100%;
	}

	.twohop-header-controls {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 0 0 auto;
		order: 2;
	}

	@container (max-width: 500px) {
		.twohop-header-search {
			order: 2;
			flex-basis: 100%;
		}
		.twohop-header-controls {
			order: 1;
			margin-left: auto;
		}
	}

	/* Fallback for environments without container query support. */
	@media (max-width: 500px) {
		.twohop-header-search {
			order: 2;
			flex-basis: 100%;
		}
		.twohop-header-controls {
			order: 1;
			margin-left: auto;
		}
	}
</style>
