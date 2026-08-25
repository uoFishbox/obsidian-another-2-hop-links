import type { PreviewData } from "preview/types";
import type { CardPreviewRequest } from "preview/pipeline/cardPreviewRequest";
import type { CardPreviewAttachment, CardPreviewRenderer } from "./cardPreviewRenderer";

interface PreviewHostAppearance {
	readonly stale: boolean;
	readonly contentType?: PreviewData["type"];
}

export interface PreviewSlotController {
	attachHost(element: HTMLElement): { dispose(): void };
	bind(request: CardPreviewRequest | null): void;
	setActive(active: boolean): void;
	needsActivation(): boolean;
	activate(): void;
	clear(): void;
	dispose(): void;
}

type SlotOperation =
	| { readonly state: "idle" }
	| {
			readonly state: "rendering";
			readonly cancel: () => void;
	  };

type SlotActivity = "idle" | "active" | "dormant";

type SlotContent =
	| { readonly state: "empty" }
	| {
			readonly state: "committed";
			readonly renderKey: string;
			readonly contentType: PreviewData["type"] | undefined;
			readonly attachment: CardPreviewAttachment;
			readonly host: HTMLElement;
			release: (() => void) | undefined;
	  }
	| {
			readonly state: "error";
			readonly renderKey: string;
			readonly host: HTMLElement;
	  };

const EMPTY_APPEARANCE: PreviewHostAppearance = {
	stale: false,
};

