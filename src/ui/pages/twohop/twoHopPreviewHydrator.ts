import { Component, type App, type TFile } from "obsidian";
import type { PreviewData, PreviewRequestOptions } from "features/preview/public-types";
import type { TwoHopDomRowSlot, TwoHopCardShellSlot } from "./twoHopDomPool";
import { processPreviewContent } from "features/preview/renderers/markdownPreviewRenderer";
import { toPreviewImageSrc } from "features/preview/utils/externalFileImage";

export type TwoHopPreviewLane = "visible-idle" | "scroll-opportunistic";

export interface TwoHopPreviewHydratorStats {
	readonly requested: number;
	readonly committed: number;
	readonly staleCompletions: number;
	readonly opportunisticActivations: number;
}

export interface TwoHopPreviewHydrator {
	notifyViewport(params: {
		readonly visibleStart: number;
		readonly visibleEnd: number;
		readonly scrollActive: boolean;
		readonly velocityRowsPerMs: number;
		readonly criticalWorkPending: boolean;
	}): void;
	notifyShellsChanged(): void;
	hydrateNext(lane: TwoHopPreviewLane): boolean;
	getStats(): TwoHopPreviewHydratorStats;
	dispose(): void;
}

export interface CreateTwoHopPreviewHydratorParams {
	readonly getRows: () => readonly TwoHopDomRowSlot[];
	readonly getPreview: (
		file: TFile,
		signal?: AbortSignal,
		options?: PreviewRequestOptions,
	) => Promise<PreviewData>;
	readonly now?: () => number;
	readonly setTimer?: (callback: () => void, delayMs: number) => number;
	readonly clearTimer?: (handle: number) => void;
	readonly idleDelayMs?: number;
	readonly opportunisticIntervalMs?: number;
	readonly opportunisticVelocityLimit?: number;
	readonly app?: App;
	readonly sourcePath?: string;
}

/** Schedules preview work by scanning physical slots; no candidate Map/Set is built. */
export function createTwoHopPreviewHydrator(
	params: CreateTwoHopPreviewHydratorParams,
): TwoHopPreviewHydrator {
	const ownerWindow = resolveOwnerWindow(params.getRows());
	const now = params.now ?? (() => ownerWindow?.performance.now() ?? performance.now());
	const setTimer =
		params.setTimer ??
		((callback: () => void, delayMs: number) =>
			ownerWindow?.setTimeout(callback, delayMs) ?? 0);
	const clearTimer =
		params.clearTimer ?? ((handle: number) => ownerWindow?.clearTimeout(handle));
	const idleDelayMs = params.idleDelayMs ?? 140;
	const opportunisticIntervalMs = params.opportunisticIntervalMs ?? 160;
	const opportunisticVelocityLimit =
		params.opportunisticVelocityLimit ?? 0.012;
	let visibleStart = 0;
	let visibleEnd = 0;
	let idleTimer = 0;
	let disposed = false;
	let lastOpportunisticActivationAt = Number.NEGATIVE_INFINITY;
	let stats = {
		requested: 0,
		committed: 0,
		staleCompletions: 0,
		opportunisticActivations: 0,
	};

	function notifyViewport(viewport: {
		readonly visibleStart: number;
		readonly visibleEnd: number;
		readonly scrollActive: boolean;
		readonly velocityRowsPerMs: number;
		readonly criticalWorkPending: boolean;
	}): void {
		visibleStart = viewport.visibleStart;
		visibleEnd = viewport.visibleEnd;
		scheduleIdle();
		if (
			!viewport.scrollActive ||
			viewport.criticalWorkPending ||
			Math.abs(viewport.velocityRowsPerMs) > opportunisticVelocityLimit ||
			now() - lastOpportunisticActivationAt < opportunisticIntervalMs
		) {
			return;
		}

		if (hydrateNext("scroll-opportunistic")) {
			lastOpportunisticActivationAt = now();
			stats.opportunisticActivations += 1;
		}
	}

	function notifyShellsChanged(): void {
		scheduleIdle();
	}

	function scheduleIdle(): void {
		if (disposed) return;
		if (idleTimer) clearTimer(idleTimer);
		idleTimer = setTimer(() => {
			idleTimer = 0;
			drainIdleLane();
		}, idleDelayMs);
	}

	function drainIdleLane(): void {
		if (disposed) return;
		if (hydrateNext("visible-idle")) {
			idleTimer = setTimer(() => {
				idleTimer = 0;
				drainIdleLane();
			}, 0);
		}
	}

	function hydrateNext(lane: TwoHopPreviewLane): boolean {
		if (disposed) return false;
		const slot = findBestCandidate(params.getRows(), visibleStart, visibleEnd);
		if (!slot?.cardModel?.targetFile) return false;
		void hydrateSlot(slot, slot.cardModel.targetFile);
		return true;
	}

	async function hydrateSlot(
		slot: TwoHopCardShellSlot,
		file: TFile,
	): Promise<void> {
		const generation = slot.generation;
		const identity = slot.cardModel?.previewActivationIdentity ?? file.path;
		const abortController = new AbortController();
		const abortRequest = () => abortController.abort();
		slot.abortPreviewRequest?.();
		slot.previewStatus = "loading";
		slot.abortPreviewRequest = abortRequest;
		stats.requested += 1;

		try {
			const model = slot.cardModel;
			const preview = model?.contentPreview
				? ({ type: "text", content: model.contentPreview } as const)
				: await params.getPreview(file, abortController.signal, {
						cacheRevision:
							model?.previewCacheRevision ?? model?.previewRefreshToken,
					});
			if (!isCurrent(slot, generation, identity)) {
				stats.staleCompletions += 1;
				return;
			}
			const disposeRendered = await commitPreview(
				slot.previewHost,
				preview,
				abortController.signal,
				params.app,
				params.sourcePath ?? file.path,
				() => isCurrent(slot, generation, identity),
			);
			if (!isCurrent(slot, generation, identity)) {
				disposeRendered?.();
				stats.staleCompletions += 1;
				return;
			}
			slot.disposePreview?.();
			slot.previewStatus = "ready";
			slot.disposePreview = disposeRendered ?? null;
			slot.abortPreviewRequest = null;
			stats.committed += 1;
		} catch (error) {
			if (!abortController.signal.aborted) {
				console.error("Failed to hydrate two-hop card preview:", error);
			}
			if (slot.generation === generation) {
				slot.previewStatus = "empty";
				if (slot.abortPreviewRequest === abortRequest) {
					slot.abortPreviewRequest = null;
				}
			}
		}
	}

	function isCurrent(
		slot: TwoHopCardShellSlot,
		generation: number,
		identity: string,
	): boolean {
		return (
			!disposed &&
			slot.generation === generation &&
			(slot.cardModel?.previewActivationIdentity ??
				slot.cardModel?.targetFile?.path) === identity
		);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		if (idleTimer) clearTimer(idleTimer);
		for (const row of params.getRows()) {
			for (const slot of row.cells) {
				slot.abortPreviewRequest?.();
				slot.abortPreviewRequest = null;
				slot.disposePreview?.();
				slot.disposePreview = null;
				slot.previewStatus = "empty";
			}
		}
	}

	return {
		notifyViewport,
		notifyShellsChanged,
		hydrateNext,
		getStats: () => ({ ...stats }),
		dispose,
	};
}

