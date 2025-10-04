import { Plugin, MarkdownView, WorkspaceLeaf, TFile } from "obsidian";
import { mount, unmount } from "svelte";
import TwohopLinksRootView from "./view/TwohopLinksRootView.svelte";
import { getContainerElements } from "./domUtils";

interface MountedComponent {
	component: TwohopLinksRootView;
	container: Element;
}

export default class ExamplePlugin extends Plugin {
	private mountedComponents: Map<MarkdownView, MountedComponent[]> =
		new Map();

	async onload() {
		console.log("Loading Example Plugin");

		// Obsidianのレイアウト準備完了後に、最初にアクティブなビューにマウント
		this.app.workspace.onLayoutReady(() => {
			this.handleActiveLeafChange(
				this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ||
					null
			);
		});

		// アクティブなLeafが変更されたときにコンポーネントをマウント/更新
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				this.handleActiveLeafChange(leaf);
			})
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.cleanupClosedViews();
			})
		);
	}

	onunload() {
		this.cleanupAllComponents();
	}

	private handleActiveLeafChange(leaf: WorkspaceLeaf | null) {
		if (!leaf) return;

		const view = leaf.view;

		// いまのところMarkdownのみ
		if (!(view instanceof MarkdownView)) {
			return;
		}

		const currentFile = view.file;

		if (!currentFile) return;

		this.syncComponentsForView(view, currentFile);
	}

	private syncComponentsForView(view: MarkdownView, file: TFile) {
		const containers = getContainerElements(view);
		const existing = this.mountedComponents.get(view) ?? [];
		const containerToMount = new Map(
			existing.map((mounted) => [mounted.container, mounted])
		);
		const nextMounted: MountedComponent[] = [];

		for (const container of containers) {
			const mounted = containerToMount.get(container);
			if (mounted) {
				mounted.component.updateView(file);
				nextMounted.push(mounted);
				continue;
			}

			const component = mount(TwohopLinksRootView, {
				target: container,
				props: {
					file,
				},
			});
			nextMounted.push({ component, container });
		}

		if (nextMounted.length) {
			this.mountedComponents.set(view, nextMounted);
		} else {
			this.mountedComponents.delete(view);
		}

		const reused = new Set(nextMounted);
		for (const mounted of existing) {
			if (reused.has(mounted)) continue;
			unmount(mounted.component);
			mounted.container.remove();
		}
	}

	private cleanupClosedViews() {
		const openMarkdownViews = new Set<MarkdownView>();
		this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				openMarkdownViews.add(leaf.view);
			}
		});

		for (const view of this.mountedComponents.keys()) {
			if (!openMarkdownViews.has(view)) {
				const mountedList = this.mountedComponents.get(view);
				if (mountedList?.length) {
					for (const mounted of mountedList) {
						unmount(mounted.component);
						mounted.container.remove();
					}
					this.mountedComponents.delete(view);
				}
			}
		}
	}

	private cleanupAllComponents() {
		for (const mountedList of this.mountedComponents.values()) {
			for (const mounted of mountedList) {
				unmount(mounted.component);
				mounted.container.remove();
			}
		}
		this.mountedComponents.clear();
	}
}