/** Owns rendering and retained DOM for one logical card preview. */
export function createPreviewSlotController(
	createRenderer: () => CardPreviewRenderer,
): PreviewSlotController {
	let request: CardPreviewRequest | undefined;
	let revision = 0;
	let host: HTMLElement | undefined;
	let hostGeneration = 0;
	let activity: SlotActivity = "idle";
	let operation: SlotOperation = { state: "idle" };
	let content: SlotContent = { state: "empty" };
	let detachedContent: DocumentFragment | undefined;
	let failedRenderKey: string | undefined;
	let cleanupHandle: number | undefined;
	let cleanupWindow: Window | null = null;
	let cleanupUsesIdleCallback = false;
	let renderer: CardPreviewRenderer | undefined;
	let disposed = false;
	let appliedAppearance = EMPTY_APPEARANCE;

	function advanceRevision(): number {
		revision += 1;
		return revision;
	}

	function deriveAppearance(): PreviewHostAppearance {
		const committed = content.state === "committed" ? content : undefined;
		return {
			stale: activity === "dormant",
			contentType: committed?.contentType,
		};
	}

	function syncHostAppearance(): void {
		const next = deriveAppearance();
		if (isSamePreviewHostAppearance(appliedAppearance, next)) return;
		if (host) applyPreviewHostAppearance(host, appliedAppearance, next);
		appliedAppearance = next;
	}

	function cancelCleanup(): void {
		if (cleanupHandle === undefined) return;
		if (cleanupUsesIdleCallback && cleanupWindow?.cancelIdleCallback) {
			cleanupWindow.cancelIdleCallback(cleanupHandle);
		} else {
			cleanupWindow?.clearTimeout(cleanupHandle);
		}
		cleanupHandle = undefined;
		cleanupWindow = null;
		cleanupUsesIdleCallback = false;
	}

	function cancelOperation(): void {
		const current = operation;
		operation = { state: "idle" };
		if (current.state === "rendering") current.cancel();
	}

	function releaseContentLease(): void {
		if (content.state !== "committed") return;
		const release = content.release;
		content.release = undefined;
		release?.();
	}

	function clearDom(): void {
		releaseContentLease();
		host?.replaceChildren();
		detachedContent?.replaceChildren();
		detachedContent = undefined;
		content = { state: "empty" };
	}

	function detachDetachableContent(element: HTMLElement): boolean {
		if (
			content.state !== "committed" ||
			content.attachment !== "detachable" ||
			content.host !== element
		) {
			return false;
		}
		const fragment = element.ownerDocument.createDocumentFragment();
		while (element.firstChild) fragment.appendChild(element.firstChild);
		detachedContent = fragment;
		return true;
	}

	function restoreDetachableContent(element: HTMLElement): boolean {
		if (
			!detachedContent ||
			content.state !== "committed" ||
			content.attachment !== "detachable"
		) {
			return false;
		}
		element.replaceChildren(detachedContent);
		detachedContent = undefined;
		content = { ...content, host: element };
		return true;
	}

	function scheduleHostBoundCleanup(): void {
		cancelCleanup();
		const expectedHost = host;
		const expectedRevision = revision;
		const expectedRenderKey =
			content.state === "committed" ? content.renderKey : undefined;
		if (!expectedHost || !expectedRenderKey) return;
		const ownerWindow = expectedHost.ownerDocument.defaultView;
		if (!ownerWindow) return;
		cleanupWindow = ownerWindow;
		const runCleanup = () => {
			cleanupHandle = undefined;
			cleanupWindow = null;
			cleanupUsesIdleCallback = false;
			if (disposed || activity === "active" || revision !== expectedRevision) {
				return;
			}
			if (
				host !== expectedHost ||
				content.state !== "committed" ||
				content.renderKey !== expectedRenderKey
			) {
				return;
			}
			clearDom();
			syncHostAppearance();
		};
		if (typeof ownerWindow.requestIdleCallback === "function") {
			cleanupUsesIdleCallback = true;
			cleanupHandle = ownerWindow.requestIdleCallback(runCleanup);
		} else {
			cleanupUsesIdleCallback = false;
			cleanupHandle = ownerWindow.setTimeout(runCleanup, 0);
		}
	}

	function isCurrent(
		expectedRevision: number,
		expectedHost: HTMLElement,
		expectedHostGeneration: number,
	): boolean {
		return (
			!disposed &&
			request !== undefined &&
			revision === expectedRevision &&
			host === expectedHost &&
			hostGeneration === expectedHostGeneration
		);
	}

	function attachHost(element: HTMLElement): { dispose(): void } {
		const leaseGeneration = ++hostGeneration;
		if (host !== element) {
			cancelCleanup();
			advanceRevision();
			cancelOperation();
			const previousHost = host;
			const retained =
				previousHost !== undefined && detachDetachableContent(previousHost);
			if (previousHost) resetPreviewHostAppearance(previousHost);
			if (!retained && previousHost) clearDom();
			host = element;
			resetPreviewHostAppearance(element);
			appliedAppearance = EMPTY_APPEARANCE;
			if (!restoreDetachableContent(element) && content.state !== "empty") {
				clearDom();
			}
			syncHostAppearance();
		} else {
			cancelCleanup();
		}
		let leaseDisposed = false;
		return {
			dispose(): void {
				if (leaseDisposed) return;
				leaseDisposed = true;
				if (host !== element || hostGeneration !== leaseGeneration) return;
				cancelCleanup();
				advanceRevision();
				cancelOperation();
				const retained = detachDetachableContent(element);
				if (!retained) clearDom();
				resetPreviewHostAppearance(element);
				host = undefined;
				appliedAppearance = EMPTY_APPEARANCE;
			},
		};
	}

	function bind(next: CardPreviewRequest | null): void {
		if (!next) {
			clear();
			return;
		}
		if (request?.renderKey === next.renderKey) {
			request = next;
			return;
		}
		request = next;
		failedRenderKey = undefined;
		advanceRevision();
		cancelCleanup();
		cancelOperation();
		if (content.state === "error") clearDom();
	}

	function setActive(nextActive: boolean): void {
		if ((activity === "active") === nextActive) return;
		if (nextActive) {
			activity = "active";
			failedRenderKey = undefined;
			cancelCleanup();
			syncHostAppearance();
			return;
		}
		if (content.state !== "committed" || content.attachment !== "detachable") {
			activity = "dormant";
			advanceRevision();
			cancelOperation();
			scheduleHostBoundCleanup();
		} else {
			activity = "idle";
		}
		syncHostAppearance();
	}

	function needsActivation(): boolean {
		if (
			disposed ||
			activity !== "active" ||
			!request ||
			!host ||
			operation.state === "rendering" ||
			failedRenderKey === request.renderKey
		) {
			return false;
		}
		if (content.state === "error") return true;
		if (
			content.state !== "committed" ||
			content.renderKey !== request.renderKey ||
			content.host !== host
		) {
			return true;
		}
		return content.attachment !== "detachable" && !content.release;
	}

	function activate(): void {
		if (!needsActivation() || !request || !host) return;
		renderer ??= createRenderer();
		cancelCleanup();
		cancelOperation();

		const expectedRequest = request;
		const expectedRevision = revision;
		const expectedHost = host;
		const expectedHostGeneration = hostGeneration;
		let cleanup: (() => void) | undefined;
		let released = false;
		const cancel = (): void => {
			if (released) return;
			released = true;
			cleanup?.();
		};
		operation = { state: "rendering", cancel };

		try {
			cleanup = renderer(expectedHost, expectedRequest, {
				onCommitted: (contentType, attachment) => {
					if (
						!isCurrent(
							expectedRevision,
							expectedHost,
							expectedHostGeneration,
						)
					)
						return;
					const previousRelease =
						content.state === "committed" ? content.release : undefined;
					content = {
						state: "committed",
						renderKey: expectedRequest.renderKey,
						contentType,
						attachment,
						host: expectedHost,
						release: attachment === "host-bound" ? cancel : undefined,
					};
					failedRenderKey = undefined;
					operation = { state: "idle" };
					previousRelease?.();
					if (attachment === "detachable") cancel();
					syncHostAppearance();
				},
				onError: () => {
					if (
						!isCurrent(
							expectedRevision,
							expectedHost,
							expectedHostGeneration,
						)
					)
						return;
					operation = { state: "idle" };
					if (
						content.state === "committed" &&
						content.host === expectedHost
					) {
						failedRenderKey = expectedRequest.renderKey;
						cancel();
						return;
					}
					const errorElement =
						expectedHost.ownerDocument.createElement("div");
					errorElement.className = "error";
					errorElement.textContent = "Preview not available.";
					expectedHost.replaceChildren(errorElement);
					cancel();
					content = {
						state: "error",
						renderKey: expectedRequest.renderKey,
						host: expectedHost,
					};
				},
			});
		} catch (error) {
			if (operation.state === "rendering") {
				operation = { state: "idle" };
			}
			cancel();
			throw error;
		}
		if (released) cleanup?.();
		if (!isCurrent(expectedRevision, expectedHost, expectedHostGeneration)) {
			if (operation.state === "rendering") {
				operation = { state: "idle" };
			}
			cancel();
		}
	}

	function clear(): void {
		cancelCleanup();
		advanceRevision();
		cancelOperation();
		request = undefined;
		failedRenderKey = undefined;
		activity = "idle";
		clearDom();
		syncHostAppearance();
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		clear();
		host = undefined;
	}

	return {
		attachHost,
		bind,
		setActive,
		needsActivation,
		activate,
		clear,
		dispose,
	};
}

function resetPreviewHostAppearance(element: HTMLElement): void {
	element.classList.remove("is-stale");
	for (const type of ["text", "image", "empty", "dom"] as const) {
		element.classList.remove(`cosense-card-links__box-preview--${type}`);
	}
}

function isSamePreviewHostAppearance(
	left: PreviewHostAppearance,
	right: PreviewHostAppearance,
): boolean {
	return left.stale === right.stale && left.contentType === right.contentType;
}

function applyPreviewHostAppearance(
	element: HTMLElement,
	previous: PreviewHostAppearance,
	next: PreviewHostAppearance,
): void {
	if (previous.stale !== next.stale) {
		element.classList.toggle("is-stale", next.stale);
	}
	if (previous.contentType !== next.contentType) {
		for (const type of ["text", "image", "empty", "dom"] as const) {
			element.classList.toggle(
				`cosense-card-links__box-preview--${type}`,
				next.contentType === type,
			);
		}
	}
}
