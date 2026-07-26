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
import { createPreviewFrameDriver } from "features/preview/scheduling/previewFrameDriver";
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

interface PreviewHostState {
	readonly phase: PreviewHostPhase;
	readonly contentType?: PreviewData["type"];
	readonly hasContent: boolean;
}

interface PreviewOperationToken {
	readonly slotId: string;
	readonly slotEpoch: number;
	readonly host: HTMLElement;
	readonly previewIdentity: string;
}

interface PreviewSlotRuntime {
	readonly slotId: string;
	binding?: RowPreviewCardBinding;
	bindingIdentity?: string;
	bindingRowIndex?: number;
	host?: {
		element: HTMLElement;
		appliedState?: PreviewHostState;
	};
	operationEpoch: number;
	renderCleanup?: () => void;
	lifecycleCleanupHandle?: number;
	renderer?: CardPreviewRenderer;
	resolveRenderRequest: ReturnType<typeof createCardPreviewRenderRequestResolver>;
	committed?: {
		identity: string;
		contentType: PreviewData["type"] | undefined;
		retention: CardPreviewRetention;
		host: HTMLElement;
	};
	phase: PreviewHostPhase;
}

const EMPTY_RANGE: RowRange = { start: 0, end: 0 };
const PREVIEW_SIDECAR_FLUSH_KEY = "two-hop:preview-sidecar-flush";