function findBestCandidate(
	rows: readonly TwoHopDomRowSlot[],
	visibleStart: number,
	visibleEnd: number,
): TwoHopCardShellSlot | null {
	const center = (visibleStart + visibleEnd - 1) / 2;
	let best: TwoHopCardShellSlot | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const row of rows) {
		if (row.logicalRowIndex < visibleStart || row.logicalRowIndex >= visibleEnd) {
			continue;
		}
		const distance = Math.abs(row.logicalRowIndex - center);
		for (const slot of row.cells) {
			if (
				!slot.rich ||
				slot.previewStatus !== "empty" ||
				!slot.cardModel?.targetFile
			) {
				continue;
			}
			if (distance < bestDistance) {
				best = slot;
				bestDistance = distance;
			}
		}
	}
	return best;
}

async function commitPreview(
	host: HTMLElement,
	preview: PreviewData,
	signal: AbortSignal,
	app: App | undefined,
	sourcePath: string,
	canCommit: () => boolean,
): Promise<(() => void) | undefined> {
	if (signal.aborted || !canCommit()) return;
	const ownerDocument = host.ownerDocument;
	const container = ownerDocument.createElement("div");
	container.className = `cosense-card-links__box-preview cosense-card-links__box-preview--${preview.type}`;

	switch (preview.type) {
		case "empty":
			if (!canCommit()) return;
			host.replaceChildren();
			return;
		case "text":
			if (!app) {
				container.innerHTML = preview.content;
				break;
			}
			{
				const component = new Component();
				component.load();
				await processPreviewContent(
					container,
					preview.content,
					app,
					sourcePath,
					component,
					{ signal },
				);
				if (signal.aborted || !canCommit()) {
					component.unload();
					return;
				}
				host.replaceChildren(container);
				return () => component.unload();
			}
		case "image": {
			const image = ownerDocument.createElement("img");
			image.src = toPreviewImageSrc(preview.content);
			image.draggable = false;
			container.append(image);
			break;
		}
		case "dom": {
			const component = new Component();
			component.load();
			await preview.render(container, component, signal);
			if (signal.aborted || !canCommit()) {
				component.unload();
				return;
			}
			host.replaceChildren(container);
			return () => component.unload();
		}
	}

	if (!signal.aborted && canCommit()) host.replaceChildren(container);
	return;
}

function resolveOwnerWindow(
	rows: readonly TwoHopDomRowSlot[],
): Window | null {
	return rows[0]?.root.ownerDocument.defaultView ?? null;
}
