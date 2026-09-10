<script lang="ts">
	import { Menu, setIcon, type IconName } from "obsidian";
	import { onDestroy } from "svelte";
	import type { VerticalNavigationDirection } from "cards/navigation/types";
	import type { SortOption } from "cards/sorting";
	import type { Language } from "settings/model";
	import { getMainUiTranslations } from "shared/i18n/mainUiTranslations";

	interface SortField {
		label: string;
		icon: IconName;
		default: SortOption;
		reverse: SortOption;
	}
	const RELEVANCE_FIELD: SortField = {
		label: "Relevance",
		icon: "network",
		default: "relevance",
		reverse: "relevance-reverse",
	};

	const SORT_FIELDS = [
		{
			label: "Title",
			icon: "type",
			default: "alphabetical",
			reverse: "alphabetical-reverse",
		},
		{
			label: "Backlinks",
			icon: "links-coming-in",
			default: "backlink-count-reverse",
			reverse: "backlink-count",
		},
		{
			label: "Created date",
			icon: "calendar-plus",
			default: "created-date-reverse",
			reverse: "created-date",
		},
		{
			label: "Modified date",
			icon: "calendar-clock",
			default: "modified-date-reverse",
			reverse: "modified-date",
		},
		{
			label: "File size",
			icon: "hard-drive",
			default: "file-size-reverse",
			reverse: "file-size",
		},
	] as const satisfies readonly {
		label: string;
		icon: IconName;
		default: SortOption;
		reverse: SortOption;
	}[];

	interface Props {
		searchInputValue?: string;
		sortOption: SortOption;
		allowRelevanceSort?: boolean;
		onSortChange: (option: SortOption) => void;
		onSearchInput?: (value: string) => void;
		onSearchSubmit?: (value: string) => void | Promise<void>;
		onMoveFocusToResults?: (
			direction: VerticalNavigationDirection,
		) => void | Promise<void>;
		contentSearchEnabled?: boolean;
		onToggleContentSearch?: () => void;
		autofocus?: boolean;
		showSearchInput?: boolean;
		showContentSearchToggle?: boolean;
		searchPlaceholder?: string;
		contentSearchPlaceholder?: string;
		searchInputEl?: HTMLInputElement | null;
		language?: Language;
	}

	let {
		searchInputValue = "",
		sortOption,
		allowRelevanceSort = false,
		onSortChange,
		onSearchInput = () => {},
		onSearchSubmit = () => {},
		onMoveFocusToResults = () => {},
		contentSearchEnabled = false,
		onToggleContentSearch = () => {},
		autofocus = false,
		showSearchInput = true,
		showContentSearchToggle = true,
		searchPlaceholder = undefined,
		contentSearchPlaceholder,
		searchInputEl = $bindable<HTMLInputElement | null>(null),
		language = "en",
	}: Props = $props();
	const text = $derived(getMainUiTranslations(language));
	const localizedSortFields = $derived(
		SORT_FIELDS.map((field, index) => ({
			...field,
			label:
				[
					text.title,
					text.backlinks,
					text.createdDate,
					text.modifiedDate,
					text.fileSize,
				][index] ?? field.label,
		})),
	);
	const localizedRelevanceField = $derived({
		...RELEVANCE_FIELD,
		label: text.relevance,
	});

	const sortFields: readonly SortField[] = $derived(
		allowRelevanceSort
			? [localizedRelevanceField, ...localizedSortFields]
			: localizedSortFields,
	);
	const sortField = $derived(
		sortFields.find(
			(field) => field.default === sortOption || field.reverse === sortOption,
		) ?? localizedSortFields[0],
	);
	const isReversed = $derived(sortOption === sortField.reverse);
	const isDescending = $derived(
		sortOption === "relevance" ||
			(sortOption !== "relevance-reverse" && sortOption.endsWith("-reverse")),
	);
	const isTitleSort = $derived(sortField.default === "alphabetical");
	const isModifiedDateSort = $derived(sortField.default === "modified-date-reverse");
	const sortDirectionIcon = $derived(
		isReversed ? "arrow-up-wide-narrow" : "arrow-down-wide-narrow",
	);
	const sortDirectionLabel = $derived(
		sortField.default === "relevance"
			? isDescending
				? text.relevanceDescending
				: text.relevanceAscending
			: isDescending
				? text.descending
				: text.ascending,
	);

	let sortMenu = $state<Menu | null>(null);

	function renderSortFieldIcon(
		element: HTMLElement,
		icon: IconName,
	): { update: (nextIcon: IconName) => void } {
		setIcon(element, icon);

		return {
			update(nextIcon): void {
				setIcon(element, nextIcon);
			},
		};
	}

	onDestroy(() => sortMenu?.hide());

	function openSortMenu(event: MouseEvent | KeyboardEvent): void {
		const trigger = event.currentTarget as HTMLDivElement;
		const { left, bottom } = trigger.getBoundingClientRect();
		sortMenu?.hide();

		const menu = new Menu();
		for (const field of sortFields) {
			menu.addItem((item) => {
				item.setTitle(field.label)
					.setIcon(field.icon)
					.setChecked(field.default === sortField.default)
					.onClick(() => {
						onSortChange(isReversed ? field.reverse : field.default);
					});
			});
		}
		menu.onHide(() => {
			if (sortMenu === menu) sortMenu = null;
		});
		sortMenu = menu;
		menu.showAtPosition({ x: left, y: bottom }, trigger.ownerDocument);
	}

	function handleSortMenuKeydown(event: KeyboardEvent): void {
		if (event.isComposing || (event.key !== "Enter" && event.key !== " ")) return;
		event.preventDefault();
		if (event.repeat) return;
		openSortMenu(event);
	}

	function toggleSortDirection(): void {
		onSortChange(isReversed ? sortField.default : sortField.reverse);
	}

	function selectModifiedDate(): void {
		onSortChange(isReversed ? "modified-date" : "modified-date-reverse");
	}

	function handleModifiedDateKeydown(event: KeyboardEvent): void {
		if (event.isComposing || (event.key !== "Enter" && event.key !== " ")) return;
		event.preventDefault();
		if (event.repeat) return;
		selectModifiedDate();
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
		contentSearchEnabled ? text.disableFullTextSearch : text.enableFullTextSearch,
	);
	const activeSearchPlaceholder = $derived(
		contentSearchEnabled
			? (contentSearchPlaceholder ?? searchPlaceholder ?? text.search)
			: (searchPlaceholder ?? text.search),
	);
