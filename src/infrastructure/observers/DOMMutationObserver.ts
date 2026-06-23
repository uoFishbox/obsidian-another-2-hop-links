import type { StylingService } from "features/link-decoration/stylingService";
import type { PluginHost } from "types/pluginHost";
import { processBasesPane } from "infrastructure/markdown/markdownHandlers";
import { enableLogging, logger } from "utils/logger";

const BASES_DISCOVERY_IGNORE_SELECTOR = [
	".cosense-card-links__root",
	".cosense-card-links__box-preview",
	"[data-ccl-preview-island]",
	"[data-ccl-shadow-hover-proxy]",
	"[data-ccl-hover-popover-anchor-proxy]",
	"[data-ccl-hover-popover-anchor-layer]",
	"[data-ccl-hover-popover-anchor]",
	".popover",
	".hover-popover",
	".menu",
	".suggestion-container",
	".notice-container",
].join(", ");

export class DOMMutationObserver {
	private basesObservers: Map<HTMLElement, MutationObserver> = new Map();
	private basesDiscoveryObserver: MutationObserver | null = null;
	private basesObserverRefreshTimer: number | null = null;
	private basesPaneRefreshTimers = new Map<HTMLElement, number>();
	private destroyed = false;

	constructor(
		private plugin: PluginHost,
		private stylingService: StylingService,
	) {}

	public initialize(): void {
		if (enableLogging) logger("[ObserverManager] Initializing all observers");
		this.destroyed = false;
		this.initObservers();
		this.startBasesDiscoveryObserver();
		if (enableLogging) logger("[ObserverManager] All observers initialized");
	}

	public destroy(): void {
		if (enableLogging) logger("[ObserverManager] Destroying all observers");
		this.destroyed = true;
		this.basesObservers.forEach((observer) => observer.disconnect());
		this.basesObservers.clear();
		this.basesDiscoveryObserver?.disconnect();
		this.basesDiscoveryObserver = null;
		if (this.basesObserverRefreshTimer !== null) {
			window.clearTimeout(this.basesObserverRefreshTimer);
			this.basesObserverRefreshTimer = null;
		}
		this.basesPaneRefreshTimers.forEach((timer) => {
			window.clearTimeout(timer);
		});
		this.basesPaneRefreshTimers.clear();

		if (enableLogging) logger("[ObserverManager] All observers destroyed");
	}

	public initObservers(): void {
		if (this.destroyed) return;
		this.initBasesObservers();
	}

	private updateObservers<T extends HTMLElement>(
		observers: Map<T, MutationObserver>,
		newContainers: Set<T>,
		watchFunction: (container: T) => void,
	): void {
		const currentContainers = new Set(observers.keys());
		let added = 0;
		let removed = 0;

		for (const container of newContainers) {
			if (!currentContainers.has(container)) {
				watchFunction(container);
				added++;
			}
		}

		for (const container of currentContainers) {
			if (!newContainers.has(container)) {
				const observer = observers.get(container);
				observer?.disconnect();
				observers.delete(container);
				removed++;
			}
		}

		if (added > 0 || removed > 0) {
			if (enableLogging)
				logger(
					`[ObserverManager.updateObservers] Added: ${added}, Removed: ${removed}`,
				);
		}
	}

	private collectBasesViewContainers(root: HTMLElement): HTMLElement[] {
		if (root.matches(".bases-view")) {
			return [root];
		}

		return Array.from(root.querySelectorAll<HTMLElement>(".bases-view"));
	}

