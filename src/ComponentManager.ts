import { MarkdownView, TFile } from "obsidian";
import { mount, unmount } from "svelte";
import TwohopLinksRootView from "./view/TwohopLinksRootView.svelte";
import { getContainerElements } from "./domUtils";

interface MountedComponent {
	component: Record<string, any>;
	container: Element;
	file: TFile;
	filePath: string;
}

export class ComponentManager {
	private mountedComponents: WeakMap<MarkdownView, MountedComponent[]> =
		new WeakMap();

	mountComponentsForView(view: MarkdownView, file: TFile | null): void {
		if (!file) {
			this.unmountViewComponents(view);
			return;
		}
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
				if (this.shouldRemountComponent(mounted, file)) {
					this.unmountMountedComponent(mounted, {
						removeContainer: false,
					});
					nextMounted.push(this.mountComponent(container, file));
				} else {
					this.updateMountedComponent(mounted, file);
					nextMounted.push(mounted);
				}
			} else {
				nextMounted.push(this.mountComponent(container, file));
			}
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
			if (!reusedContainers.has(mounted.container)) {
				this.unmountMountedComponent(mounted);
			}
		}
	}

	private mountComponent(container: Element, file: TFile): MountedComponent {
		const component = mount(TwohopLinksRootView, {
			target: container,
			props: { file },
		});
		return { component, container, file, filePath: file.path };
	}

	private updateMountedComponent(
		mounted: MountedComponent,
		file: TFile
	): void {
		if (typeof mounted.component?.$set === "function") {
			mounted.component.$set({ file });
		}
		mounted.file = file;
		mounted.filePath = file.path;
	}

	private shouldRemountComponent(
		mounted: MountedComponent,
		file: TFile
	): boolean {
		return mounted.file !== file || mounted.filePath !== file.path;
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
