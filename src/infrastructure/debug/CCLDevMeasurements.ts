import { IS_PROD } from "appConstants";

export type CCLDevMeasurementName =
	| "virtualScroll.applyScrollMeasurement"
	| "twoHop.rowWindow.apply"
	| "twoHop.rowWindow.apply.changed"
	| "twoHop.rowWindow.apply.changed.firstBuild"
	| "twoHop.rowWindow.apply.changed.plan"
	| "twoHop.rowWindow.apply.changed.rowRange"
	| "twoHop.rowWindow.apply.changed.cellStoreRevision"
	| "twoHop.rowWindow.apply.skipped"
	| "twoHop.buildMountedRows"
	| "twoHop.rowModelCache.hit"
	| "twoHop.rowModelCache.miss"
	| "twoHop.rowModelCache.miss.firstResolve"
	| "twoHop.rowModelCache.miss.sections"
	| "twoHop.rowModelCache.miss.visibleCounts"
	| "twoHop.rowModelCache.miss.visibleCountsSemanticallySame"
	| "twoHop.rowModelCache.miss.layout"
	| "twoHop.rowModelCache.miss.layoutSemanticallySame"
	| "twoHop.rowSlotChanges.apply"
	| "twoHop.rowSlotChanges.assignedRows"
	| "twoHop.rowSlotChanges.clearedSlots"
	| "twoHop.VirtualSurfaceRowSlot.setRow.changed"
	| "twoHop.rowSlotCapacity.grow"
	| "twoHop.rowSlotCapacity.trim"
	| "component.TwoHopVirtualItemCard.reevaluate"
	| "component.ViewItemCard.reevaluate"
	| "component.CardPreviewGate.reevaluate"
	| "CardPreviewGate.resetPreviewActivation"
	| "CardPreviewGate.resetPreviewActivation.identityChanged"
	| "CardPreviewGate.resetPreviewActivation.clearRenderedSnapshot"
	| "CardPreviewGate.resetPreviewActivation.clearRequested"
	| "CardPreviewGate.subscribeActivationVersion"
	| "CardPreviewGate.requestVisibleActivation"
	| "CardPreviewGate.requestVisibleActivation.sent"
	| "CardPreviewGate.requestVisibleActivation.sentDuringScroll"
	| "CardPreviewGate.requestVisibleActivation.skipNoRuntime"
	| "CardPreviewGate.requestVisibleActivation.skipNoActivationKey"
	| "CardPreviewGate.requestVisibleActivation.skipDomPreviewDisabled"
	| "CardPreviewGate.requestVisibleActivation.skipAlreadyActivated"
	| "CardPreviewGate.requestVisibleActivation.skipAlreadyRequested"
	| "CardPreviewGate.requestVisibleActivation.skipAwaitingInitialRuntimeActivation"
	| "CardPreviewGate.requestVisibleActivation.skipNotVisible"
	| "CardPreviewGate.requestVisibleActivation.skipMissingFile"
	| "CardPreviewGate.activateVisibleVirtualPreview"
	| "CardPreviewGate.commitVisibleActivation"
	| "CardPreviewGate.commitVisibleActivation.committed"
	| "CardPreviewGate.commitVisibleActivation.committedDuringScroll"
	| "CardPreviewGate.commitVisibleActivation.skipAlreadyHandled"
	| "CardPreviewGate.commitVisibleActivation.skipNoRuntime"
	| "CardPreviewGate.commitVisibleActivation.skipNoActivationKey"
	| "CardPreviewGate.commitVisibleActivation.skipNoActivationVersion"
	| "CardPreviewGate.commitVisibleActivation.skipInitialActivationVersion"
	| "CardPreviewGate.commitVisibleActivation.skipDomPreviewDisabled"
	| "CardPreviewGate.commitVisibleActivation.skipAlreadyActivated"
	| "CardPreviewGate.commitVisibleActivation.skipNotVisible"
	| "CardPreviewGate.commitVisibleActivation.skipMissingFile"
	| "CardPreviewGate.renderedPreviewSnapshot.commit"
	| "CardPreviewGate.renderedPreviewSnapshot.commitFromRuntimeActivation"
	| "CardPreviewGate.renderedPreviewSnapshot.commitFromDirectActivation"
	| "CardPreviewGate.renderedPreviewSnapshot.commitDuringScroll"
	| "CardPreviewGate.shouldRenderPreview.true"
	| "CardPreviewGate.shouldRenderPreview.trueDuringScroll"
	| "CardPreview.render.start"
	| "CardPreview.render.startDuringScroll"
	| "CardPreview.render.cacheHit"
	| "CardPreview.render.getPreview"
	| "CardPreview.render.getPreviewDuringScroll"
	| "CardPreview.render.previewOverride"
	| "CardPreview.render.markdown"
	| "CardPreview.render.markdownDuringScroll"
	| "CardPreview.render.dom"
	| "CardPreview.render.image"
	| "CardPreview.render.mathQueued"
	| "CardPreview.render.completed"
	| "CardPreview.render.abortedOrStale"
	| "CardPreview.render.error"
	| "PreviewActivationScheduler.requestQueued"
	| "PreviewActivationScheduler.requestQueued.duringScroll"
	| "PreviewActivationScheduler.drainFrame"
	| "PreviewActivationScheduler.drainFrame.duringScroll"
	| "PreviewActivationScheduler.drainFrame.activated"
	| "PreviewActivationScheduler.drainFrame.activatedDuringScroll"
	| "PreviewActivationScheduler.drainFrame.skipBacklog"
	| "PreviewActivationScheduler.enqueue"
	| "PreviewActivationScheduler.enqueue.duringScroll"
	| "RowPreviewActivationRuntime.enqueueActivation"
	| "RowPreviewActivationRuntime.enqueueActivation.fromSetVisibility"
	| "RowPreviewActivationRuntime.enqueueActivation.fromRequestActivation"
	| "RowPreviewActivationRuntime.enqueueActivation.skipNotVisible"
	| "RowPreviewActivationRuntime.enqueueActivation.dedupedPending"
	| "RowPreviewActivationRuntime.enqueueActivation.dedupedPending.fromSetVisibility"
	| "RowPreviewActivationRuntime.enqueueActivation.dedupedPending.fromRequestActivation"
	| "RowPreviewActivationRuntime.requestActivation"
	| "RowPreviewActivationRuntime.requestActivation.skipNotVisible"
	| "RowPreviewActivationRuntime.setVisibility.visible"
	| "RowPreviewActivationRuntime.setVisibility.visibleUnchanged"
	| "RowPreviewActivationRuntime.setVisibility.mounted"
	| "RowPreviewActivationRuntime.setVisibility.mountedUnchanged"
	| "RowPreviewActivationRuntime.notifyVisibleActivation";