/** Owns imperative preview DOM and lifecycle for one virtual surface. */
export function createVirtualPreviewSurface(
	options: CreateVirtualPreviewSurfaceOptions,
): VirtualPreviewSurface {
	const slotsById = new Map<string, PreviewSlotRuntime>();
	const pendingByIdentity = new Map<string, PreviewActivationHandle>();
	const activationIdentities = new Set<string>();
	const stagedBindingsBySlot = new Map<string, RowPreviewCardBinding | null>();
	const stagedInvalidatedSlots = new Set<string>();
	const scope: PreviewActivationScope = createPreviewActivationScope({
		getBackpressure: options.getBackpressure,
		subscribeBackpressure: options.subscribeBackpressure,
		schedulerIdentity: options.schedulerIdentity,
		frameCoordinator: options.frameCoordinator,
		getActivationsPerSecond: options.getActivationsPerSecond,
	});
	let previewRange: RowRange = EMPTY_RANGE;
	let stagedPreviewRange: RowRange | undefined;
	let disposed = false;
	const stagedFlushDriver = createPreviewFrameDriver({
		coordinator: options.frameCoordinator,
		taskKey: PREVIEW_SIDECAR_FLUSH_KEY,
		onFrame: flushStagedPreviewChanges,
	});

	function getOrCreateSlot(slotId: string): PreviewSlotRuntime {
		const existing = slotsById.get(slotId);
		if (existing) return existing;
		const slot: PreviewSlotRuntime = {
			slotId,
			operationEpoch: 0,
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

	function isCurrent(
		slot: PreviewSlotRuntime,
		token: PreviewOperationToken,
	): boolean {
		const desiredBinding = stagedBindingsBySlot.has(slot.slotId)
			? stagedBindingsBySlot.get(slot.slotId)
			: slot.binding;
		return (
			!disposed &&
			slot.slotId === token.slotId &&
			slot.operationEpoch === token.slotEpoch &&
			slot.host?.element === token.host &&
			desiredBinding?.snapshot.identity === token.previewIdentity
		);
	}

	function applySlotState(slot: PreviewSlotRuntime): void {
		const host = slot.host;
		if (!host) return;
		const element = host.element;
		const nextState: PreviewHostState = {
			phase: slot.phase,
			contentType: slot.committed?.contentType,
			hasContent: slot.committed?.host === element && !!element.firstChild,
		};
		applyHostState(element, host.appliedState, nextState);
		host.appliedState = nextState;
	}

	function cancelLifecycleCleanup(slot: PreviewSlotRuntime): void {
		if (slot.lifecycleCleanupHandle === undefined) return;
		window.cancelIdleCallback(slot.lifecycleCleanupHandle);
		slot.lifecycleCleanupHandle = undefined;
	}

	function stopRender(slot: PreviewSlotRuntime): void {
		slot.operationEpoch += 1;
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
		const slotEpoch = slot.operationEpoch;
		const host = slot.host?.element;
		const identity = slot.committed?.identity;
		if (!host || !identity) return;

		slot.lifecycleCleanupHandle = window.requestIdleCallback(() => {
			slot.lifecycleCleanupHandle = undefined;
			if (disposed || isInPreviewRange(slot)) return;
			if (slot.operationEpoch !== slotEpoch) return;
			if (slot.host?.element !== host) return;
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
			slot.committed.host === host.element &&
			slot.phase !== "dormant" &&
			slot.phase !== "stale"
		) {
			return;
		}

		const renderer = createRenderer(slot);
		if (!renderer) return;
		cancelLifecycleCleanup(slot);
		stopRender(slot);
		const token: PreviewOperationToken = {
			slotId: slot.slotId,
			slotEpoch: slot.operationEpoch,
			host: host.element,
			previewIdentity: binding.snapshot.identity,
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
						identity: token.previewIdentity,
						contentType,
						retention,
						host: token.host,
					};
					slot.phase = "committed";
					applySlotState(slot);
				},
				onRendered: () => {},
				onError: () => {
					if (!isCurrent(slot, token)) return;
					slot.operationEpoch += 1;
					const cleanup = slot.renderCleanup;
					slot.renderCleanup = undefined;
					cleanup?.();
					const hasCurrentResident =
						slot.committed?.retention === "resident" &&
						slot.committed.host === token.host;
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
				slot.committed.host === slot.host?.element &&
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

	function getDesiredBinding(
		slotId: string,
	): RowPreviewCardBinding | null | undefined {
		if (stagedBindingsBySlot.has(slotId)) {
			return stagedBindingsBySlot.get(slotId);
		}
		return slotsById.get(slotId)?.binding;
	}

	function stageBinding(slotId: string, binding: RowPreviewCardBinding | null): void {
		const previous = getDesiredBinding(slotId);
		if (!previous && !binding) return;

		const identityChanged =
			previous?.snapshot.identity !== binding?.snapshot.identity;
		const rowChanged = previous?.rowIndex !== binding?.rowIndex;
		stagedBindingsBySlot.set(slotId, binding);
		if (!identityChanged && !rowChanged) return;

		const slot = getOrCreateSlot(slotId);
		slot.operationEpoch += 1;
		stagedInvalidatedSlots.add(slotId);
		if (identityChanged) slot.host?.element.classList.add("is-stale");
	}

	function stageBindingDelta(delta: RowPreviewBindingDelta): void {
		for (const slotId of delta.releasedSlots) stageBinding(slotId, null);
		for (const binding of delta.enteredSlots) {
			stageBinding(binding.slotId, binding);
		}
		for (const binding of delta.reboundSlots) {
			stageBinding(binding.slotId, binding);
		}
	}

	function flushStagedSlot(
		slotId: string,
		binding: RowPreviewCardBinding | null,
	): void {
		const slot = getOrCreateSlot(slotId);
		const invalidated = stagedInvalidatedSlots.has(slotId);
		if (invalidated) {
			cancelLifecycleCleanup(slot);
			stopRender(slot);
		}

		if (!binding) {
			slot.binding = undefined;
			slot.bindingIdentity = undefined;
			slot.bindingRowIndex = undefined;
			clearCommittedDom(slot);
			slot.phase = "empty";
			applySlotState(slot);
			return;
		}

		slot.binding = binding;
		slot.bindingIdentity = binding.snapshot.identity;
		slot.bindingRowIndex = binding.rowIndex;
		if (!invalidated) return;
		slot.phase = slot.committed ? "stale" : "empty";
		applySlotState(slot);
	}

	function flushStagedPreviewChanges(): void {
		if (disposed) return;
		const nextBindings = Array.from(stagedBindingsBySlot);
		const nextRange = stagedPreviewRange;
		stagedBindingsBySlot.clear();
		stagedPreviewRange = undefined;

		if (nextRange) previewRange = nextRange;
		for (const [slotId, binding] of nextBindings) {
			flushStagedSlot(slotId, binding);
		}
		stagedInvalidatedSlots.clear();
		reconcile();
	}

	function flushPendingStageSynchronously(): void {
		if (stagedBindingsBySlot.size === 0 && stagedPreviewRange === undefined) {
			return;
		}
		stagedFlushDriver.cancel();
		flushStagedPreviewChanges();
	}

	function registerHost(slotId: string, element: HTMLElement): PreviewHostLease {
		const slot = getOrCreateSlot(slotId);
		if (slot.host?.element !== element) {
			cancelLifecycleCleanup(slot);
			stopRender(slot);
			slot.host = { element };
			slot.committed = undefined;
			slot.phase = "empty";
			applySlotState(slot);
			reconcile();
		}
		const leasedHost = slot.host.element;
		let leaseDisposed = false;
		return {
			dispose(): void {
				if (leaseDisposed) return;
				leaseDisposed = true;
				if (slot.host?.element !== leasedHost) return;
				cancelLifecycleCleanup(slot);
				stopRender(slot);
				slot.host = undefined;
				slot.committed = undefined;
			},
		};
	}

	function syncBindingDelta(delta: RowPreviewBindingDelta): void {
		if (disposed) return;
		flushPendingStageSynchronously();
		applyBindingDelta(delta);
		reconcile();
	}

	function setPreviewWindow(window: RowPreviewWindow): void {
		if (disposed) return;
		flushPendingStageSynchronously();
		previewRange = window.active ? window.previewRange : EMPTY_RANGE;
		reconcile();
	}

	function commitBindingDelta(
		delta: RowPreviewBindingDelta,
		window: RowPreviewWindow,
	): void {
		if (disposed) return;
		const hasBindingChanges =
			delta.enteredSlots.length > 0 ||
			delta.reboundSlots.length > 0 ||
			delta.releasedSlots.length > 0;
		const currentRange = stagedPreviewRange ?? previewRange;
		const nextRange = window.active ? window.previewRange : EMPTY_RANGE;
		const windowChanged =
			nextRange.start !== currentRange.start ||
			nextRange.end !== currentRange.end;
		if (!hasBindingChanges && !windowChanged) return;

		stagedPreviewRange = nextRange;
		stageBindingDelta(delta);
		stagedFlushDriver.schedule({ lane: "post-paint" });
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		stagedFlushDriver.dispose();
		stagedBindingsBySlot.clear();
		stagedInvalidatedSlots.clear();
		stagedPreviewRange = undefined;
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

function applyHostState(
	element: HTMLElement,
	previous: PreviewHostState | undefined,
	next: PreviewHostState,
): void {
	if (previous?.phase !== next.phase) {
		element.dataset.previewState = next.phase;
		element.classList.toggle("is-stale", next.phase === "stale");
	}

	if (!previous || previous.contentType !== next.contentType) {
		if (next.contentType) {
			element.dataset.previewType = next.contentType;
		} else {
			delete element.dataset.previewType;
		}
		for (const type of ["text", "image", "empty", "dom"] as const) {
			element.classList.toggle(
				`cosense-card-links__box-preview--${type}`,
				next.contentType === type,
			);
		}
	}

	if (!previous || previous.hasContent !== next.hasContent) {
		if (next.hasContent) {
			element.dataset.hasPreviewContent = "true";
		} else {
			delete element.dataset.hasPreviewContent;
		}
	}
}
