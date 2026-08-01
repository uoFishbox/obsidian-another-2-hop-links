import type { PreviewData } from "features/preview/public-types";
import type { CardPreviewRequest } from "features/preview/core/cardPreviewRequest";
import type { CardPreviewRenderer, CardPreviewRetention } from "./cardPreviewRenderer";

export interface PreviewBinding {
	readonly ownerToken: object;
	readonly request: CardPreviewRequest;
}

export type SlotGeneration = number;

export type PreviewSlotPhase =
	| "empty"
	| "loading"
	| "committed"
	| "error"
	| "dormant"
	| "stale";

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
	bind(binding: PreviewBinding | null): void;
	setActive(active: boolean): void;
	setMathRendering(isRendering: boolean): void;
	invalidate(): void;
	needsActivation(): boolean;
	hasCachedPreview(): boolean;
	activate(): void;
	clear(): void;
	dispose(): void;
}

export interface CreatePreviewSlotControllerOptions {
	readonly createRenderer: () => CardPreviewRenderer;
	readonly hasCachedPreview?: (renderKey: string) => boolean;
	readonly onStateChange?: (state: PreviewSlotState) => void;
}

type SlotBinding =
	| { readonly state: "empty"; readonly generation: SlotGeneration }
	| {
			readonly state: "bound";
			readonly generation: SlotGeneration;
			readonly value: PreviewBinding;
	  }
	| {
			readonly state: "invalidated";
			readonly generation: SlotGeneration;
			readonly value: PreviewBinding | null;
	  };

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
			readonly retention: CardPreviewRetention;
			readonly host: HTMLElement;
			release: (() => void) | undefined;
	  }
	| {
			readonly state: "error";
			readonly renderKey: string;
			readonly host: HTMLElement;
			release: (() => void) | undefined;
	  };

const EMPTY_STATE: PreviewSlotState = {
	phase: "empty",
	hasContent: false,
	isMathRendering: false,
};