export const CCL_DEV_MEASUREMENT_NAMES: readonly CCLDevMeasurementName[] = [
	"virtualScroll.applyScrollMeasurement",
	"twoHop.rowWindow.apply",
	"twoHop.rowWindow.apply.changed",
	"twoHop.rowWindow.apply.changed.firstBuild",
	"twoHop.rowWindow.apply.changed.plan",
	"twoHop.rowWindow.apply.changed.rowRange",
	"twoHop.rowWindow.apply.changed.cellStoreRevision",
	"twoHop.rowWindow.apply.skipped",
	"twoHop.buildMountedRows",
	"twoHop.rowModelCache.hit",
	"twoHop.rowModelCache.miss",
	"twoHop.rowModelCache.miss.firstResolve",
	"twoHop.rowModelCache.miss.sections",
	"twoHop.rowModelCache.miss.visibleCounts",
	"twoHop.rowModelCache.miss.visibleCountsSemanticallySame",
	"twoHop.rowModelCache.miss.layout",
	"twoHop.rowModelCache.miss.layoutSemanticallySame",
	"twoHop.rowSlotChanges.apply",
	"twoHop.rowSlotChanges.assignedRows",
	"twoHop.rowSlotChanges.clearedSlots",
	"twoHop.VirtualSurfaceRowSlot.setRow.changed",
	"twoHop.rowSlotCapacity.grow",
	"twoHop.rowSlotCapacity.trim",
	"component.TwoHopVirtualItemCard.reevaluate",
	"component.ViewItemCard.reevaluate",
	"component.CardPreviewGate.reevaluate",
	"CardPreviewGate.resetPreviewActivation",
	"CardPreviewGate.resetPreviewActivation.identityChanged",
	"CardPreviewGate.resetPreviewActivation.clearRenderedSnapshot",
	"CardPreviewGate.resetPreviewActivation.clearRequested",
	"CardPreviewGate.subscribeActivationVersion",
	"CardPreviewGate.requestVisibleActivation",
	"CardPreviewGate.requestVisibleActivation.sent",
	"CardPreviewGate.requestVisibleActivation.sentDuringScroll",
	"CardPreviewGate.requestVisibleActivation.skipNoRuntime",
	"CardPreviewGate.requestVisibleActivation.skipNoActivationKey",
	"CardPreviewGate.requestVisibleActivation.skipDomPreviewDisabled",
	"CardPreviewGate.requestVisibleActivation.skipAlreadyActivated",
	"CardPreviewGate.requestVisibleActivation.skipAlreadyRequested",
	"CardPreviewGate.requestVisibleActivation.skipAwaitingInitialRuntimeActivation",
	"CardPreviewGate.requestVisibleActivation.skipNotVisible",
	"CardPreviewGate.requestVisibleActivation.skipMissingFile",
	"CardPreviewGate.activateVisibleVirtualPreview",
	"CardPreviewGate.commitVisibleActivation",
	"CardPreviewGate.commitVisibleActivation.committed",
	"CardPreviewGate.commitVisibleActivation.committedDuringScroll",
	"CardPreviewGate.commitVisibleActivation.skipAlreadyHandled",
	"CardPreviewGate.commitVisibleActivation.skipNoRuntime",
	"CardPreviewGate.commitVisibleActivation.skipNoActivationKey",
	"CardPreviewGate.commitVisibleActivation.skipNoActivationVersion",
	"CardPreviewGate.commitVisibleActivation.skipInitialActivationVersion",
	"CardPreviewGate.commitVisibleActivation.skipDomPreviewDisabled",
	"CardPreviewGate.commitVisibleActivation.skipAlreadyActivated",
	"CardPreviewGate.commitVisibleActivation.skipNotVisible",
	"CardPreviewGate.commitVisibleActivation.skipMissingFile",
	"CardPreviewGate.renderedPreviewSnapshot.commit",
	"CardPreviewGate.renderedPreviewSnapshot.commitFromRuntimeActivation",
	"CardPreviewGate.renderedPreviewSnapshot.commitFromDirectActivation",
	"CardPreviewGate.renderedPreviewSnapshot.commitDuringScroll",
	"CardPreviewGate.shouldRenderPreview.true",
	"CardPreviewGate.shouldRenderPreview.trueDuringScroll",
	"CardPreview.render.start",
	"CardPreview.render.startDuringScroll",
	"CardPreview.render.cacheHit",
	"CardPreview.render.getPreview",
	"CardPreview.render.getPreviewDuringScroll",
	"CardPreview.render.previewOverride",
	"CardPreview.render.markdown",
	"CardPreview.render.markdownDuringScroll",
	"CardPreview.render.dom",
	"CardPreview.render.image",
	"CardPreview.render.mathQueued",
	"CardPreview.render.completed",
	"CardPreview.render.abortedOrStale",
	"CardPreview.render.error",
	"PreviewActivationScheduler.requestQueued",
	"PreviewActivationScheduler.requestQueued.duringScroll",
	"PreviewActivationScheduler.drainFrame",
	"PreviewActivationScheduler.drainFrame.duringScroll",
	"PreviewActivationScheduler.drainFrame.activated",
	"PreviewActivationScheduler.drainFrame.activatedDuringScroll",
	"PreviewActivationScheduler.drainFrame.skipBacklog",
	"PreviewActivationScheduler.enqueue",
	"PreviewActivationScheduler.enqueue.duringScroll",
	"RowPreviewActivationRuntime.enqueueActivation",
	"RowPreviewActivationRuntime.enqueueActivation.fromSetVisibility",
	"RowPreviewActivationRuntime.enqueueActivation.fromRequestActivation",
	"RowPreviewActivationRuntime.enqueueActivation.skipNotVisible",
	"RowPreviewActivationRuntime.enqueueActivation.dedupedPending",
	"RowPreviewActivationRuntime.enqueueActivation.dedupedPending.fromSetVisibility",
	"RowPreviewActivationRuntime.enqueueActivation.dedupedPending.fromRequestActivation",
	"RowPreviewActivationRuntime.requestActivation",
	"RowPreviewActivationRuntime.requestActivation.skipNotVisible",
	"RowPreviewActivationRuntime.setVisibility.visible",
	"RowPreviewActivationRuntime.setVisibility.visibleUnchanged",
	"RowPreviewActivationRuntime.setVisibility.mounted",
	"RowPreviewActivationRuntime.setVisibility.mountedUnchanged",
	"RowPreviewActivationRuntime.notifyVisibleActivation",
];

