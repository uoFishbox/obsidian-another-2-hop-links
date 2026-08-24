import { ItemView, type TFile, type WorkspaceLeaf } from "obsidian";
import { mount, type Component } from "svelte";
import type { DataUpdateContext } from "indexing/index-service/IndexEvents";
import type { SortableItem } from "cards/sorting";
import { toCardItems, type CardItem } from "cards/CardItem";
import type { ComponentInstance } from "obsidian-integration/lifecycle/ComponentController";
import type { PluginHost } from "obsidian-integration/pluginHost";
import type { ViewServices } from "obsidian-integration/views/viewServices";
import type { ListConfig } from "cards/list/ui/types";
import type { CardCollectionState } from "cards/CardCollectionState.svelte";
import { cleanupSvelteAndStore } from "obsidian-integration/views/svelteLifecycle";
import {
	createDefaultCardCollectionState,
	createLinkContextForView,
} from "obsidian-integration/views/viewFactories";
import { applyCardLayoutCssVars } from "cards/layout/cardLayoutCssVars";

interface ListHostComponent extends ComponentInstance {
	updateItems?: (nextItems: CardItem[]) => void;
}

interface MergePreservingUnchangedOptions<T> {
	getKey: (item: T) => string;
	getVersion: (item: T) => number | string;
	changedKeys?: Set<string>;
}

export function mergeItemsPreservingUnchanged<T>(
	previousItems: T[],
	nextItems: T[],
	options: MergePreservingUnchangedOptions<T>,
): T[] {
	const previousByKey = new Map<string, T>();
	for (const item of previousItems) previousByKey.set(options.getKey(item), item);

	return nextItems.map((item) => {
		const key = options.getKey(item);
		const previous = previousByKey.get(key);
		if (!previous) return item;
		return options.changedKeys?.has(key) ||
			options.getVersion(previous) !== options.getVersion(item)
			? item
			: previous;
	});
}

type MountListSectionOptions = {
	parentEl: HTMLElement;
	sourceFile: TFile;
	config: ListConfig<CardItem>;
	autofocus?: boolean;
	wrapForView?: boolean;
};

function createGuardedIndexUpdateHandler(options: {
	isReady: () => boolean;
	shouldRefresh: (context?: DataUpdateContext) => boolean;
	refresh: (context?: DataUpdateContext) => void;
}): (context?: DataUpdateContext) => void {
	return (context?: DataUpdateContext) => {
		if (!options.isReady()) {
			return;
		}
		if (!options.shouldRefresh(context)) {
			return;
		}
		options.refresh(context);
	};
}

function hasSameItemReferences<T>(
	currentItems: readonly T[],
	nextItems: readonly T[],
): boolean {
	if (currentItems.length !== nextItems.length) {
		return false;
	}

	for (let index = 0; index < currentItems.length; index += 1) {
		if (currentItems[index] !== nextItems[index]) {
			return false;
		}
	}

	return true;
}

export abstract class AbstractSvelteListView<
	TItem extends SortableItem,
