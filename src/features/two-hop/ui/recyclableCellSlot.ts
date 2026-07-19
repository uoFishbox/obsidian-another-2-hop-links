import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import { dispatchVirtualCellWillRebindFromRoot } from "ui/interactions/virtualCellRebind";

export type PreviewStatus = "empty" | "loading" | "ready";

/** Identifies the logical cell represented by a recyclable physical slot. */
export interface SlotBinding {
	readonly logicalIdentity: string | null;
	readonly logicalRowIndex: number;
	readonly logicalColumnIndex: number;
	readonly renderRevision: number;
	readonly forceRefresh?: boolean;
}

/** Repositions an already-rich binding without rebuilding its DOM. */
export interface RetainedRichBinding {
	readonly logicalIdentity: string;
	readonly logicalRowIndex: number;
	readonly logicalColumnIndex: number;
	readonly renderRevision: number;
}

/** State needed while a slot contains only its inexpensive shell. */
export interface ShellModel {
	readonly preservePreview: boolean;
}

/** State installed when the inexpensive shell is promoted to a rich card. */
export interface RichCellModel {
	readonly cardModel: CardRenderModel | null;
}

/** Capability for one enrichment attempt. Tokens become stale on every rebind. */
export interface EnrichmentToken {
	readonly taskKey: string;
	readonly signal: AbortSignal;
	setDispose(dispose: (() => void) | null): void;
}

export interface RecyclableCellSlot {
	readonly logicalRowIndex: number;
	readonly logicalColumnIndex: number;
	readonly logicalIdentity: string | null;
	readonly generation: number;
	readonly renderRevision: number;
	readonly previewStatus: PreviewStatus;
	readonly cardModel: CardRenderModel | null;
	readonly rich: boolean;

	/** Rebinds the slot as a skeleton and invalidates incompatible rich state. */
	bindSkeleton(binding: SlotBinding, shell: ShellModel): void;
	/** Retains rich DOM only when identity and render revision still match. */
	retainRichBinding(binding: RetainedRichBinding): boolean;
	/** Promotes the current skeleton binding to its rich representation. */
	promoteToRich(model: RichCellModel): void;

	beginEnrichment(taskKey: string): EnrichmentToken;
	commitEnrichment(token: EnrichmentToken, content: Node): boolean;
	failEnrichment(token: EnrichmentToken): void;
	/** Cancels and removes preview enrichment without changing the shell binding. */
	clearEnrichment(): void;

	/** Releases transient interaction state while retaining reusable shell state. */
	suspend(): void;
	/** Fully releases the logical binding and all associated resources. */
	unbind(): void;
}

export interface CreateRecyclableCellSlotParams {
	readonly cell: HTMLDivElement;
	readonly root: HTMLDivElement;
	readonly previewHost: HTMLDivElement;
}

interface MutableEnrichmentToken extends EnrichmentToken {
	readonly generation: number;
	readonly abortController: AbortController;
	dispose: (() => void) | null;
}

interface SlotState {
	logicalRowIndex: number;
	logicalColumnIndex: number;
	logicalIdentity: string | null;
	interactionStateReleased: boolean;
	generation: number;
	renderRevision: number;
	previewStatus: PreviewStatus;
	cardModel: CardRenderModel | null;
	disposePreview: (() => void) | null;
	abortPreviewRequest: (() => void) | null;
	rich: boolean;
	activeEnrichment: MutableEnrichmentToken | null;
	retainedPreviewIdentity: string | null;
}

/**
 * Owns every lifecycle transition for one recyclable cell.
 *
 * The mutable struct is intentionally private so renderers and schedulers can
 * inspect state but cannot create partially transitioned slots.
 */
