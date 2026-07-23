import type { App, Pos, TFile } from "obsidian";
import {
	createPreviewActivationScope,
	disposePreviewActivationScope,
	requestQueuedPreviewActivation,
	type PreviewActivationHandle,
	type PreviewActivationScope,
	type PreviewBackpressure,
	type PreviewBackpressureListener,
} from "features/preview/scheduling/previewActivationScheduler";
import {
	createCardPreviewRenderer,
	type CardPreviewLoader,
	type CardPreviewRenderer,
	type CardPreviewRetention,
} from "features/preview/ui/cardPreviewRenderer";
import { createCardPreviewRenderRequestResolver } from "features/preview/ui/cardPreviewRenderRequest";
import type { PreviewData } from "features/preview/public-types";
import type { PluginSettings } from "features/settings/model";
import type { RowRange } from "ui/virtualization/rowRange";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import type {
	RowPreviewBindingDelta,
	RowPreviewCardBinding,
	RowPreviewWindow,
} from "./rowPreviewTypes";

export type {
	RowPreviewBindingDelta,
	RowPreviewCardBinding,
	RowPreviewWindow,
} from "./rowPreviewTypes";

export interface PreviewHostLease {
	dispose(): void;
}

export interface VirtualPreviewSurface {
	registerHost(slotId: string, element: HTMLElement): PreviewHostLease;
	syncBindingDelta(delta: RowPreviewBindingDelta): void;
	setPreviewWindow(window: RowPreviewWindow): void;
	commitBindingDelta(delta: RowPreviewBindingDelta, window: RowPreviewWindow): void;
	dispose(): void;
}

export interface CreateVirtualPreviewSurfaceOptions {
	readonly app?: App;
	readonly getPreview?: CardPreviewLoader;
	readonly getSettings: () => PluginSettings;
	readonly getPreviewRenderVersion: (filePath: string) => string;
	readonly resolveSearchMatchPosition?: (
		query: string,
		file: TFile | null | undefined,
	) => Pos | undefined;
	readonly getBackpressure?: () => PreviewBackpressure;
	readonly subscribeBackpressure?: (
		listener: PreviewBackpressureListener,
	) => () => void;
	readonly schedulerIdentity?: object;
	readonly frameCoordinator?: VirtualFrameCoordinator;
	readonly getActivationsPerSecond?: () => number;
	readonly getDomCommitsPerSecond?: () => number;
	/** Optional renderer boundary used by isolated surface tests. */
	readonly createRenderer?: () => CardPreviewRenderer;
}

export type PreviewHostPhase = "empty" | "loading" | "committed" | "dormant" | "stale";

interface PreviewRenderToken {
	readonly slotId: string;
	readonly hostEpoch: number;
	readonly bindingEpoch: number;
	readonly renderEpoch: number;
	readonly identity: string;
}

interface PreviewSlotRuntime {
	readonly slotId: string;
	binding?: RowPreviewCardBinding;
	bindingIdentity?: string;
	bindingRowIndex?: number;
	host?: {
		element: HTMLElement;
		epoch: number;
	};
	hostEpoch: number;
	bindingEpoch: number;
	renderEpoch: number;
	renderCleanup?: () => void;
	lifecycleCleanupHandle?: number;
	renderer?: CardPreviewRenderer;
	resolveRenderRequest: ReturnType<typeof createCardPreviewRenderRequestResolver>;
	committed?: {
		identity: string;
		contentType: PreviewData["type"] | undefined;
		retention: CardPreviewRetention;
		hostEpoch: number;
	};
	phase: PreviewHostPhase;
}

const EMPTY_RANGE: RowRange = { start: 0, end: 0 };