/** Owns the renderer lifecycle and retained DOM for one physical preview host. */
export function createPreviewSlotController(
	options: CreatePreviewSlotControllerOptions,
): PreviewSlotController {
	let nextGeneration = 0;
	let binding: SlotBinding = { state: "empty", generation: nextGeneration };
	let host: HTMLElement | undefined;
	let hostGeneration = 0;
	let activity: SlotActivity = "idle";
	let isMathRendering = false;
	let operation: SlotOperation = { state: "idle" };
	let content: SlotContent = { state: "empty" };
	let cleanupHandle: number | undefined;
	let renderer: CardPreviewRenderer | undefined;
	let disposed = false;
	let appliedState = EMPTY_STATE;

	function advanceBindingGeneration(): SlotGeneration {
		nextGeneration += 1;
		if (binding.state === "bound") {
			binding = {
				state: "bound",
				generation: nextGeneration,
				value: binding.value,
			};
		} else if (binding.state === "invalidated") {
			binding = {
				state: "invalidated",
				generation: nextGeneration,
				value: binding.value,
			};
		} else {
			binding = { state: "empty", generation: nextGeneration };
		}
		return nextGeneration;
	}

	function deriveState(): PreviewSlotState {
		const hasContent =
			content.state !== "empty" && content.host === host && !!host?.firstChild;
		const committed = content.state === "committed" ? content : undefined;
		let phase: PreviewSlotPhase;
		if (binding.state === "invalidated") {
			phase = "stale";
		} else if (activity === "dormant") {
			phase = "dormant";
		} else if (operation.state === "rendering" && !committed) {
			phase = "loading";
		} else if (content.state === "error") {
			phase =
				binding.state === "bound" &&
				content.renderKey === binding.value.request.renderKey &&
				content.host === host
					? "error"
					: "stale";
		} else if (!committed) {
			phase = "empty";
		} else if (
			binding.state !== "bound" ||
			committed.renderKey !== binding.value.request.renderKey ||
			committed.host !== host
		) {
			phase =
				committed.retention === "resident" && binding.state === "empty"
					? "committed"
					: "stale";
		} else {
			phase = "committed";
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
		window.cancelIdleCallback(cleanupHandle);
		cleanupHandle = undefined;
	}

	function cancelOperation(): void {
		const current = operation;
		operation = { state: "idle" };
		if (current.state === "rendering") current.cancel();
	}

	function releaseContentLease(): void {
		if (content.state === "empty") return;
		const release = content.release;
		content.release = undefined;
		release?.();
	}

	function stopRender(): void {
		isMathRendering = false;
		cancelOperation();
		releaseContentLease();
	}

	function clearDom(): void {
		releaseContentLease();
		host?.replaceChildren();
		content = { state: "empty" };
	}

	function scheduleLifecycleCleanup(): void {
		cancelCleanup();
		const expectedHost = host;
		const expectedGeneration = binding.generation;
		const expectedRenderKey =
			content.state === "committed" ? content.renderKey : undefined;
		if (!expectedHost || !expectedRenderKey) return;

		cleanupHandle = window.requestIdleCallback(() => {
			cleanupHandle = undefined;
			if (
				disposed ||
				activity === "active" ||
				binding.generation !== expectedGeneration
			) {
				return;
			}
			if (
				host !== expectedHost ||
				content.state !== "committed" ||
				content.renderKey !== expectedRenderKey
			) {
				return;
			}
			expectedHost.replaceChildren();
			publishState();
		});
	}

	function isCurrent(
		expectedGeneration: SlotGeneration,
		expectedHost: HTMLElement,
		expectedHostGeneration: number,
	): boolean {
		return (
			!disposed &&
			binding.state === "bound" &&
			binding.generation === expectedGeneration &&
			host === expectedHost &&
			hostGeneration === expectedHostGeneration
		);
	}

	function attachHost(element: HTMLElement): PreviewSlotHostLease {
		const leaseGeneration = ++hostGeneration;
		if (host !== element) {
			cancelCleanup();
			advanceBindingGeneration();
			stopRender();
			clearDom();
			host = element;
			appliedState = EMPTY_STATE;
			publishState();
		} else {
			cancelCleanup();
			advanceBindingGeneration();
			stopRender();
			publishState();
		}
		let leaseDisposed = false;
		return {
			dispose(): void {
				if (leaseDisposed) return;
				leaseDisposed = true;
				if (host !== element || hostGeneration !== leaseGeneration) return;
				cancelCleanup();
				advanceBindingGeneration();
				stopRender();
				clearDom();
				host = undefined;
				appliedState = EMPTY_STATE;
			},
		};
	}

	function bind(next: PreviewBinding | null): void {
		const unchanged =
			binding.state === "bound" &&
			binding.value.ownerToken === next?.ownerToken &&
			binding.value.request.renderKey === next?.request.renderKey;
		if (unchanged) return;
		nextGeneration += 1;
		binding = next
			? { state: "bound", generation: nextGeneration, value: next }
			: { state: "empty", generation: nextGeneration };
		cancelCleanup();
		stopRender();
		publishState();
	}

	function setActive(nextActive: boolean): void {
		if ((activity === "active") === nextActive) return;
		if (nextActive) {
			activity = "active";
			cancelCleanup();
			publishState();
			return;
		}
		if (content.state !== "committed" || content.retention !== "resident") {
			activity = "dormant";
			advanceBindingGeneration();
			stopRender();
			scheduleLifecycleCleanup();
		} else {
			activity = "idle";
		}
		publishState();
	}

	function invalidate(): void {
		if (binding.state === "invalidated") return;
		nextGeneration += 1;
		binding = {
			state: "invalidated",
			generation: nextGeneration,
			value: binding.state === "bound" ? binding.value : null,
		};
		stopRender();
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
			binding.state !== "bound" ||
			!host ||
			operation.state === "rendering"
		) {
			return false;
		}
		if (content.state === "error") return true;
		if (
			content.state !== "committed" ||
			content.renderKey !== binding.value.request.renderKey ||
			content.host !== host
		) {
			return true;
		}
		return content.retention !== "resident" && !content.release;
	}

	function hasCachedPreview(): boolean {
		return binding.state === "bound"
			? (options.hasCachedPreview?.(binding.value.request.renderKey) ?? false)
			: false;
	}

	function activate(): void {
		if (!needsActivation() || binding.state !== "bound" || !host) return;
		renderer ??= options.createRenderer();
		cancelCleanup();
		stopRender();

		const expectedBinding = binding.value;
		const expectedGeneration = binding.generation;
		const expectedHost = host;
		const expectedHostGeneration = hostGeneration;
		let cleanup: (() => void) | undefined;
		let released = false;
		const cancel = (): void => {
			if (released) return;
			released = true;
			cleanup?.();
		};
		operation = {
			state: "rendering",
			cancel,
		};
		// Publish the loading phase exactly once per activation; the renderer
		// reports only the terminal state (committed or error).
		publishState();

		try {
			cleanup = renderer(expectedHost, expectedBinding.request, {
				isCurrent: () =>
					isCurrent(expectedGeneration, expectedHost, expectedHostGeneration),
				onCommitted: (contentType, retention) => {
					if (
						!isCurrent(
							expectedGeneration,
							expectedHost,
							expectedHostGeneration,
						)
					)
						return;
					content = {
						state: "committed",
						renderKey: expectedBinding.request.renderKey,
						contentType,
						retention,
						host: expectedHost,
						release: cancel,
					};
					operation = { state: "idle" };
					publishState();
				},
				onError: () => {
					if (
						!isCurrent(
							expectedGeneration,
							expectedHost,
							expectedHostGeneration,
						)
					)
						return;
					const errorElement = document.createElement("div");
					errorElement.className = "error";
					errorElement.textContent = "Preview not available.";
					expectedHost.replaceChildren(errorElement);
					content = {
						state: "error",
						renderKey: expectedBinding.request.renderKey,
						host: expectedHost,
						release: cancel,
					};
					operation = { state: "idle" };
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
		if (!isCurrent(expectedGeneration, expectedHost, expectedHostGeneration)) {
			if (operation.state === "rendering") {
				operation = { state: "idle" };
				publishState();
			}
			cancel();
		}
	}

	function clear(): void {
		cancelCleanup();
		stopRender();
		nextGeneration += 1;
		binding = { state: "empty", generation: nextGeneration };
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
		invalidate,
		needsActivation,
		hasCachedPreview,
		activate,
		clear,
		dispose,
	};
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
		element.classList.toggle(
			"is-stale",
			next.phase === "stale" || next.phase === "dormant",
		);
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