export function createRecyclableCellSlot(
	params: CreateRecyclableCellSlotParams,
): RecyclableCellSlot {
	const state: SlotState = {
		logicalRowIndex: -1,
		logicalColumnIndex: -1,
		logicalIdentity: null,
		interactionStateReleased: true,
		generation: 0,
		renderRevision: 0,
		previewStatus: "empty",
		cardModel: null,
		disposePreview: null,
		abortPreviewRequest: null,
		rich: false,
		activeEnrichment: null,
		retainedPreviewIdentity: null,
	};

	function bindSkeleton(binding: SlotBinding, shell: ShellModel): void {
		const identityChanged = state.logicalIdentity !== binding.logicalIdentity;
		if (identityChanged && !state.interactionStateReleased) {
			releaseInteraction(binding.logicalIdentity);
		}

		if (identityChanged || binding.forceRefresh) {
			cancelEnrichment();
			state.retainedPreviewIdentity = shell.preservePreview
				? resolvePreviewIdentity(state.cardModel)
				: null;
			if (!shell.preservePreview) disposePreview();
			state.logicalIdentity = binding.logicalIdentity;
			state.generation += 1;
			state.previewStatus = "empty";
			state.cardModel = null;
		}

		state.logicalRowIndex = binding.logicalRowIndex;
		state.logicalColumnIndex = binding.logicalColumnIndex;
		state.renderRevision = binding.renderRevision;
		state.interactionStateReleased = binding.logicalIdentity === null;
		state.cardModel = null;
		state.rich = false;
		params.cell.style.visibility = binding.logicalIdentity ? "" : "hidden";
		if (binding.logicalIdentity) {
			params.cell.dataset.cclLogicalKey = binding.logicalIdentity;
		} else {
			delete params.cell.dataset.cclLogicalKey;
		}
	}

	function retainRichBinding(binding: RetainedRichBinding): boolean {
		if (
			!state.rich ||
			state.logicalIdentity !== binding.logicalIdentity ||
			state.renderRevision !== binding.renderRevision
		) {
			return false;
		}

		state.logicalRowIndex = binding.logicalRowIndex;
		state.logicalColumnIndex = binding.logicalColumnIndex;
		state.interactionStateReleased = false;
		params.cell.style.visibility = "";
		params.cell.dataset.cclLogicalKey = binding.logicalIdentity;
		return true;
	}

	function promoteToRich(model: RichCellModel): void {
		if (
			state.retainedPreviewIdentity !== null &&
			resolvePreviewIdentity(model.cardModel) !== state.retainedPreviewIdentity
		) {
			disposePreview();
		}
		state.retainedPreviewIdentity = null;
		state.cardModel = model.cardModel;
		state.rich = true;
		state.interactionStateReleased = false;
	}

	function beginEnrichment(taskKey: string): EnrichmentToken {
		cancelEnrichment();
		const abortController = new AbortController();
		const token: MutableEnrichmentToken = {
			taskKey,
			generation: state.generation,
			abortController,
			signal: abortController.signal,
			dispose: null,
			setDispose(dispose) {
				if (token.dispose === dispose) return;
				disposeSafely(token.dispose);
				token.dispose = dispose;
			},
		};
		state.activeEnrichment = token;
		state.abortPreviewRequest = () => abortController.abort();
		state.previewStatus = "loading";
		return token;
	}

	function commitEnrichment(token: EnrichmentToken, content: Node): boolean {
		const mutableToken = asCurrentToken(token);
		if (!mutableToken) {
			disposeToken(token);
			return false;
		}

		const disposePrevious = state.disposePreview;
		params.previewHost.replaceChildren(content);
		state.disposePreview = mutableToken.dispose;
		mutableToken.dispose = null;
		state.activeEnrichment = null;
		state.abortPreviewRequest = null;
		state.previewStatus = "ready";
		disposeSafely(disposePrevious);
		return true;
	}

	function failEnrichment(token: EnrichmentToken): void {
		const mutableToken = asMutableToken(token);
		if (state.activeEnrichment !== mutableToken) {
			disposeToken(token);
			return;
		}
		const disposePending = mutableToken.dispose;
		mutableToken.dispose = null;
		state.activeEnrichment = null;
		state.abortPreviewRequest = null;
		state.previewStatus = "empty";
		disposeSafely(disposePending);
	}

	function clearEnrichment(): void {
		cancelEnrichment();
		disposePreview();
		state.retainedPreviewIdentity = null;
		state.previewStatus = "empty";
	}

	function unbind(): void {
		if (
			state.logicalIdentity === null &&
			state.logicalRowIndex < 0 &&
			state.activeEnrichment === null &&
			state.disposePreview === null &&
			state.cardModel === null &&
			!state.rich
		) {
			params.cell.style.visibility = "hidden";
			return;
		}
		if (!state.interactionStateReleased) releaseInteraction(null);
		cancelEnrichment();
		disposePreview();
		state.logicalRowIndex = -1;
		state.logicalColumnIndex = -1;
		state.logicalIdentity = null;
		state.interactionStateReleased = true;
		state.generation += 1;
		state.previewStatus = "empty";
		state.cardModel = null;
		state.rich = false;
		state.retainedPreviewIdentity = null;
		params.cell.style.visibility = "hidden";
		delete params.cell.dataset.cclLogicalKey;
	}

	function suspend(): void {
		if (state.interactionStateReleased) return;
		releaseInteraction(null);
	}

	function releaseInteraction(nextLogicalIdentity: string | null): void {
		dispatchVirtualCellWillRebindFromRoot(params.cell, params.root, {
			previousLogicalKey: state.logicalIdentity ?? "",
			nextLogicalKey: nextLogicalIdentity ?? "",
		});
		state.interactionStateReleased = true;
	}

	function cancelEnrichment(): void {
		const token = state.activeEnrichment;
		state.abortPreviewRequest?.();
		state.abortPreviewRequest = null;
		state.activeEnrichment = null;
		if (token) {
			const disposePending = token.dispose;
			token.dispose = null;
			disposeSafely(disposePending);
		}
		if (state.previewStatus === "loading") state.previewStatus = "empty";
	}

	function disposePreview(): void {
		const disposeCurrent = state.disposePreview;
		state.disposePreview = null;
		params.previewHost.replaceChildren();
		if (state.previewStatus === "ready") state.previewStatus = "empty";
		disposeSafely(disposeCurrent);
	}

	function asCurrentToken(token: EnrichmentToken): MutableEnrichmentToken | null {
		const mutableToken = asMutableToken(token);
		if (
			state.activeEnrichment !== mutableToken ||
			mutableToken.generation !== state.generation ||
			mutableToken.signal.aborted
		) {
			return null;
		}
		return mutableToken;
	}

	return {
		get logicalRowIndex() {
			return state.logicalRowIndex;
		},
		get logicalColumnIndex() {
			return state.logicalColumnIndex;
		},
		get logicalIdentity() {
			return state.logicalIdentity;
		},
		get generation() {
			return state.generation;
		},
		get renderRevision() {
			return state.renderRevision;
		},
		get previewStatus() {
			return state.previewStatus;
		},
		get cardModel() {
			return state.cardModel;
		},
		get rich() {
			return state.rich;
		},
		bindSkeleton,
		retainRichBinding,
		promoteToRich,
		beginEnrichment,
		commitEnrichment,
		failEnrichment,
		clearEnrichment,
		suspend,
		unbind,
	};
}

function resolvePreviewIdentity(model: CardRenderModel | null): string | null {
	return model?.previewActivationIdentity ?? model?.targetFile?.path ?? null;
}

function asMutableToken(token: EnrichmentToken): MutableEnrichmentToken {
	return token as MutableEnrichmentToken;
}

function disposeToken(token: EnrichmentToken): void {
	const mutableToken = asMutableToken(token);
	const dispose = mutableToken.dispose;
	mutableToken.dispose = null;
	disposeSafely(dispose);
}

function disposeSafely(dispose: (() => void) | null): void {
	if (!dispose) return;
	try {
		dispose();
	} catch (error) {
		console.error("Failed to dispose recyclable cell preview:", error);
	}
}
