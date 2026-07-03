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
	| "CardPreviewGate.subscribeActivationVersion"
	| "CardPreviewGate.requestVisibleActivation"
	| "CardPreviewGate.requestVisibleActivation.sent"
	| "CardPreviewGate.requestVisibleActivation.skipAlreadyActivated"
	| "CardPreviewGate.requestVisibleActivation.skipAlreadyRequested"
	| "CardPreviewGate.requestVisibleActivation.skipNotVisible"
	| "CardPreviewGate.requestVisibleActivation.skipMissingFile"
	| "CardPreviewGate.activateVisibleVirtualPreview"
	| "CardPreviewGate.commitVisibleActivation"
	| "CardPreviewGate.commitVisibleActivation.committed"
	| "CardPreviewGate.commitVisibleActivation.skipAlreadyHandled"
	| "CardPreviewGate.commitVisibleActivation.skipAlreadyActivated"
	| "CardPreviewGate.commitVisibleActivation.skipNotVisible"
	| "CardPreviewGate.renderedPreviewSnapshot.commit"
	| "CardPreviewGate.shouldRenderPreview.true"
	| "RowPreviewActivationRuntime.enqueueActivation"
	| "RowPreviewActivationRuntime.enqueueActivation.dedupedPending"
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
	"CardPreviewGate.subscribeActivationVersion",
	"CardPreviewGate.requestVisibleActivation",
	"CardPreviewGate.requestVisibleActivation.sent",
	"CardPreviewGate.requestVisibleActivation.skipAlreadyActivated",
	"CardPreviewGate.requestVisibleActivation.skipAlreadyRequested",
	"CardPreviewGate.requestVisibleActivation.skipNotVisible",
	"CardPreviewGate.requestVisibleActivation.skipMissingFile",
	"CardPreviewGate.activateVisibleVirtualPreview",
	"CardPreviewGate.commitVisibleActivation",
	"CardPreviewGate.commitVisibleActivation.committed",
	"CardPreviewGate.commitVisibleActivation.skipAlreadyHandled",
	"CardPreviewGate.commitVisibleActivation.skipAlreadyActivated",
	"CardPreviewGate.commitVisibleActivation.skipNotVisible",
	"CardPreviewGate.renderedPreviewSnapshot.commit",
	"CardPreviewGate.shouldRenderPreview.true",
	"RowPreviewActivationRuntime.enqueueActivation",
	"RowPreviewActivationRuntime.enqueueActivation.dedupedPending",
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