/** Owns imperative preview DOM and lifecycle for one virtual surface. */
export function createVirtualPreviewSurface(
	options: CreateVirtualPreviewSurfaceOptions,
): VirtualPreviewSurface {
	const slotsById = new Map<string, PreviewSlotRuntime>();
	const pendingByIdentity = new Map<string, PreviewActivationHandle>();
	const activationIdentities = new Set<string>();
	const scope: PreviewActivationScope = createPreviewActivationScope({
		getBackpressure: options.getBackpressure,
		subscribeBackpressure: options.subscribeBackpressure,
		schedulerIdentity: options.schedulerIdentity,
		frameCoordinator: options.frameCoordinator,
		getActivationsPerSecond: options.getActivationsPerSecond,
	});
	let previewRange: RowRange = EMPTY_RANGE;
	let disposed = false;

	function getOrCreateSlot(slotId: string): PreviewSlotRuntime {
		const existing = slotsById.get(slotId);
		if (existing) return existing;
		const slot: PreviewSlotRuntime = {
			slotId,
			hostEpoch: 0,
			bindingEpoch: 0,
			renderEpoch: 0,
			resolveRenderRequest: createCardPreviewRenderRequestResolver(),
			phase: "empty",
		};
		slotsById.set(slotId, slot);
		return slot;
	}

	function isInPreviewRange(slot: PreviewSlotRuntime): boolean {
		const rowIndex = slot.bindingRowIndex;
		return (
			rowIndex !== undefined &&
			rowIndex >= previewRange.start &&
			rowIndex < previewRange.end
		);
	}

	function isCurrent(slot: PreviewSlotRuntime, token: PreviewRenderToken): boolean {
		return (
			!disposed &&
			slot.host?.epoch === token.hostEpoch &&
			slot.bindingEpoch === token.bindingEpoch &&
			slot.renderEpoch === token.renderEpoch &&
			slot.binding?.snapshot.identity === token.identity
		);
	}

	function applySlotState(slot: PreviewSlotRuntime): void {
		const host = slot.host;
		if (!host) return;
		const element = host.element;
		applyHostState(element, {
			phase: slot.phase,
			contentType: slot.committed?.contentType,
			hasContent:
				slot.committed?.hostEpoch === host.epoch && !!element.firstChild,
		});
	}

	function cancelLifecycleCleanup(slot: PreviewSlotRuntime): void {
		if (slot.lifecycleCleanupHandle === undefined) return;
		window.cancelIdleCallback(slot.lifecycleCleanupHandle);
		slot.lifecycleCleanupHandle = undefined;
	}

	function stopRender(slot: PreviewSlotRuntime): void {
		slot.renderEpoch += 1;
		slot.renderCleanup?.();
		slot.renderCleanup = undefined;
	}

	function clearCommittedDom(slot: PreviewSlotRuntime): void {
		const element = slot.host?.element;
		if (element) element.replaceChildren();
		slot.committed = undefined;
	}

	function scheduleLifecycleCleanup(slot: PreviewSlotRuntime): void {
		cancelLifecycleCleanup(slot);
		const bindingEpoch = slot.bindingEpoch;
		const hostEpoch = slot.host?.epoch;
		const identity = slot.committed?.identity;
		if (hostEpoch === undefined || !identity) return;

		slot.lifecycleCleanupHandle = window.requestIdleCallback(() => {
			slot.lifecycleCleanupHandle = undefined;
			if (disposed || isInPreviewRange(slot)) return;
			if (slot.bindingEpoch !== bindingEpoch) return;
			if (slot.host?.epoch !== hostEpoch) return;
			if (slot.committed?.identity !== identity) return;
			clearCommittedDom(slot);
			slot.phase = "dormant";
			applySlotState(slot);
		});
	}

	function createRenderer(slot: PreviewSlotRuntime): CardPreviewRenderer | undefined {
		if (slot.renderer) return slot.renderer;
		if (options.createRenderer) {
			slot.renderer = options.createRenderer();
			return slot.renderer;
		}
		if (!options.app || !options.getPreview) return undefined;
		slot.renderer = createCardPreviewRenderer({
			app: options.app,
			getPreview: options.getPreview,
			frameCoordinator: options.frameCoordinator,
			getDomCommitsPerSecond: options.getDomCommitsPerSecond,
			resolveSearchMatchPosition: options.resolveSearchMatchPosition,
			onMathRenderingChange: () => {},
			onCommitted: () => {},
			onRendered: () => {},
		});
		return slot.renderer;
	}

	function activateSlot(slot: PreviewSlotRuntime): void {
		const binding = slot.binding;
		const host = slot.host;
		if (!binding || !host || !isInPreviewRange(slot)) return;
		if (
			slot.committed?.identity === binding.snapshot.identity &&
			slot.committed.retention === "resident" &&
			slot.committed.hostEpoch === host.epoch &&
			slot.phase !== "dormant" &&
			slot.phase !== "stale"
		) {
			return;
		}

		const renderer = createRenderer(slot);
		if (!renderer) return;
		cancelLifecycleCleanup(slot);
		stopRender(slot);
		const token: PreviewRenderToken = {
			slotId: slot.slotId,
			hostEpoch: host.epoch,
			bindingEpoch: slot.bindingEpoch,
			renderEpoch: slot.renderEpoch,
			identity: binding.snapshot.identity,
		};
		const request = slot.resolveRenderRequest(
			binding.snapshot.file,
			binding.snapshot.previewRefreshToken,
			binding.snapshot.previewOverride,
			options.getPreviewRenderVersion(binding.snapshot.file.path),
			binding.snapshot.searchQuery,
			options.getSettings(),
		);
		if (!request) return;

		slot.renderCleanup = renderer(
			host.element,
			request,
			binding.snapshot.identity,
			{
				isCurrent: () => isCurrent(slot, token),
				onLoadingChange: (isLoading) => {
					if (!isCurrent(slot, token)) return;
					if (isLoading) {
						slot.phase = slot.committed ? "stale" : "loading";
						applySlotState(slot);
					}
				},
				onCommitted: (contentType, retention) => {
					if (!isCurrent(slot, token)) return;
					slot.committed = {
						identity: token.identity,
						contentType,
						retention,
						hostEpoch: token.hostEpoch,
					};
					slot.phase = "committed";
					applySlotState(slot);
				},
				onRendered: () => {},
				onError: () => {
					if (!isCurrent(slot, token)) return;
					const cleanup = slot.renderCleanup;
					slot.renderCleanup = undefined;
					cleanup?.();
					const hasCurrentResident =
						slot.committed?.retention === "resident" &&
						slot.committed.hostEpoch === token.hostEpoch;
					slot.phase = hasCurrentResident ? "stale" : "empty";
					if (!hasCurrentResident) clearCommittedDom(slot);
					applySlotState(slot);
				},
			},
		);
	}

	function activateIdentity(identity: string): void {
		if (disposed) return;
		for (const slot of slotsById.values()) {
			if (slot.binding?.snapshot.identity !== identity) continue;
			activateSlot(slot);
		}
	}

	function enqueueActivation(identity: string): void {
		if (pendingByIdentity.has(identity)) return;
		const handle = requestQueuedPreviewActivation(identity, scope, () => {
			pendingByIdentity.delete(identity);
			activateIdentity(identity);
		});
		pendingByIdentity.set(identity, handle);
	}

	function deactivateSlot(slot: PreviewSlotRuntime): void {
		if (slot.committed?.retention === "resident") {
			if (slot.committed.identity === slot.binding?.snapshot.identity) {
				slot.phase = "committed";
				applySlotState(slot);
			}
			return;
		}
		if (!slot.committed && !slot.renderCleanup) return;
		stopRender(slot);
		slot.phase = "dormant";
		applySlotState(slot);
		scheduleLifecycleCleanup(slot);
	}

	function reconcile(): void {
		activationIdentities.clear();
		for (const slot of slotsById.values()) {
			if (!slot.binding) continue;
			if (!isInPreviewRange(slot)) {
				deactivateSlot(slot);
				continue;
			}
			cancelLifecycleCleanup(slot);
			const isReusableResident =
				slot.committed?.identity === slot.binding.snapshot.identity &&
				slot.committed.retention === "resident" &&
				slot.committed.hostEpoch === slot.host?.epoch &&
				slot.phase === "committed";
			if (!isReusableResident && !slot.renderCleanup) {
				activationIdentities.add(slot.binding.snapshot.identity);
			}
		}
		for (const [identity, handle] of pendingByIdentity) {
			if (activationIdentities.has(identity)) continue;
			handle.cancel();
			pendingByIdentity.delete(identity);
		}
		for (const identity of activationIdentities) enqueueActivation(identity);
		activationIdentities.clear();
	}

	function bindCard(binding: RowPreviewCardBinding): void {
		const slot = getOrCreateSlot(binding.slotId);
		const previousIdentity = slot.bindingIdentity;
		if (
			previousIdentity === binding.snapshot.identity &&
			slot.bindingRowIndex === binding.rowIndex
		) {
			slot.binding = binding;
			return;
		}
		cancelLifecycleCleanup(slot);
		stopRender(slot);
		slot.bindingEpoch += 1;
		slot.binding = binding;
		slot.bindingIdentity = binding.snapshot.identity;
		slot.bindingRowIndex = binding.rowIndex;
		if (slot.committed) {
			slot.phase = "stale";
		} else {
			slot.phase = "empty";
		}
		applySlotState(slot);
	}

	function releaseSlot(slotId: string): void {
		const slot = slotsById.get(slotId);
		if (!slot) return;
		cancelLifecycleCleanup(slot);
		stopRender(slot);
		slot.bindingEpoch += 1;
		slot.binding = undefined;
		slot.bindingIdentity = undefined;
		slot.bindingRowIndex = undefined;
		clearCommittedDom(slot);
		slot.phase = "empty";
		applySlotState(slot);
	}

	function applyBindingDelta(delta: RowPreviewBindingDelta): void {
		for (const slotId of delta.releasedSlots) releaseSlot(slotId);
		for (const binding of delta.enteredSlots) bindCard(binding);
		for (const binding of delta.reboundSlots) bindCard(binding);
	}

	function registerHost(slotId: string, element: HTMLElement): PreviewHostLease {
		const slot = getOrCreateSlot(slotId);
		if (slot.host?.element !== element) {
			cancelLifecycleCleanup(slot);
			stopRender(slot);
			slot.hostEpoch += 1;
			slot.host = { element, epoch: slot.hostEpoch };
			slot.committed = undefined;
			slot.phase = "empty";
			applySlotState(slot);
			reconcile();
		}
		const leaseEpoch = slot.host.epoch;
		let leaseDisposed = false;
		return {
			dispose(): void {
				if (leaseDisposed) return;
				leaseDisposed = true;
				if (slot.host?.epoch !== leaseEpoch) return;
				cancelLifecycleCleanup(slot);
				stopRender(slot);
				slot.hostEpoch += 1;
				slot.host = undefined;
				slot.committed = undefined;
			},
		};
	}

	function syncBindingDelta(delta: RowPreviewBindingDelta): void {
		if (disposed) return;
		applyBindingDelta(delta);
		reconcile();
	}

	function setPreviewWindow(window: RowPreviewWindow): void {
		if (disposed) return;
		previewRange = window.active ? window.previewRange : EMPTY_RANGE;
		reconcile();
	}

	function commitBindingDelta(
		delta: RowPreviewBindingDelta,
		window: RowPreviewWindow,
	): void {
		if (disposed) return;
		previewRange = window.active ? window.previewRange : EMPTY_RANGE;
		applyBindingDelta(delta);
		reconcile();
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		for (const handle of pendingByIdentity.values()) handle.cancel();
		pendingByIdentity.clear();
		for (const slot of slotsById.values()) {
			cancelLifecycleCleanup(slot);
			stopRender(slot);
			slot.host = undefined;
			slot.binding = undefined;
			slot.bindingIdentity = undefined;
			slot.bindingRowIndex = undefined;
			slot.committed = undefined;
		}
		slotsById.clear();
		activationIdentities.clear();
		disposePreviewActivationScope(scope);
	}

	return {
		registerHost,
		syncBindingDelta,
		setPreviewWindow,
		commitBindingDelta,
		dispose,
	};
}

export function applyHostState(
	element: HTMLElement,
	state: {
		phase: PreviewHostPhase;
		contentType?: PreviewData["type"];
		hasContent?: boolean;
	},
): void {
	element.dataset.previewState = state.phase;
	if (state.contentType) {
		element.dataset.previewType = state.contentType;
	} else {
		delete element.dataset.previewType;
	}
	if (state.hasContent) {
		element.dataset.hasPreviewContent = "true";
	} else {
		delete element.dataset.hasPreviewContent;
	}
	element.classList.toggle("is-stale", state.phase === "stale");
	for (const type of ["text", "image", "empty", "dom"] as const) {
		element.classList.toggle(
			`cosense-card-links__box-preview--${type}`,
			state.contentType === type,
		);
	}
}
