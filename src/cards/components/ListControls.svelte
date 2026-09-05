<script lang="ts">
	import { Menu, setIcon, type IconName } from "obsidian";
	import { onDestroy } from "svelte";
	import { ARIA_LABELS } from "cards/ariaLabels";
	import type { VerticalNavigationDirection } from "cards/navigation/types";
	import type { SortOption } from "cards/sorting";

	interface SortField {
		label: string;
		icon: IconName;
		asc: SortOption;
		desc: SortOption;
	}
	const RELEVANCE_FIELD: SortField = {
		label: "関連度",
		icon: "network",
		asc: "relevance-reverse",
		desc: "relevance",
	};

	const SORT_FIELDS = [
		{
			label: "タイトル",
			icon: "type",
			asc: "alphabetical",
			desc: "alphabetical-reverse",
		},
		{
			label: "被リンク数",
			icon: "links-coming-in",
			asc: "backlink-count",
			desc: "backlink-count-reverse",
		},
		{
			label: "作成日時",
			icon: "calendar-plus",
			asc: "created-date",
			desc: "created-date-reverse",
		},
		{
			label: "更新日時",
			icon: "calendar-clock",
			asc: "modified-date",
			desc: "modified-date-reverse",
		},
		{
			label: "ファイルサイズ",
			icon: "hard-drive",
			asc: "file-size",
			desc: "file-size-reverse",
		},
	] as const satisfies readonly {
		label: string;
		icon: IconName;
		asc: SortOption;
		desc: SortOption;
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
		searchPlaceholder = "Search...",
	}: Props = $props();

	const sortFields: readonly SortField[] = $derived(
		allowRelevanceSort ? [RELEVANCE_FIELD, ...SORT_FIELDS] : SORT_FIELDS,
	);
	const sortField = $derived(
		sortFields.find(
			(field) => field.asc === sortOption || field.desc === sortOption,
		) ?? SORT_FIELDS[0],
	);
	const isDescending = $derived(sortOption === sortField.desc);
	const sortDirectionLabel = $derived(
		sortField === RELEVANCE_FIELD
			? isDescending
				? "関連度の高い順（クリックで低い順に切り替え）"
				: "関連度の低い順（クリックで高い順に切り替え）"
			: isDescending
				? "降順（クリックで昇順に切り替え）"
				: "昇順（クリックで降順に切り替え）",
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
					.setChecked(field.asc === sortField.asc)
					.onClick(() => {
						onSortChange(isDescending ? field.desc : field.asc);
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
		<div
			class="twohop-sort-menu-trigger text-icon-button"
			role="button"
			tabindex="0"
			onclick={openSortMenu}
			onkeydown={handleSortMenuKeydown}
			aria-label={ARIA_LABELS.SORT_SELECT}
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
		color: var(--text-normal);
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
	.twohop-sort-menu-trigger.text-icon-button {
		margin: 2px;
	}

	.twohop-sort-menu-trigger:focus-visible {
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