</script>

<div class="twohop-header" class:twohop-header--no-search={!showSearchInput}>
	{#if showSearchInput}
		<div class="twohop-header-search">
			<div class="search-input-container global-search-input-container">
				<input
					bind:this={searchInputEl}
					enterkeyhint="search"
					type="search"
					class="twohop-search-input"
					value={searchInputValue}
					oninput={handleSearchInput}
					onkeydown={handleSearchKeydown}
					placeholder={activeSearchPlaceholder}
					aria-label={text.findCards}
					spellcheck={false}
					use:focusInput
				/>
				<div
					class="search-input-clear-button"
					role="button"
					tabindex="0"
					aria-label={text.clearSearch}
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
			{#if isTitleSort}
				<span
					aria-hidden="true"
					data-icon={isReversed ? "arrow-up-a-z" : "arrow-down-a-z"}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="100%"
						height="100%"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class={isReversed
							? "svg-icon lucide lucide-arrow-up-a-z"
							: "svg-icon lucide lucide-arrow-down-a-z"}
					>
						{#if isReversed}
							<path d="m3 8 4-4 4 4" />
							<path d="M7 4v16" />
						{:else}
							<path d="m3 16 4 4 4-4" />
							<path d="M7 20V4" />
						{/if}
						<path d="M20 8h-5" />
						<path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10" />
						<path d="M15 14h5l-5 6h5" />
					</svg>
				</span>
			{:else}
				<span aria-hidden="true" use:renderSortFieldIcon={sortDirectionIcon}
				></span>
			{/if}
		</button>
		<div
			class="text-icon-button"
			class:is-active={isModifiedDateSort}
			role="button"
			tabindex="0"
			aria-label={text.modifiedDate}
			aria-pressed={isModifiedDateSort}
			title={text.sortByModifiedDate}
			onclick={selectModifiedDate}
			onkeydown={handleModifiedDateKeydown}
		>
			<span
				class="text-button-icon"
				aria-hidden="true"
				use:renderSortFieldIcon={"calendar-clock"}
			></span>
			<span class="text-button-label">{text.modifiedDate}</span>
		</div>
		<div
			class="twohop-sort-menu-trigger text-icon-button"
			class:is-active={!isModifiedDateSort}
			role="button"
			tabindex="0"
			onclick={openSortMenu}
			onkeydown={handleSortMenuKeydown}
			aria-label={text.selectSortMethod}
			aria-haspopup="menu"
			aria-expanded={sortMenu !== null}
		>
			<span
				class="twohop-sort-field-icon text-button-icon"
				aria-hidden="true"
				use:renderSortFieldIcon={sortField.icon}
			></span>
			<span class="text-button-label">{sortField.label}</span>
			<span
				class="text-button-icon mod-aux"
				aria-hidden="true"
				use:renderSortFieldIcon={"chevrons-up-down"}
			></span>
		</div>
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

	.twohop-header-controls .text-icon-button {
		--icon-color-hover: var(--text-normal);
		margin: 2px;
	}

	/* .twohop-sort-menu-trigger {
		color: var(--text-muted);
		font-size: var(--font-smaller);
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
		padding: var(--size-2-3) var(--size-4-2) var(--size-2-3) var(--size-4-1);
		background: none;
		cursor: var(--cursor);
		overflow: hidden;
		flex-grow: 1;
		corner-shape: var(--corner-shape);
		white-space: nowrap;
		height: var(--input-height)
	}

	.twohop-sort-menu-trigger:hover {
		color: var(--vault-profile-color-hover);
		background-color: var(--background-modifier-hover);
		border-radius: var(--vault-profile-radius);
		height: var(--input-height);
	} */
	.twohop-header-controls .text-icon-button:focus-visible {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 2px;
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
