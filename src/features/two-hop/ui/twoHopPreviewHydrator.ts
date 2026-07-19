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
import type { EnrichmentToken } from "features/two-hop/ui/recyclableCellSlot";
import {
	createEnrichmentScheduler,
	type EnrichmentRunContext,
} from "ui/shared/scheduling/enrichmentScheduler";

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
	readonly maxConcurrent?: number;
	readonly idleDelayMs?: number;
	readonly opportunisticIntervalMs?: number;
	readonly opportunisticVelocityLimit?: number;
	readonly app?: App;
	readonly sourcePath?: string;
}

interface TwoHopPreviewCandidate {
	readonly key: string;
	readonly generationToken: string;
	readonly slot: TwoHopCardShellSlot;
	readonly file: TFile;
	readonly model: CardRenderModel;
	readonly generation: number;
	readonly identity: string;
	readonly priority: number;
	readonly visible: boolean;
	readonly opportunistic: boolean;
}

interface RenderedPreview {
	readonly content: Node;
	readonly dispose: (() => void) | null;
}

/** Adapts resident two-hop card slots to the shared enrichment scheduler. */
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
	const opportunisticVelocityLimit = params.opportunisticVelocityLimit ?? 0.012;
	let visibleStart = 0;
	let visibleEnd = 0;
	let disposed = false;
	let active = true;
	let stats = {
		requested: 0,
		committed: 0,
		staleCompletions: 0,
		opportunisticActivations: 0,
	};
	let opportunisticAllowed = false;
	const activeTokens = new Map<TwoHopCardShellSlot, EnrichmentToken>();
	const scheduler = createEnrichmentScheduler<TwoHopPreviewCandidate>({
		getKey: (candidate) => candidate.key,
		getGenerationToken: (candidate) => candidate.generationToken,
		getPriority: (candidate) => candidate.priority,
		canStart: (candidate, lane) =>
			candidate.visible &&
			(lane === "visible-idle" || candidate.opportunistic) &&
			isCandidateEligible(candidate),
		enrich: hydrateCandidate,
		maxConcurrent: params.maxConcurrent ?? 2,
		idleDelayMs: params.idleDelayMs ?? 90,
		opportunisticIntervalMs: params.opportunisticIntervalMs ?? 160,
		now,
		setTimer,
		clearTimer,
	});

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
		opportunisticAllowed =
			scrollActive &&
			!criticalWorkPending &&
			Math.abs(velocityRowsPerMs) <= opportunisticVelocityLimit;
		scheduler.setCandidates(buildCandidates());
	}

	function notifyShellsChanged(): void {
		if (!active) return;
		opportunisticAllowed = false;
		scheduler.setCandidates(buildCandidates());
	}

	function setActive(nextActive: boolean): void {
		if (disposed || active === nextActive) return;
		active = nextActive;
		if (active) {
			scheduler.setCandidates(buildCandidates());
			scheduler.setActive(true);
			return;
		}

		scheduler.setActive(false);
		failActiveEnrichments();
	}

	function buildCandidates(): TwoHopPreviewCandidate[] {
		const candidates: TwoHopPreviewCandidate[] = [];
		const center = (visibleStart + visibleEnd - 1) / 2;
		for (const row of params.getRows()) {
			const visible =
				row.logicalRowIndex >= visibleStart && row.logicalRowIndex < visibleEnd;
			const priority = Math.abs(row.logicalRowIndex - center);
			for (const slot of row.cells) {
				const model = slot.cardModel;
				const file = model?.targetFile;
				if (!slot.rich || !model || !file || row.logicalRowIndex < 0) continue;
				const identity = model.previewActivationIdentity ?? file.path;
				candidates.push({
					key: String(slot.slotIndex),
					generationToken: `${slot.generation}\u0000${identity}`,
					slot,
					file,
					model,
					generation: slot.generation,
					identity,
					priority,
					visible,
					opportunistic: opportunisticAllowed,
				});
			}
		}
		return candidates;
	}

	function isCandidateEligible(candidate: TwoHopPreviewCandidate): boolean {
		return candidate.slot.previewStatus === "empty" && isSlotCurrent(candidate);
	}

	async function hydrateCandidate(
		candidate: TwoHopPreviewCandidate,
		context: EnrichmentRunContext,
	): Promise<void> {
		const { slot, file, model, key } = candidate;
		const invalidationKeys = new Set([key]);
		const token = slot.beginEnrichment(candidate.generationToken);
		activeTokens.set(slot, token);
		token.signal.addEventListener(
			"abort",
			() => scheduler.invalidateKeys(invalidationKeys),
			{ once: true },
		);
		stats.requested += 1;
		if (context.lane === "scroll-opportunistic") {
			stats.opportunisticActivations += 1;
		}

		try {
			const sourcePreview = model.contentPreview
				? ({ type: "text", content: model.contentPreview } as const)
				: await params.getPreview(file, context.signal, {
						cacheRevision:
							model.previewCacheRevision ?? model.previewRefreshToken,
					});
			const preview = applyPreviewSearchHighlight(sourcePreview, model);
			if (!isCurrent(candidate, context)) {
				stats.staleCompletions += 1;
				return;
			}
			const rendered = await renderPreview(
				slot.previewHost.ownerDocument,
				preview,
				context.signal,
				params.app,
				params.sourcePath ?? file.path,
				() => isCurrent(candidate, context),
			);
			if (!rendered || !isCurrent(candidate, context) || token.signal.aborted) {
				rendered?.dispose?.();
				stats.staleCompletions += 1;
				return;
			}
			token.setDispose(rendered.dispose);
			if (slot.commitEnrichment(token, rendered.content)) {
				stats.committed += 1;
			} else {
				stats.staleCompletions += 1;
			}
		} catch (error) {
			if (!context.signal.aborted) {
				console.error("Failed to hydrate two-hop card preview:", error);
			}
		} finally {
			slot.failEnrichment(token);
			if (activeTokens.get(slot) === token) activeTokens.delete(slot);
		}
	}

	function isCurrent(
		candidate: TwoHopPreviewCandidate,
		context: EnrichmentRunContext,
	): boolean {
		return !disposed && active && context.isCurrent() && isSlotCurrent(candidate);
	}

	function isSlotCurrent(candidate: TwoHopPreviewCandidate): boolean {
		return (
			candidate.slot.generation === candidate.generation &&
			(candidate.slot.cardModel?.previewActivationIdentity ??
				candidate.slot.cardModel?.targetFile?.path) === candidate.identity
		);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		scheduler.dispose();
		failActiveEnrichments();
		for (const row of params.getRows()) {
			for (const slot of row.cells) slot.clearEnrichment();
		}
	}

	function failActiveEnrichments(): void {
		for (const [slot, token] of activeTokens) {
			slot.failEnrichment(token);
		}
		activeTokens.clear();
	}

	return {
		notifyViewport,
		notifyShellsChanged,
		setActive,
		getStats: () => ({ ...stats }),
		dispose,
	};
}

async function renderPreview(
	ownerDocument: Document,
	preview: PreviewData,
	signal: AbortSignal,
	app: App | undefined,
	sourcePath: string,
	canCommit: () => boolean,
): Promise<RenderedPreview | null> {
	if (signal.aborted || !canCommit()) return null;
	const container = ownerDocument.createElement("div");
	container.className = `cosense-card-links__box-preview cosense-card-links__box-preview--${preview.type}`;

	switch (preview.type) {
		case "empty":
			if (!canCommit()) return null;
			return {
				content: ownerDocument.createDocumentFragment(),
				dispose: null,
			};
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
					return null;
				}
				return {
					content: container,
					dispose: () => component.unload(),
				};
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
				return null;
			}
			return {
				content: container,
				dispose: () => component.unload(),
			};
		}
	}

	if (signal.aborted || !canCommit()) return null;
	return { content: container, dispose: null };
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