	private initBasesObservers(): void {
		const containersToWatch = new Set<HTMLElement>();

		this.plugin.app.workspace.getLeavesOfType("bases").forEach((leaf) => {
			for (const el of this.collectBasesViewContainers(leaf.view.containerEl)) {
				containersToWatch.add(el);
			}
		});

		this.plugin.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
			for (const el of this.collectBasesViewContainers(leaf.view.containerEl)) {
				containersToWatch.add(el);
			}
		});

		// Bases can also be embedded or internally re-mounted without a workspace
		// leaf transition. Use the visible DOM as a fallback source of truth.
		document.querySelectorAll<HTMLElement>(".bases-view").forEach((el) => {
			containersToWatch.add(el);
		});

		this.updateObservers(this.basesObservers, containersToWatch, (container) =>
			this.watchBasesContainer(container),
		);
	}

	private startBasesDiscoveryObserver(): void {
		if (this.basesDiscoveryObserver || !document.body) {
			return;
		}

		this.basesDiscoveryObserver = new MutationObserver((mutations) => {
			if (this.hasBasesViewContainerChange(mutations)) {
				this.scheduleBasesObserverRefresh();
			}
		});

		this.basesDiscoveryObserver.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["class"],
		});
	}

	private hasBasesViewContainerChange(mutations: MutationRecord[]): boolean {
		for (const mutation of mutations) {
			if (mutation.type === "attributes") {
				const target = mutation.target;
				if (target instanceof HTMLElement && target.matches(".bases-view")) {
					return true;
				}
				continue;
			}

			for (const node of mutation.addedNodes) {
				if (this.nodeContainsBasesView(node)) {
					return true;
				}
			}

			for (const node of mutation.removedNodes) {
				if (this.nodeContainsBasesView(node)) {
					return true;
				}
			}
		}

		return false;
	}

	private nodeContainsBasesView(node: Node): boolean {
		if (!(node instanceof HTMLElement)) {
			return false;
		}

		if (this.shouldIgnoreBasesDiscoveryNode(node)) {
			return false;
		}

		return node.matches(".bases-view") || !!node.querySelector(".bases-view");
	}

	private shouldIgnoreBasesDiscoveryNode(node: Node): boolean {
		if (!(node instanceof HTMLElement)) {
			return true;
		}

		return (
			node.matches(BASES_DISCOVERY_IGNORE_SELECTOR) ||
			!!node.closest(BASES_DISCOVERY_IGNORE_SELECTOR)
		);
	}

	private scheduleBasesObserverRefresh(): void {
		if (this.basesObserverRefreshTimer !== null) {
			return;
		}

		this.basesObserverRefreshTimer = window.setTimeout(() => {
			this.basesObserverRefreshTimer = null;
			this.initObservers();
		}, 0);
	}

	private watchBasesContainer(container: HTMLElement): void {
		if (enableLogging)
			logger(
				"[ObserverManager.watchBasesContainer] Starting watch for Bases container",
			);
		const observer = new MutationObserver((mutations) => {
			if (enableLogging) {
				const addedCount = mutations.reduce(
					(sum, m) => sum + m.addedNodes.length,
					0,
				);
				if (addedCount > 0) {
					logger(
						`[ObserverManager.watchBasesContainer] Detected ${addedCount} added nodes`,
					);
				}
			}
			this.scheduleBasesPaneRefresh(container);
		});

		observer.observe(container, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: [
				"class",
				"href",
				"data-href",
				"data-path",
				"data-file",
				"data-file-path",
				"title",
				"aria-label",
			],
			characterData: true,
		});

		this.basesObservers.set(container, observer);
		this.processExistingLinksInBases(container);
	}

	private scheduleBasesPaneRefresh(container: HTMLElement): void {
		if (this.basesPaneRefreshTimers.has(container)) {
			return;
		}

		const timer = window.setTimeout(() => {
			this.basesPaneRefreshTimers.delete(container);
			if (this.destroyed) return;
			if (!container.isConnected) {
				this.initObservers();
				return;
			}
			this.processExistingLinksInBases(container);
		}, 0);
		this.basesPaneRefreshTimers.set(container, timer);
	}

	private processExistingLinksInBases(container: HTMLElement): void {
		if (enableLogging) {
			const existingCount = container.querySelectorAll(".internal-link").length;
			logger(
				`[ObserverManager.processExistingLinksInBases] Processing ${existingCount} existing links`,
			);
		}
		processBasesPane(container, this.stylingService);
	}
}
