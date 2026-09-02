<script lang="ts">
	import { ARIA_LABELS } from "cards/ariaLabels";
	import type { ResultFocusDirection } from "cards/navigation/resultFocus";
	import type { SortOption } from "cards/sorting";

	const SORT_FIELDS = [
		{ label: "タイトル", asc: "alphabetical", desc: "alphabetical-reverse" },
		{ label: "被リンク数", asc: "backlink-count", desc: "backlink-count-reverse" },
		{ label: "作成日時", asc: "created-date", desc: "created-date-reverse" },
		{ label: "更新日時", asc: "modified-date", desc: "modified-date-reverse" },
		{ label: "ファイルサイズ", asc: "file-size", desc: "file-size-reverse" },
	] as const satisfies readonly {
		label: string;
		asc: SortOption;
		desc: SortOption;
	}[];

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

	const sortField = $derived(
		SORT_FIELDS.find(
			(field) => field.asc === sortOption || field.desc === sortOption,
		) ?? SORT_FIELDS[0],
	);
	const isDescending = $derived(sortOption === sortField.desc);
	const sortDirectionLabel = $derived(
		isDescending
			? "降順（クリックで昇順に切り替え）"
			: "昇順（クリックで降順に切り替え）",
	);

	function handleSortChange(e: Event): void {
		const target = e.target as HTMLSelectElement;
		const field = SORT_FIELDS.find((field) => field.asc === target.value);
		if (!field) return;
		onSortChange(isDescending ? field.desc : field.asc);
	}

	function toggleSortDirection(): void {
		onSortChange(isDescending ? sortField.asc : sortField.desc);
	}

	function selectModifiedDate(): void {
		onSortChange(isDescending ? "modified-date-reverse" : "modified-date");
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
		<button
			type="button"
			class="clickable-icon"
			aria-label={sortDirectionLabel}
			title={sortDirectionLabel}
			onclick={toggleSortDirection}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="svg-icon"
				aria-hidden="true"
				focusable="false"
			>
				<path d="M12 5h9M12 12h6M12 19h3M5 5v14" />
				<path d={isDescending ? "m2 16 3 3 3-3" : "m2 8 3-3 3 3"} />
			</svg>
		</button>
		<button
			type="button"
			class:mod-cta={sortField.asc === "modified-date"}
			aria-pressed={sortField.asc === "modified-date"}
			title="更新日時で並べ替え"
			onclick={selectModifiedDate}
		>
			更新日時
		</button>
		<select
			class="dropdown"
			value={sortField.asc}
			onchange={handleSortChange}
			aria-label={ARIA_LABELS.SORT_SELECT}
		>
			{#each SORT_FIELDS as field}
				<option value={field.asc}>{field.label}</option>
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
