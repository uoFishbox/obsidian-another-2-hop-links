<script lang="ts">
	import { TFile } from "obsidian";
	import { onDestroy } from "svelte";
	import { svgAttrs, ICON_PATHS } from "ui/utils/icons";
	import type { PluginHost } from "types/pluginHost";
	import type { DeskGridPosition, DeskState } from "features/desk/types";
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import { applyCardLayoutCssVars } from "ui/utils/cardLayoutCssVars";
	import {
		canAcceptDeskDrop,
		DESK_CARD_DRAG_FORMAT,
		resolveDeskDropFile,
	} from "./deskDropData";
	import { resolveFileByPath } from "infrastructure/utils/vaultUtils";
	import { CANVAS_NOTE_DRAG_FORMAT } from "../../../appConstants";
	import {
		createInteractionRegistry,
		setInteractionRegistryContext,
	} from "ui/interactions/interactionRegistry";
	import { createDelegatedInteractionDispatcher } from "ui/interactions/delegatedDispatcher";
	import {
		clearCardDraggingClass,
		installNativeDragSelectionShim,
	} from "ui/interactions/cardDragState";
	import {
		setAppContext,
		setLazyLoaderCache,
		setLinkContext,
	} from "ui/context/linkContext";
	import {
		createDefaultApplicationStore,
		createLinkContextForView,
	} from "ui/views/shared/viewFactories";
	import { useBookmarks } from "ui/hooks/useBookmarks.svelte";

	const DEFAULT_CELL_METRICS = { width: 140, height: 154, gap: 12 };

	interface Props {
		plugin: PluginHost;
		deskState: DeskState;
		lazyLoaderCache: Set<string>;
	}

	let { plugin, deskState, lazyLoaderCache }: Props = $props();

	let rootEl = $state<HTMLDivElement | null>(null);
	let gridEl = $state<HTMLDivElement | null>(null);
	let dropPosition = $state<DeskGridPosition | null>(null);
	let draggingPath = $state<string | null>(null);
	let boardColumns = $state(1);
	let boardRows = $state(4);
	let cellMetrics = $state(DEFAULT_CELL_METRICS);
	let cardRefreshTokens = $state<Record<string, number>>({});

	const interactionRegistry = createInteractionRegistry();
	setInteractionRegistryContext(interactionRegistry);

	const sourceFile =
		plugin.app.workspace.getActiveFile() ?? ({ path: "" } as TFile);
	const applicationStore = createDefaultApplicationStore(plugin);
	const linkContext = createLinkContextForView(
		plugin,
		sourceFile,
		plugin.settings,
		{ wrapForView: false },
	);
	const bookmarks = useBookmarks(plugin.app);
	const appContext = {
		linkContext,
		applicationStore,
		app: plugin.app,
		bookmarks,
	};
	const delegatedInteractions = createDelegatedInteractionDispatcher({
		registry: interactionRegistry,
		linkContext,
		appContext,
	});

	setLinkContext(linkContext);
	setLazyLoaderCache(lazyLoaderCache);
	setAppContext(appContext);

	const unsubscribeDeskState = plugin.deskStore.subscribe((nextState) => {
		deskState = nextState;
	});
	onDestroy(unsubscribeDeskState);
	onDestroy(() => delegatedInteractions.clearLongPressTimer());

	type DeskCardEntry = {
		file: TFile;
		path: string;
		position: DeskGridPosition;
	};

	function positionKey(position: DeskGridPosition): string {
		return `${position.column}:${position.row}`;
	}

	function normalizeGridPosition(
		position: DeskGridPosition | undefined,
	): DeskGridPosition | null {
		if (!position) {
			return null;
		}

		return {
			column: Math.max(0, Math.floor(position.column)),
			row: Math.max(0, Math.floor(position.row)),
		};
	}

	function nextFreePosition(occupied: Set<string>): DeskGridPosition {
		for (let row = 0; ; row += 1) {
			for (let column = 0; column < boardColumns; column += 1) {
				const position = { column, row };
				if (!occupied.has(positionKey(position))) {
					return position;
				}
			}
		}
	}

	function getNextPositionForOccupant(
		movingPath: string,
		targetPosition: DeskGridPosition,
	): DeskGridPosition {
		const movingEntry = cardEntries.find(
			(entry) => entry.path === movingPath,
		);
		if (movingEntry) {
			return movingEntry.position;
		}

		const occupied = new Set(occupiedPositions.keys());
		occupied.add(positionKey(targetPosition));
		return nextFreePosition(occupied);
	}

	const cardEntries = $derived.by(() => {
		const result: DeskCardEntry[] = [];
		const occupied = new Set<string>();

		for (const card of deskState.cards) {
			const file = resolveFileByPath(plugin.app.vault, card.path);
			if (file) {
				const explicitPosition = normalizeGridPosition(
					card.gridPosition,
				);
				const position =
					explicitPosition &&
					explicitPosition.column < boardColumns &&
					!occupied.has(positionKey(explicitPosition))
						? explicitPosition
						: nextFreePosition(occupied);
				occupied.add(positionKey(position));
				result.push({
					file,
					path: file.path,
					position,
				});
			}
		}

		return result;
	});
	const missingCardCount = $derived(
		deskState.cards.length - cardEntries.length,
	);
	const cardCountLabel = $derived(
		cardEntries.length === 1 ? "1 card" : `${cardEntries.length} cards`,
	);
	const occupiedPositions = $derived.by(() => {
		const occupied = new Map<string, string>();
		for (const entry of cardEntries) {
			occupied.set(positionKey(entry.position), entry.path);
		}
		return occupied;
	});
	const dropPositionKey = $derived(
		dropPosition ? positionKey(dropPosition) : null,
	);
	const occupiedDropPath = $derived(
		dropPosition ? occupiedPositions.get(positionKey(dropPosition)) : null,
	);
	const canDropAtPosition = $derived(dropPosition !== null);
	const boardStyle = $derived(
		`height:${Math.max(
			boardRows * cellMetrics.height +
				Math.max(0, boardRows - 1) * cellMetrics.gap,
			320,
		)}px;`,
	);

	function syncCardLayoutCssVars(): void {
		if (rootEl) {
			applyCardLayoutCssVars(rootEl, plugin.settings);
		}
	}

	function observeGridLayout(): (() => void) | undefined {
		if (!gridEl) {
			return;
		}

		const updateLayout = () => {
			if (!gridEl) {
				return;
			}

			const style = getComputedStyle(gridEl);
			const width =
				Number.parseFloat(style.getPropertyValue("--ccl-box-size")) ||
				DEFAULT_CELL_METRICS.width;
			const height =
				Number.parseFloat(style.getPropertyValue("--ccl-box-height")) ||
				DEFAULT_CELL_METRICS.height;
			const gap =
				Number.parseFloat(style.getPropertyValue("--ccl-box-gap")) ||
				DEFAULT_CELL_METRICS.gap;
			const rect = gridEl.getBoundingClientRect();
			const columns = Math.max(
				1,
				Math.floor((rect.width + gap) / (width + gap)),
			);
			const maxOccupiedRow = cardEntries.reduce(
				(max, entry) => Math.max(max, entry.position.row),
				0,
			);
			const visibleRows = Math.max(
				4,
				Math.ceil(Math.max(rect.height, 320) / (height + gap)),
			);

			if (
				cellMetrics.width !== width ||
				cellMetrics.height !== height ||
				cellMetrics.gap !== gap
			) {
				cellMetrics = { width, height, gap };
			}
			if (boardColumns !== columns) {
				boardColumns = columns;
			}
			const nextRows = Math.max(visibleRows, maxOccupiedRow + 2);
			if (boardRows !== nextRows) {
				boardRows = nextRows;
			}
		};

		updateLayout();
		const resizeObserver = new ResizeObserver(updateLayout);
		resizeObserver.observe(gridEl);

		return () => {
			resizeObserver.disconnect();
		};
	}

	function destroyApplicationStoreOnUnmount(): () => void {
		return () => {
			applicationStore.destroy();
		};
	}

	$effect(() => {
		syncCardLayoutCssVars();
	});

	$effect(() => {
		return observeGridLayout();
	});

	$effect(() => {
		return destroyApplicationStoreOnUnmount();
	});

	function canAcceptDrop(event: DragEvent): boolean {
		return canAcceptDeskDrop(event.dataTransfer, plugin.app);
	}

	function handleDragStart(event: DragEvent, file: TFile): void {
		draggingPath = file.path;
		const wikiLink = linkContext.buildWikiLink(file, file.basename);
		installNativeDragSelectionShim();
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData(DESK_CARD_DRAG_FORMAT, file.path);
			event.dataTransfer.setData(CANVAS_NOTE_DRAG_FORMAT, file.path);
			event.dataTransfer.setData("text/plain", wikiLink);
		}
	}

	function getGridPositionFromPointer(
		event: DragEvent,
	): DeskGridPosition | null {
		if (!gridEl) {
			return null;
		}

		const rect = gridEl.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		if (x < 0 || x > rect.width || y < 0) {
			return null;
		}

		const stepX = cellMetrics.width + cellMetrics.gap;
		const stepY = cellMetrics.height + cellMetrics.gap;
		const column = Math.max(
			0,
			Math.min(boardColumns - 1, Math.floor(x / stepX)),
		);
		const row = Math.max(0, Math.floor(y / stepY));

		return { column, row };
	}

	function setDropPositionFromPointer(event: DragEvent): void {
		const position = getGridPositionFromPointer(event);
		dropPosition = position;
		if (position) {
			boardRows = Math.max(boardRows, position.row + 2);
		}
	}

	function handleGridDragOver(event: DragEvent): void {
		if (!canAcceptDrop(event)) {
			return;
		}

		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = "move";
		}
		setDropPositionFromPointer(event);
	}

	function handleDragLeave(event: DragEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) {
			dropPosition = null;
			return;
		}

		const rect = event.currentTarget.getBoundingClientRect();
		const isInside =
			event.clientX >= rect.left &&
			event.clientX <= rect.right &&
			event.clientY >= rect.top &&
			event.clientY <= rect.bottom;

		if (!isInside) {
			dropPosition = null;
		}
	}

	async function handleDrop(event: DragEvent): Promise<void> {
		if (!canAcceptDrop(event)) {
			return;
		}

		event.preventDefault();
		clearCardDraggingClass();
		try {
			const file = resolveDeskDropFile(
				plugin.app,
				event.dataTransfer,
				sourceFile.path,
			);
			if (!file) {
				return;
			}

			const nextPosition =
				dropPosition ?? getGridPositionFromPointer(event);

			if (!nextPosition) {
				return;
			}

			const occupiedPath = occupiedPositions.get(
				positionKey(nextPosition),
			);
			if (occupiedPath && occupiedPath !== file.path) {
				await plugin.deskStore.placePathAndMoveOccupant(
					file.path,
					nextPosition,
					occupiedPath,
					getNextPositionForOccupant(file.path, nextPosition),
				);
				return;
			}

			await plugin.deskStore.placePath(file.path, nextPosition);
		} finally {
			dropPosition = null;
			draggingPath = null;
		}
	}

	function handleDragEnd(): void {
		clearCardDraggingClass();
		dropPosition = null;
		draggingPath = null;
	}

	async function remove(path: string): Promise<void> {
		await plugin.deskStore.removePath(path);
	}

	export function refreshPaths(paths?: string[]): void {
		let targetPaths = paths;
		if (!targetPaths) {
			targetPaths = new Array<string>(cardEntries.length);
			for (let index = 0; index < cardEntries.length; index += 1) {
				targetPaths[index] = cardEntries[index].path;
			}
		}
		if (targetPaths.length === 0) {
			return;
		}

		const nextTokens = { ...cardRefreshTokens };
		for (const path of targetPaths) {
			nextTokens[path] = (nextTokens[path] ?? 0) + 1;
		}
		cardRefreshTokens = nextTokens;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="cosense-card-links-desk"
	class:is-drop-target={dropPosition !== null}
	bind:this={rootEl}
	ondragover={handleGridDragOver}
	ondrop={handleDrop}
	ondragleave={handleDragLeave}
>
	<div class="cosense-card-links-desk__header">
		<div class="cosense-card-links-desk__title-section">
			<div class="inline-title">Desk</div>
			<div class="cosense-card-links-desk__meta">
				{cardCountLabel}
				{#if missingCardCount > 0}
					<span class="cosense-card-links-desk__warning">
						{missingCardCount} missing
					</span>
				{/if}
			</div>
		</div>
		<button
			type="button"
			class="cosense-card-links-desk__clear"
			disabled={deskState.cards.length === 0}
			aria-label="Clear Desk"
			onclick={() => void plugin.deskStore.clear()}
		>
			<svg
				{...svgAttrs}
				width="16"
				height="16"
				stroke="currentColor"
				aria-hidden="true"
			>
				{@html ICON_PATHS.Trash2}
			</svg>
			<span>Clear</span>
		</button>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_mouse_events_have_key_events -->
	<div
		class="cosense-card-links-desk__grid"
		class:is-drop-target={dropPosition !== null}
		class:is-dragging={draggingPath !== null}
		class:is-drop-valid={canDropAtPosition}
		bind:this={gridEl}
		style={boardStyle}
		onclick={delegatedInteractions.handleClick}
		onmousedown={delegatedInteractions.handleMouseDown}
		oncontextmenu={delegatedInteractions.handleContextMenu}
		onmouseover={delegatedInteractions.handleMouseOver}
		onmouseout={delegatedInteractions.handleMouseOut}
		onmouseleave={delegatedInteractions.handleMouseLeave}
		onkeydown={delegatedInteractions.handleKeyDown}
		ontouchstart={delegatedInteractions.handleTouchStart}
		ontouchmove={delegatedInteractions.handleTouchMove}
		ontouchend={delegatedInteractions.handleTouchEnd}
		ontouchcancel={delegatedInteractions.handleTouchEnd}
	>
		{#if dropPosition}
			<div
				class="cosense-card-links-desk__drop-cell"
				class:is-valid={canDropAtPosition}
				class:is-occupied={Boolean(
					occupiedDropPath && occupiedDropPath !== draggingPath,
				)}
				style={`transform: translate(${dropPosition.column * (cellMetrics.width + cellMetrics.gap)}px, ${dropPosition.row * (cellMetrics.height + cellMetrics.gap)}px); width:${cellMetrics.width}px; height:${cellMetrics.height}px;`}
				aria-hidden="true"
			></div>
		{/if}

		{#each cardEntries as entry (entry.path)}
			<div
				class="cosense-card-links-desk__cell"
				class:is-dragging={draggingPath === entry.path}
				class:is-drop-target-cell={dropPositionKey ===
					positionKey(entry.position) &&
					occupiedDropPath === draggingPath}
				class:is-drop-occupied-cell={dropPositionKey ===
					positionKey(entry.position) &&
					occupiedDropPath === entry.path &&
					occupiedDropPath !== draggingPath}
				data-desk-path={entry.path}
				draggable="true"
				style={`transform: translate(${entry.position.column * (cellMetrics.width + cellMetrics.gap)}px, ${entry.position.row * (cellMetrics.height + cellMetrics.gap)}px); width:${cellMetrics.width}px; height:${cellMetrics.height}px;`}
				ondragstart={(event) => handleDragStart(event, entry.file)}
				ondragend={handleDragEnd}
			>
				<ViewItemCard
					item={{ type: "file", data: entry.file }}
					settings={plugin.settings}
					draggable={false}
					previewRefreshToken={cardRefreshTokens[entry.path] ?? 0}
				/>
				<button
					type="button"
					class="cosense-card-links-desk__remove"
					aria-label="Remove from Desk"
					onclick={(event) => {
						event.stopPropagation();
						void remove(entry.path);
					}}
				>
					<svg
						{...svgAttrs}
						width="14"
						height="14"
						stroke="currentColor"
						stroke-width="2.5"
						aria-hidden="true"
					>
						{@html ICON_PATHS.X}
					</svg>
				</button>
			</div>
		{/each}

		{#if cardEntries.length === 0}
			<div class="cosense-card-links-desk__empty">
				Drag cards here to keep them on your Desk.
			</div>
		{/if}
	</div>
</div>

<style>
	.cosense-card-links-desk {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: auto;
	}

	/* .cosense-card-links-desk.is-drop-target {
		background: linear-gradient(
				var(--background-modifier-hover),
				var(--background-modifier-hover)
			)
			padding-box;
	} */

	.cosense-card-links-desk__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
	}

	.cosense-card-links-desk__title-section {
		min-width: 0;
	}

	.cosense-card-links-desk__header .inline-title {
		margin: 0;
	}

	.cosense-card-links-desk__meta {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 2px;
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
	}

	.cosense-card-links-desk__warning {
		color: var(--text-warning);
	}

	.cosense-card-links-desk__clear {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 6px;
	}

	.cosense-card-links-desk__grid {
		position: relative;
		flex: 1 1 auto;
		min-height: 320px;
		padding: 4px;
		transition: background-color 120ms ease;
	}

	.cosense-card-links-desk__grid.is-dragging,
	.cosense-card-links-desk__grid.is-drop-target {
		background-image: linear-gradient(
				to right,
				var(--background-modifier-border) 1px,
				transparent 1px
			),
			linear-gradient(
				to bottom,
				var(--background-modifier-border) 1px,
				transparent 1px
			);
		background-size: calc(var(--ccl-box-size) + var(--ccl-box-gap))
			calc(var(--ccl-box-height) + var(--ccl-box-gap));
		background-position: 4px 4px;
		background-color: color-mix(
			in srgb,
			var(--background-modifier-hover) 35%,
			transparent
		);
	}

	.cosense-card-links-desk__cell {
		position: absolute;
		top: 4px;
		left: 4px;
		width: var(--ccl-box-size);
		height: var(--ccl-box-height);
		cursor: grab;
		user-select: none;
		transition:
			transform 140ms ease,
			opacity 120ms ease;
	}

	.cosense-card-links-desk__cell:active {
		cursor: grabbing;
	}

	.cosense-card-links-desk__cell :global(.cosense-card-links__box) {
		position: relative;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-height: var(--ccl-box-height);
		display: flex;
		flex-direction: column;
		border-radius: var(--ccl-box-radius);
		background-color: var(--ccl-bg-box);
		border: 1px solid var(--ccl-bg-box-top);
		overflow: clip;
		cursor: pointer;
		word-break: break-word;
	}

	@media (hover: hover) {
		.cosense-card-links-desk__cell :global(.cosense-card-links__box:hover) {
			border-color: var(--background-modifier-border-hover);
		}
	}

	.cosense-card-links-desk__cell
		:global(.cosense-card-links__box-title-wrapper) {
		padding: var(--ccl-box-padding);
		display: block;
		flex: 0 0 auto;
		position: relative;
		z-index: 1;
	}

	.cosense-card-links-desk__cell :global(.cosense-card-links__box-title) {
		color: var(--ccl-title-box);
		font-weight: 600;
		font-size: 0.85em;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: clip;
		line-height: 1.3;
	}

	.cosense-card-links-desk__cell :global(.cosense-card-links__file-icon) {
		display: inline-flex;
		align-items: center;
		vertical-align: middle;
		margin-right: 4px;
		color: var(--text-muted);
	}

	.cosense-card-links-desk__cell :global(.cosense-card-links__file-icon svg) {
		width: 1em;
		height: 1em;
	}

	.cosense-card-links-desk__cell :global(.cosense-card-links__box-extension) {
		font-size: 9px;
		font-weight: 600;
		color: var(--nav-tag-color);
		text-transform: uppercase;
	}

	.cosense-card-links-desk__cell
		:global(.cosense-card-links__box-bookmark-bg) {
		position: absolute;
		top: -4px;
		right: 2px;
		color: var(--icon-color-active);
		pointer-events: none;
		z-index: 0;
	}

	.cosense-card-links-desk__cell :global(.preview-mount-slot) {
		contain: content;
		width: auto;
		position: relative;
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: inherit;
		height: 100%;
		overflow: clip;
	}

	.cosense-card-links-desk__cell :global(.lazy-placeholder) {
		contain: content;
		width: 100%;
		height: 100%;
		flex: 1 1 auto;
		min-height: inherit;
		background: transparent;
	}

	.cosense-card-links-desk__cell :global(.cosense-card-links__box-preview) {
		contain: layout;
		font-size: var(--ccl-preview-font-size);
		color: var(--ccl-box-text-content);
		white-space: pre-line;
		user-select: none;
		flex: 1 1 auto;
		min-height: 1em;
		min-width: 0;
		overflow: clip;
	}

	.cosense-card-links-desk__cell
		:global(.cosense-card-links__box-preview--text) {
		padding: 0 var(--ccl-box-padding);
	}

	.cosense-card-links-desk__cell
		:global(.cosense-card-links__box-preview--image) {
		padding: 0 calc(var(--ccl-box-padding) / 2);
	}

	.cosense-card-links-desk__cell
		:global(.cosense-card-links__box-preview img) {
		width: 100%;
		height: auto;
		object-fit: cover;
		border-radius: var(--radius-s);
		-webkit-user-drag: none;
	}

	.cosense-card-links-desk__cell :global(.cosense-card-links__wikilink),
	.cosense-card-links-desk__cell :global(.cosense-card-links__external-link) {
		color: var(--link-color);
	}

	.cosense-card-links-desk__cell :global(.cosense-card-links__external-link) {
		text-decoration: underline;
	}

	.cosense-card-links-desk__cell
		:global(
			.cosense-card-links__box.is-attachment
				.cosense-card-links__box-preview
		) {
		margin-left: calc(var(--ccl-box-padding) * -1);
		margin-right: calc(var(--ccl-box-padding) * -1);
		margin-bottom: calc(var(--ccl-box-padding) * -1);
		width: calc(100% + (var(--ccl-box-padding) * 2));
		padding-top: 0;
		margin-top: 8px;
	}

	.cosense-card-links-desk__cell
		:global(
			.cosense-card-links__box.is-attachment
				.cosense-card-links__box-preview
				img
		) {
		border-radius: 0;
		display: block;
		width: 100%;
		height: auto;
		object-fit: cover;
	}

	.cosense-card-links-desk__cell.is-dragging {
		opacity: 0.5;
	}

	.cosense-card-links-desk__drop-cell {
		position: absolute;
		top: 4px;
		left: 4px;
		z-index: 1;
		box-sizing: border-box;
		border: 2px solid var(--interactive-accent);
		border-radius: var(--ccl-box-radius);
		background: color-mix(
			in srgb,
			var(--interactive-accent) 16%,
			transparent
		);
		pointer-events: none;
	}

	.cosense-card-links-desk__grid.is-drop-valid {
		background-color: color-mix(
			in srgb,
			var(--interactive-accent) 10%,
			transparent
		);
	}

	.cosense-card-links-desk__drop-cell.is-valid {
		border-color: var(--interactive-accent);
		background: color-mix(
			in srgb,
			var(--interactive-accent) 16%,
			transparent
		);
	}

	.cosense-card-links-desk__drop-cell.is-occupied {
		border-style: dashed;
		background: color-mix(
			in srgb,
			var(--interactive-accent) 22%,
			transparent
		);
	}

	.cosense-card-links-desk__grid.is-dragging
		.cosense-card-links-desk__cell:not(.is-dragging)
		:global(.cosense-card-links__box) {
		pointer-events: none;
	}

	.cosense-card-links-desk__cell.is-drop-target-cell {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 3px;
	}

	.cosense-card-links-desk__cell.is-drop-occupied-cell {
		outline: 2px dashed var(--interactive-accent);
		outline-offset: 3px;
	}

	.cosense-card-links-desk__remove {
		position: absolute;
		top: 4px;
		right: 4px;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border-radius: 50%;
		opacity: 0;
		pointer-events: none;
		transition: opacity 120ms ease;
	}

	.cosense-card-links-desk__cell:hover .cosense-card-links-desk__remove,
	.cosense-card-links-desk__cell:focus-within
		.cosense-card-links-desk__remove,
	.cosense-card-links-desk__remove:focus-visible {
		opacity: 1;
		pointer-events: auto;
	}

	.cosense-card-links-desk__empty {
		position: absolute;
		inset: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 32px;
		color: var(--text-muted);
		text-align: center;
		border: 1px dashed var(--background-modifier-border);
		border-radius: 8px;
	}
</style>
