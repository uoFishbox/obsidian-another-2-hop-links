import { MarkdownView, TFile } from "obsidian";
import { mount, unmount } from "svelte";
import TwohopLinksRootView from "./view/TwohopLinksRootView.svelte";
import { getContainerElements } from "./domUtils";

interface MountedComponent {
	component: TwohopLinksRootView;
	container: Element;
}

export class ComponentManager {
	private mountedComponents: Map<MarkdownView, MountedComponent[]> =
		new Map();

	mountComponentsForView(view: MarkdownView, file: TFile): void {
		this.syncComponentsForView(view, file);
	}

	unmountViewComponents(view: MarkdownView): void {
		const mountedList = this.mountedComponents.get(view);
		if (mountedList?.length) {
			for (const mounted of mountedList) {
				try {
					unmount(mounted.component);
					mounted.container.remove();
				} catch (error) {
					console.error("Error unmounting component:", error);
				}
			}
		}
		this.mountedComponents.delete(view);
	}

	cleanupAllComponents(): void {
		for (const mountedList of this.mountedComponents.values()) {
			for (const mounted of mountedList) {
				unmount(mounted.component);
				mounted.container.remove();
			}
		}
		this.mountedComponents.clear();
	}

	cleanupClosedViews(activeViews: MarkdownView[]): void {
		for (const [view, mountedList] of this.mountedComponents.entries()) {
			if (!activeViews.includes(view)) {
				this.unmountViewComponents(view);
			}
		}
	}

	private syncComponentsForView(view: MarkdownView, file: TFile): void {
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
}