> extends ItemView {
	protected scrollerEl: HTMLElement | undefined = undefined;

	private listHostComponent: ListHostComponent | undefined = undefined;
	private cardCollectionState: CardCollectionState | undefined = undefined;
	private currentItems: TItem[] = [];
	private currentItemKeySet = new Set<string>();
	private unsubscribeFromIndex: (() => void) | undefined = undefined;

	private readonly guardedIndexUpdateHandler = createGuardedIndexUpdateHandler({
		isReady: () => this.isViewReady(),
		shouldRefresh: (context) => this.shouldRefreshForContext(context),
		refresh: (context) => this.refreshItemsForContext(context),
	});

	constructor(
		leaf: WorkspaceLeaf,
		protected readonly plugin: PluginHost,
		protected readonly viewServices: ViewServices,
	) {
		super(leaf);
		this.navigation = true;
	}

	async onOpen(): Promise<void> {
		this.render();
		this.unsubscribeFromIndex = this.plugin.indexingService.onDataUpdate(
			(context) => {
				this.guardedIndexUpdateHandler(context);
			},
		);
	}

	async onClose(): Promise<void> {
		this.unsubscribeFromIndex?.();
		this.unsubscribeFromIndex = undefined;
		this.scrollerEl = undefined;
		this.destroyListHost();
		this.onViewClose();
	}

	public refreshFromSettings(): void {
		this.render();
	}

	protected onViewClose(): void {}

	protected isViewReady(): boolean {
		return this.hasMountedListHost();
	}

	protected hasMountedListHost(): boolean {
		return Boolean(this.listHostComponent);
	}

	protected prepareRenderContainer(): HTMLElement {
		this.destroyListHost();
		this.scrollerEl = undefined;

		const container = this.contentEl;
		container.empty();
		return container;
	}

	protected setScrollerElement(scrollerEl: HTMLElement): void {
		this.scrollerEl = scrollerEl;
	}

	protected setCurrentItems(items: TItem[]): void {
		this.currentItems = items;
		const currentItemKeySet = new Set<string>();
		for (const item of items) {
			currentItemKeySet.add(this.getItemKey(item));
		}
		this.currentItemKeySet = currentItemKeySet;
	}

	protected getCurrentItems(): TItem[] {
		return this.currentItems;
	}

	protected hasCurrentItemKey(key: string): boolean {
		return this.currentItemKeySet.has(key);
	}

	protected refreshItemsForContext(context?: DataUpdateContext): void {
		this.applyItemsDiff(this.getItems(), context);
	}

	protected getChangedKeys(context?: DataUpdateContext): Set<string> | undefined {
		const affectedPaths = context?.affectedPaths;
		if (!affectedPaths || affectedPaths.length === 0) {
			return undefined;
		}
		return new Set(affectedPaths);
	}

	protected mountListSection(options: MountListSectionOptions): void {
		const sectionEl = options.parentEl.createDiv({
			cls: "cosense-card-links__temp-view",
		});
		sectionEl.dataset.cclCardSurface = "inline";
		applyCardLayoutCssVars(sectionEl, this.plugin.settings);

		const linkContext = createLinkContextForView(
			this.viewServices,
			options.sourceFile,
			this.plugin.settings,
			options.wrapForView === undefined
				? undefined
				: { wrapForView: options.wrapForView },
		);

		this.cardCollectionState = createDefaultCardCollectionState(
			this.viewServices,
			this.plugin.settings,
		);
		const cardCollectionState = this.cardCollectionState;
		if (!cardCollectionState) {
			return;
		}

		this.listHostComponent = mount(this.getListHostComponent(), {
			target: sectionEl,
			props: {
				items: toCardItems(this.currentItems),
				config: options.config,
				linkContext,
				applicationStore: cardCollectionState,
				sortService: this.plugin.sortService,
				app: this.app,
				previewRuntime: this.viewServices.previewRuntime,
				autofocus: options.autofocus,
			},
		}) as ListHostComponent;
	}

	protected applyItemsDiff(nextItems: TItem[], context?: DataUpdateContext): void {
		if (!this.listHostComponent) {
			return;
		}

		const changedKeys = this.getChangedKeys(context);
		const mergedItems = mergeItemsPreservingUnchanged(
			this.currentItems,
			nextItems,
			{
				getKey: (item) => this.getItemKey(item),
				getVersion: (item) => this.getItemVersion(item),
				changedKeys,
			},
		);

		if (hasSameItemReferences(this.currentItems, mergedItems)) {
			return;
		}

		this.setCurrentItems(mergedItems);
		this.listHostComponent?.updateItems?.(toCardItems(mergedItems));
		this.cardCollectionState?.triggerUpdate();
	}

	private destroyListHost(): void {
		[this.listHostComponent, this.cardCollectionState] = cleanupSvelteAndStore(
			this.listHostComponent,
			this.cardCollectionState,
		);
		this.currentItems = [];
		this.currentItemKeySet.clear();
	}

	protected abstract render(): void;
	protected abstract getItems(): TItem[];
	protected abstract shouldRefreshForContext(context?: DataUpdateContext): boolean;
	protected abstract getItemKey(item: TItem): string;
	protected abstract getItemVersion(item: TItem): number | string;
	protected abstract getListHostComponent(): Component<any>;
}
