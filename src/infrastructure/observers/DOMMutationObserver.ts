import type { StylingService } from "features/link-decoration/stylingService";
import type { PluginHost } from "types/pluginHost";
import { processBasesPane } from "infrastructure/markdown/markdownHandlers";
import { scheduleAnimationFrame } from "ui/shared/scheduling/frame";
import { isHTMLElementLike } from "ui/shared/dom/realmSafeDom";
import { collectWorkspaceDocuments } from "infrastructure/workspace/workspaceDocuments";

const BASES_DISCOVERY_IGNORE_SELECTOR = [
	".cosense-card-links__root",
	".cosense-card-links__container",
	".cosense-card-links__section",
	".cosense-card-links__virtual-grid",
	".cosense-card-links__box",
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

interface BasesObserverHandle {
	disconnect(): void;
}

export class DOMMutationObserver {
	private basesObservers: Map<HTMLElement, BasesObserverHandle> = new Map();
	private basesDiscoveryObservers: Map<Document, MutationObserver> = new Map();
	private basesObserverRefreshCancel: (() => void) | null = null;
	private basesPaneRefreshTimers = new Map<HTMLElement, () => void>();
	private destroyed = false;

	constructor(
		private plugin: PluginHost,
		private stylingService: StylingService,
	) {}

	public initialize(): void {
		this.destroyed = false;
		this.initObservers();
	}

	public destroy(): void {
		this.destroyed = true;
		this.basesObservers.forEach((observer) => observer.disconnect());
		this.basesObservers.clear();
		this.basesDiscoveryObservers.forEach((observer) => observer.disconnect());
		this.basesDiscoveryObservers.clear();
		this.basesObserverRefreshCancel?.();
		this.basesObserverRefreshCancel = null;
		this.basesPaneRefreshTimers.forEach((cancel) => {
			cancel();
		});
		this.basesPaneRefreshTimers.clear();
	}

	public initObservers(): void {
		if (this.destroyed) return;
		this.initBasesObservers();
		this.syncBasesDiscoveryObservers();
	}

	private updateObservers<T extends HTMLElement>(
		observers: Map<T, BasesObserverHandle>,
		newContainers: Set<T>,
		watchFunction: (container: T) => void,
	): void {
		const currentContainers = new Set(observers.keys());
		for (const container of newContainers) {
			if (!currentContainers.has(container)) {
				watchFunction(container);
			}
		}

		for (const container of currentContainers) {
			if (!newContainers.has(container)) {
				const observer = observers.get(container);
				observer?.disconnect();
				observers.delete(container);
			}
		}
	}

	private initBasesObservers(): void {
		const containersToWatch = new Set<HTMLElement>();

		// Workspace Documents cover regular leaves, embedded Bases, and popouts.
		for (const ownerDocument of collectWorkspaceDocuments(
			this.plugin.app.workspace,
		)) {
			ownerDocument.querySelectorAll<HTMLElement>(".bases-view").forEach((el) => {
				containersToWatch.add(el);
			});
		}

		this.updateObservers(this.basesObservers, containersToWatch, (container) =>
			this.watchBasesContainer(container),
		);
	}

	private syncBasesDiscoveryObservers(): void {
		const documents = collectWorkspaceDocuments(this.plugin.app.workspace);

		for (const [ownerDocument, observer] of this.basesDiscoveryObservers) {
			if (documents.has(ownerDocument) && ownerDocument.body?.isConnected) {
				continue;
			}
			observer.disconnect();
			this.basesDiscoveryObservers.delete(ownerDocument);
		}

		for (const ownerDocument of documents) {
			if (
				this.basesDiscoveryObservers.has(ownerDocument) ||
				!ownerDocument.body
			) {
				continue;
			}
			this.startBasesDiscoveryObserver(ownerDocument);
		}
	}

	private startBasesDiscoveryObserver(ownerDocument: Document): void {
		const MutationObserverConstructor =
			ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
		const observer = new MutationObserverConstructor((mutations) => {
			if (this.hasBasesViewContainerChange(mutations)) {
				this.scheduleBasesObserverRefresh(ownerDocument.defaultView);
			}
		});

		observer.observe(ownerDocument.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["class"],
		});
		this.basesDiscoveryObservers.set(ownerDocument, observer);
	}

	private hasBasesViewContainerChange(mutations: MutationRecord[]): boolean {
		for (const mutation of mutations) {
			const target = mutation.target;
			if (
				isHTMLElementLike(target) &&
				this.shouldIgnoreBasesDiscoveryNode(target)
			) {
				continue;
			}

			if (mutation.type === "attributes") {
				if (isHTMLElementLike(target) && target.matches(".bases-view")) {
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
		if (!isHTMLElementLike(node)) {
			return false;
		}

		if (this.shouldIgnoreBasesDiscoveryNode(node)) {
			return false;
		}

		return node.matches(".bases-view") || !!node.querySelector(".bases-view");
	}

	private shouldIgnoreBasesDiscoveryNode(node: Node): boolean {
		if (!isHTMLElementLike(node)) {
			return true;
		}

		return (
			node.matches(BASES_DISCOVERY_IGNORE_SELECTOR) ||
			!!node.closest(BASES_DISCOVERY_IGNORE_SELECTOR)
		);
	}

	private scheduleBasesObserverRefresh(ownerWindow: Window | null): void {
		if (this.basesObserverRefreshCancel !== null) {
			return;
		}

		const win = ownerWindow ?? (typeof window === "undefined" ? null : window);
		if (!win) {
			this.initObservers();
			return;
		}

		const timeoutId = win.setTimeout(() => {
			this.basesObserverRefreshCancel = null;
			this.initObservers();
		}, 0);
		this.basesObserverRefreshCancel = () => {
			win.clearTimeout(timeoutId);
		};
	}

	private watchBasesContainer(container: HTMLElement): void {
		let observer: MutationObserver | null = null;
		let unregisterWindowMigration: (() => void) | null = null;
		let disconnected = false;

		const bindObserver = (): void => {
			observer?.disconnect();
			if (disconnected || this.destroyed || !container.isConnected) {
				observer = null;
				return;
			}

			const ownerWindow = container.ownerDocument.defaultView;
			const MutationObserverConstructor =
				ownerWindow?.MutationObserver ?? MutationObserver;
			observer = new MutationObserverConstructor(() => {
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
		};

		const handle: BasesObserverHandle = {
			disconnect: () => {
				disconnected = true;
				observer?.disconnect();
				observer = null;
				unregisterWindowMigration?.();
				unregisterWindowMigration = null;
			},
		};

		if (typeof container.onWindowMigrated === "function") {
			unregisterWindowMigration = container.onWindowMigrated(() => {
				if (disconnected || this.destroyed) return;
				bindObserver();
				this.basesPaneRefreshTimers.get(container)?.();
				this.basesPaneRefreshTimers.delete(container);
				this.scheduleBasesPaneRefresh(container);
			});
		}

		this.basesObservers.set(container, handle);
		bindObserver();
		this.processExistingLinksInBases(container);
	}

	private scheduleBasesPaneRefresh(container: HTMLElement): void {
		if (this.basesPaneRefreshTimers.has(container)) {
			return;
		}

		const cancel = scheduleAnimationFrame(() => {
			this.basesPaneRefreshTimers.delete(container);
			if (this.destroyed) return;
			if (!container.isConnected) {
				this.initObservers();
				return;
			}
			this.processExistingLinksInBases(container);
		}, container.ownerDocument.defaultView);
		this.basesPaneRefreshTimers.set(container, cancel);
	}

	private processExistingLinksInBases(container: HTMLElement): void {
		processBasesPane(container, this.stylingService);
	}
}
