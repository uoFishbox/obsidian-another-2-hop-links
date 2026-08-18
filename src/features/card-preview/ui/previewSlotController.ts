import type { PreviewData } from "features/card-preview/public-types";
import type { CardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";
import type { CardPreviewAttachment, CardPreviewRenderer } from "./cardPreviewRenderer";

export type PreviewSlotPhase =
	| "empty"
	| "loading"
	| "refreshing"
	| "committed"
	| "error"
	| "dormant";

export interface PreviewSlotState {
	readonly phase: PreviewSlotPhase;
	readonly contentType?: PreviewData["type"];
	readonly hasContent: boolean;
	readonly isMathRendering: boolean;
}

export interface PreviewSlotHostLease {
	dispose(): void;
}

export interface PreviewSlotController {
	attachHost(element: HTMLElement): PreviewSlotHostLease;
	bind(request: CardPreviewRequest | null): void;
	setActive(active: boolean): void;
	setMathRendering(isRendering: boolean): void;
	needsActivation(): boolean;
	activate(): void;
	clear(): void;
	dispose(): void;
}

export interface CreatePreviewSlotControllerOptions {
	readonly createRenderer: () => CardPreviewRenderer;
	readonly onStateChange?: (state: PreviewSlotState) => void;
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

const EMPTY_STATE: PreviewSlotState = {
	phase: "empty",
	hasContent: false,
	isMathRendering: false,
};

/** Owns rendering and retained DOM for one logical card preview. */
export function createPreviewSlotController(
	options: CreatePreviewSlotControllerOptions,
): PreviewSlotController {
	let request: CardPreviewRequest | undefined;
	let revision = 0;
	let host: HTMLElement | undefined;
	let hostGeneration = 0;
	let activity: SlotActivity = "idle";
	let isMathRendering = false;
	let operation: SlotOperation = { state: "idle" };
	let content: SlotContent = { state: "empty" };
	let detachedContent: DocumentFragment | undefined;
	let failedRenderKey: string | undefined;
	let cleanupHandle: number | undefined;
	let cleanupWindow: Window | null = null;
	let cleanupUsesIdleCallback = false;
	let renderer: CardPreviewRenderer | undefined;
	let disposed = false;
	let appliedState = EMPTY_STATE;

	function advanceRevision(): number {
		revision += 1;
		return revision;
	}

	function deriveState(): PreviewSlotState {
		const committed = content.state === "committed" ? content : undefined;
		const hasContent =
			content.state !== "empty" && content.host === host && !!host?.firstChild;
		let phase: PreviewSlotPhase;
		if (activity === "dormant") {
			phase = "dormant";
		} else if (operation.state === "rendering") {
			phase = committed?.host === host && hasContent ? "refreshing" : "loading";
		} else if (
			content.state === "error" &&
			content.host === host &&
			content.renderKey === request?.renderKey
		) {
			phase = "error";
		} else if (committed && committed.host === host && hasContent) {
			if (committed.renderKey === request?.renderKey) phase = "committed";
			else if (failedRenderKey === request?.renderKey) phase = "error";
			else phase = request ? "refreshing" : "committed";
		} else {
			phase = "empty";
		}
		return {
			phase,
			contentType: committed?.contentType,
			hasContent,
			isMathRendering,
		};
	}

	function publishState(): void {
		const next = deriveState();
		if (isSamePreviewSlotState(appliedState, next)) return;
		if (host) applyPreviewSlotHostState(host, appliedState, next);
		appliedState = next;
		options.onStateChange?.(next);
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
			publishState();
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

	function attachHost(element: HTMLElement): PreviewSlotHostLease {
		const leaseGeneration = ++hostGeneration;
		if (host !== element) {
			cancelCleanup();
			advanceRevision();
			isMathRendering = false;
			cancelOperation();
			const previousHost = host;
			const retained =
				previousHost !== undefined && detachDetachableContent(previousHost);
			if (previousHost) resetPreviewSlotHostState(previousHost);
			if (!retained && previousHost) clearDom();
			host = element;
			resetPreviewSlotHostState(element);
			appliedState = EMPTY_STATE;
			if (!restoreDetachableContent(element) && content.state !== "empty") {
				clearDom();
			}
			publishState();
		} else {
			cancelCleanup();
			publishState();
		}
		let leaseDisposed = false;
		return {
			dispose(): void {
				if (leaseDisposed) return;
				leaseDisposed = true;
				if (host !== element || hostGeneration !== leaseGeneration) return;
				cancelCleanup();
				advanceRevision();
				isMathRendering = false;
				cancelOperation();
				const retained = detachDetachableContent(element);
				if (!retained) clearDom();
				resetPreviewSlotHostState(element);
				host = undefined;
				appliedState = EMPTY_STATE;
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
		isMathRendering = false;
		cancelOperation();
		if (content.state === "error") clearDom();
		publishState();
	}

	function setActive(nextActive: boolean): void {
		if ((activity === "active") === nextActive) return;
		if (nextActive) {
			activity = "active";
			failedRenderKey = undefined;
			cancelCleanup();
			publishState();
			return;
		}
		if (content.state !== "committed" || content.attachment !== "detachable") {
			activity = "dormant";
			advanceRevision();
			isMathRendering = false;
			cancelOperation();
			scheduleHostBoundCleanup();
		} else {
			activity = "idle";
		}
		publishState();
	}

	function setMathRendering(next: boolean): void {
		if (isMathRendering === next) return;
		isMathRendering = next;
		publishState();
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
		renderer ??= options.createRenderer();
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
		publishState();

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
					publishState();
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
						publishState();
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
					publishState();
				},
			});
		} catch (error) {
			if (operation.state === "rendering") {
				operation = { state: "idle" };
				publishState();
			}
			cancel();
			throw error;
		}
		if (released) cleanup?.();
		if (!isCurrent(expectedRevision, expectedHost, expectedHostGeneration)) {
			if (operation.state === "rendering") {
				operation = { state: "idle" };
				publishState();
			}
			cancel();
		}
	}

	function clear(): void {
		cancelCleanup();
		advanceRevision();
		isMathRendering = false;
		cancelOperation();
		request = undefined;
		failedRenderKey = undefined;
		activity = "idle";
		clearDom();
		publishState();
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
		setMathRendering,
		needsActivation,
		activate,
		clear,
		dispose,
	};
}

function resetPreviewSlotHostState(element: HTMLElement): void {
	delete element.dataset.previewState;
	delete element.dataset.previewType;
	delete element.dataset.hasPreviewContent;
	element.classList.remove("is-stale");
	for (const type of ["text", "image", "empty", "dom"] as const) {
		element.classList.remove(`cosense-card-links__box-preview--${type}`);
	}
}

function isSamePreviewSlotState(
	left: PreviewSlotState,
	right: PreviewSlotState,
): boolean {
	return (
		left.phase === right.phase &&
		left.contentType === right.contentType &&
		left.hasContent === right.hasContent &&
		left.isMathRendering === right.isMathRendering
	);
}

function applyPreviewSlotHostState(
	element: HTMLElement,
	previous: PreviewSlotState,
	next: PreviewSlotState,
): void {
	if (previous.phase !== next.phase) {
		element.dataset.previewState = next.phase;
		element.classList.toggle("is-stale", next.phase === "dormant");
	}
	if (previous.contentType !== next.contentType) {
		if (next.contentType) element.dataset.previewType = next.contentType;
		else delete element.dataset.previewType;
		for (const type of ["text", "image", "empty", "dom"] as const) {
			element.classList.toggle(
				`cosense-card-links__box-preview--${type}`,
				next.contentType === type,
			);
		}
	}
	if (previous.hasContent !== next.hasContent) {
		if (next.hasContent) element.dataset.hasPreviewContent = "true";
		else delete element.dataset.hasPreviewContent;
	}
}
