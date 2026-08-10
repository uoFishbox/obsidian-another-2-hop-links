import { ItemView, type TFile, type WorkspaceLeaf } from "obsidian";
import { mount, type Component } from "svelte";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import type { SortableItem } from "core/sorting";
import { toViewItems, type ViewItem } from "application/presenters";
import type { ComponentInstance } from "infrastructure/lifecycle/ComponentController";
import type { PluginHostUi } from "types/pluginHostUi";
import type { ListConfig } from "ui/components/lists/types";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import { createGuardedIndexUpdateHandler } from "ui/shared/views/indexUpdateLifecycle";
import { mergeItemsPreservingUnchanged } from "ui/shared/views/itemDiff";
import { cleanupSvelteAndStore } from "ui/shared/views/svelteLifecycle";
import {
	createDefaultApplicationStore,
	createLinkContextForView,
} from "ui/shared/views/viewFactories";
import { applyCardLayoutCssVars } from "ui/shared/layout/cardLayoutCssVars";

interface ListHostComponent extends ComponentInstance {
	updateItems?: (nextItems: ViewItem[]) => void;
}

type MountListSectionOptions = {
	parentEl: HTMLElement;
	sourceFile: TFile;
	config: ListConfig<ViewItem>;
	autofocus?: boolean;
	wrapForView?: boolean;
};

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
	private applicationStore: ApplicationStore | undefined = undefined;
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
		protected readonly plugin: PluginHostUi,
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
			this.plugin,
			options.sourceFile,
			this.plugin.settings,
			options.wrapForView === undefined
				? undefined
				: { wrapForView: options.wrapForView },
		);

		this.applicationStore = createDefaultApplicationStore(this.plugin);
		const applicationStore = this.applicationStore;
		if (!applicationStore) {
			return;
		}

		this.listHostComponent = mount(this.getListHostComponent(), {
			target: sectionEl,
			props: {
				items: toViewItems(this.currentItems),
				config: options.config,
				linkContext,
				applicationStore,
				sortService: this.plugin.sortService,
				app: this.app,
				previewRuntime: this.plugin.getPreviewRuntime?.(),
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
		this.listHostComponent?.updateItems?.(toViewItems(mergedItems));
		this.applicationStore?.triggerUpdate?.();
	}

	private destroyListHost(): void {
		[this.listHostComponent, this.applicationStore] = cleanupSvelteAndStore(
			this.listHostComponent,
			this.applicationStore,
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
