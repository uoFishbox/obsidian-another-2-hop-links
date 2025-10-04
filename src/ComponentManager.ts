import { MarkdownView, TFile } from "obsidian";
import { mount, unmount } from "svelte";
import TwohopLinksRootView from "./view/TwohopLinksRootView.svelte";
import { getContainerElements } from "./domUtils";

interface MountedComponent {
	component: Record<string, any>;
	container: Element;
	file: TFile;
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
				this.unmountMountedComponent(mounted);
			}
		}
		this.mountedComponents.delete(view);
	}

	cleanupAllComponents(): void {
		for (const mountedList of this.mountedComponents.values()) {
			for (const mounted of mountedList) {
				this.unmountMountedComponent(mounted);
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
				if (mounted.file !== file) {
					this.unmountMountedComponent(mounted, {
						removeContainer: false,
					});
					nextMounted.push(this.mountComponent(container, file));
				} else {
					nextMounted.push(mounted);
				}
				continue;
			}

			nextMounted.push(this.mountComponent(container, file));
		}

		if (nextMounted.length) {
			this.mountedComponents.set(view, nextMounted);
		} else {
			this.mountedComponents.delete(view);
		}

		const reusedContainers = new Set(
			nextMounted.map((mounted) => mounted.container)
		);
		for (const mounted of existing) {
			if (reusedContainers.has(mounted.container)) continue;
			this.unmountMountedComponent(mounted);
		}
	}

	private mountComponent(container: Element, file: TFile): MountedComponent {
		const component = mount(TwohopLinksRootView, {
			target: container,
			props: { file },
		});
		return { component, container, file };
	}

	private unmountMountedComponent(
		mounted: MountedComponent,
		options?: { removeContainer?: boolean }
	): void {
		const removeContainer = options?.removeContainer ?? true;
		try {
			unmount(mounted.component);
		} catch (error) {
			console.error("Error unmounting component:", error);
		}
		if (removeContainer) {
			mounted.container.remove();
		} else {
			mounted.container.innerHTML = "";
		}
	}
}
