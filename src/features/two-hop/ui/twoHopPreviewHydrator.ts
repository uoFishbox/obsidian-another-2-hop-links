import { Component, type App, type TFile } from "obsidian";
import type { PreviewData, PreviewRequestOptions } from "features/preview/public-types";
import type {
	TwoHopDomRowSlot,
	TwoHopCardShellSlot,
} from "features/two-hop/ui/twoHopDomPool";
import { processPreviewContent } from "features/preview/renderers/markdownPreviewRenderer";
import { toPreviewImageSrc } from "features/preview/renderers/externalImageSource";
import { highlightSearchMatchesInHtml } from "features/preview/text-processing/searchHighlighter";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";

export type TwoHopPreviewLane = "visible-idle" | "scroll-opportunistic";

export interface TwoHopPreviewHydratorStats {
	readonly requested: number;
	readonly committed: number;
	readonly staleCompletions: number;
	readonly opportunisticActivations: number;
}

export interface TwoHopPreviewHydrator {
	notifyViewport(
		visibleStart: number,
		visibleEnd: number,
		scrollActive: boolean,
		velocityRowsPerMs: number,
		criticalWorkPending: boolean,
	): void;
	notifyShellsChanged(): void;
	setActive(active: boolean): void;
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
	const now =
		params.now ?? (() => ownerWindow?.performance.now() ?? performance.now());
	const setTimer =
		params.setTimer ??
		((callback: () => void, delayMs: number) =>
			ownerWindow?.setTimeout(callback, delayMs) ?? 0);
	const clearTimer =
		params.clearTimer ?? ((handle: number) => ownerWindow?.clearTimeout(handle));
	const idleDelayMs = params.idleDelayMs ?? 90;
	const opportunisticIntervalMs = params.opportunisticIntervalMs ?? 160;
	const opportunisticVelocityLimit = params.opportunisticVelocityLimit ?? 0.012;
	let visibleStart = 0;
	let visibleEnd = 0;
	let idleTimer = 0;
	let idleDeadline = 0;
	let disposed = false;
	let active = true;
	let lastOpportunisticActivationAt = Number.NEGATIVE_INFINITY;
	let stats = {
		requested: 0,
		committed: 0,
		staleCompletions: 0,
		opportunisticActivations: 0,
	};

	function notifyViewport(
		nextVisibleStart: number,
		nextVisibleEnd: number,
		scrollActive: boolean,
		velocityRowsPerMs: number,
		criticalWorkPending: boolean,
	): void {
		visibleStart = nextVisibleStart;
		visibleEnd = nextVisibleEnd;
		if (!active) return;
		scheduleIdle();
		if (
			!scrollActive ||
			criticalWorkPending ||
			Math.abs(velocityRowsPerMs) > opportunisticVelocityLimit ||
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
		if (!active) return;
		scheduleIdle();
	}

	function setActive(nextActive: boolean): void {
		if (disposed || active === nextActive) return;
		active = nextActive;
		if (active) {
			scheduleIdle();
			return;
		}

		if (idleTimer) {
			clearTimer(idleTimer);
			idleTimer = 0;
		}
		for (const row of params.getRows()) {
			for (const slot of row.cells) {
				if (slot.previewStatus !== "loading") continue;
				slot.abortPreviewRequest?.();
				slot.abortPreviewRequest = null;
				slot.previewStatus = "empty";
			}
		}
	}

	function scheduleIdle(): void {
		if (disposed || !active) return;
		idleDeadline = now() + idleDelayMs;
		if (idleTimer) return;
		idleTimer = setTimer(handleIdleTimer, idleDelayMs);
	}

	function handleIdleTimer(): void {
		if (disposed || !active) {
			idleTimer = 0;
			return;
		}
		const remaining = idleDeadline - now();
		if (remaining > 0) {
			idleTimer = setTimer(handleIdleTimer, remaining);
			return;
		}

		idleTimer = 0;
		drainIdleLane();
	}

	function drainIdleLane(): void {
		if (disposed || !active) return;
		if (hydrateNext("visible-idle")) {
			idleTimer = setTimer(handleIdleTimer, 0);
		}
	}

	function hydrateNext(lane: TwoHopPreviewLane): boolean {
		if (disposed || !active) return false;
		const slot = findBestCandidate(params.getRows(), visibleStart, visibleEnd);
		if (!slot?.cardModel?.targetFile) return false;
		void hydrateSlot(slot, slot.cardModel.targetFile);
		return true;
	}

	async function hydrateSlot(slot: TwoHopCardShellSlot, file: TFile): Promise<void> {
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
			const sourcePreview = model?.contentPreview
				? ({ type: "text", content: model.contentPreview } as const)
				: await params.getPreview(file, abortController.signal, {
						cacheRevision:
							model?.previewCacheRevision ?? model?.previewRefreshToken,
					});
			const preview = applyPreviewSearchHighlight(sourcePreview, model);
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
			if (
				slot.generation === generation &&
				slot.abortPreviewRequest === abortRequest
			) {
				slot.previewStatus = "empty";
				slot.abortPreviewRequest = null;
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
			active &&
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
		setActive,
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

function applyPreviewSearchHighlight(
	preview: PreviewData,
	model: CardRenderModel | null,
): PreviewData {
	if (
		preview.type !== "text" ||
		model?.searchScope !== "title-and-content" ||
		!model.searchQuery.trim()
	) {
		return preview;
	}

	return {
		...preview,
		content: highlightSearchMatchesInHtml(preview.content, model.searchQuery),
	};
}

function resolveOwnerWindow(rows: readonly TwoHopDomRowSlot[]): Window | null {
	return rows[0]?.root.ownerDocument.defaultView ?? null;
}