export interface CCLDevMeasurementCounter {
	readonly count: number;
	readonly lastUpdatedAt: string | null;
}

export interface CCLDevMeasurementSnapshot {
	readonly enabled: boolean;
	readonly counters: Record<CCLDevMeasurementName, CCLDevMeasurementCounter>;
}

const counters = new Map<
	CCLDevMeasurementName,
	{
		count: number;
		lastUpdatedAt: string;
	}
>();

function nowIsoString(): string {
	return new Date().toISOString();
}

export function recordCCLDevMeasurement(name: CCLDevMeasurementName): void {
	recordCCLDevMeasurementCount(name, 1);
}

export function recordCCLDevMeasurementCount(
	name: CCLDevMeasurementName,
	count: number,
): void {
	if (IS_PROD) {
		return;
	}

	if (count <= 0) {
		return;
	}

	const counter = counters.get(name);
	if (!counter) {
		counters.set(name, {
			count,
			lastUpdatedAt: nowIsoString(),
		});
		return;
	}

	counter.count += count;
	counter.lastUpdatedAt = nowIsoString();
}

export function getCCLDevMeasurementSnapshot(): CCLDevMeasurementSnapshot {
	const snapshot = {} as Record<CCLDevMeasurementName, CCLDevMeasurementCounter>;

	for (const name of CCL_DEV_MEASUREMENT_NAMES) {
		const counter = counters.get(name);
		snapshot[name] = {
			count: counter?.count ?? 0,
			lastUpdatedAt: counter?.lastUpdatedAt ?? null,
		};
	}

	return {
		enabled: !IS_PROD,
		counters: snapshot,
	};
}

export function resetCCLDevMeasurements(): void {
	counters.clear();
}

export function markCCLComponentReevaluation(
	name: "TwoHopVirtualItemCard" | "ViewItemCard" | "CardPreviewGate",
): string {
	recordCCLDevMeasurement(`component.${name}.reevaluate`);
	return "";
}
