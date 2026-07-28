export type CCLDevMeasurementName =
	| "virtualScroll.applyScrollMeasurement"
	| "virtualScroll.applyScrollMeasurement.scrollCoverageMiss"
	| "virtualScroll.applyScrollMeasurement.scrollIdle"
	| "virtualScroll.applyScrollMeasurement.dataChange"
	| "virtualScroll.applyScrollMeasurement.postLayout"
	| "virtualScroll.applyScrollMeasurement.skippedUnchanged"
	| "virtualScroll.stableBandHit"
	| "virtualScroll.sameMountedWindowHit"
	| "virtualScroll.sameMountedWindowHit.empty"
	| "virtualScroll.sameMountedWindowHit.nonEmpty"
	| "virtualScroll.coverageBand.emptyAbove"
	| "virtualScroll.coverageBand.emptyBelow"
	| "virtualScroll.coverageBand.emptyData"
	| "virtualScroll.coverageBand.invalid"
	| "virtualScroll.rangeMeasurementApplied"
	| "virtualScroll.rangeMeasurementChanged"
	| "virtualScroll.rangeMeasurementReused"
	| "virtualList.observer.scrollEvent"
	| "virtualList.observer.coverageHit"
	| "virtualList.observer.coverageMiss"
	| "virtualList.observer.scrollTask.scheduled"
	| "virtualList.observer.scrollTask.executed"
	| "virtualList.observer.scrollTask.skippedRecoveredCoverage"
	| "virtualList.observer.scrollTask.cancelledRecoveredCoverage"
	| "virtualList.observer.layoutTask.scheduled"
	| "virtualList.observer.dependencyTask.scheduled"
	| "virtualList.scheduler.observerScroll.animationFrame"
	| "virtualList.scheduler.observerLayout.animationFrame"
	| "virtualList.scheduler.dependencyRefresh.animationFrame"
	| "virtualList.scheduler.measurementScroll.animationFrame"
	| "virtualList.scheduler.measurementLayout.animationFrame"
	| "virtualList.scheduler.unstableRetry.animationFrame"
	| "virtualGrid.buildMountedRows"
	| "virtualGrid.contiguousSlotPool.apply"
	| "virtualGrid.residentSlotPool.rangeHit"
	| "virtualGrid.residentSlotPool.changedSlots"
	| "virtualGrid.rowShellCreated"
	| "virtualGrid.cellShellCreated"
	| "virtualGrid.cellShellRebound"
	| "virtualFrame.critical"
	| "virtualFrame.postPaint"
	| "virtualFrame.idle"
	| "twoHop.sectionDescriptorIdentityCache.exactHit"
	| "twoHop.sectionDescriptorIdentityCache.hit"
	| "twoHop.sectionDescriptorIdentityCache.miss"
	| "twoHop.cardRenderModelCache.hit"
	| "twoHop.cardRenderModelCache.miss"
	| "twoHop.cardRenderModelCache.invalidate"
	| "virtualList.scheduler.animationFrame"
	| "virtualList.postPaintScheduler.animationFrame"
	| "virtualScroll.measurementMarker.animationFrame"
	| "preview.activationScheduler.animationFrame"
	| "preview.renderScheduler.animationFrame"
	| "preview.domCommitScheduler.animationFrame"
	| "preview.activationDuringScroll"
	| "preview.domCommitDuringScroll"
	| "component.ViewItemCard.reevaluate"
	| "twoHop.body.mount.item"
	| "twoHop.body.mount.header"
	| "twoHop.body.mount.load-more"
	| "twoHop.body.unmount.item"
	| "twoHop.body.unmount.header"
	| "twoHop.body.unmount.load-more"
	| "twoHop.cardSlotBindings.sync"
	| "twoHop.cardSlotBindings.scannedSlots"
	| "twoHop.cardSlotBindings.changedSlots"
	| "twoHop.preview.entered"
	| "twoHop.preview.rebound"
	| "twoHop.preview.released"
	| "twoHop.preview.stopRender"
	| "twoHop.resolveItemCardModel.call";

export const CCL_DEV_MEASUREMENT_NAMES: readonly CCLDevMeasurementName[] = [
	"virtualScroll.applyScrollMeasurement",
	"virtualScroll.applyScrollMeasurement.scrollCoverageMiss",
	"virtualScroll.applyScrollMeasurement.scrollIdle",
	"virtualScroll.applyScrollMeasurement.dataChange",
	"virtualScroll.applyScrollMeasurement.postLayout",
	"virtualScroll.applyScrollMeasurement.skippedUnchanged",
	"virtualScroll.stableBandHit",
	"virtualScroll.sameMountedWindowHit",
	"virtualScroll.sameMountedWindowHit.empty",
	"virtualScroll.sameMountedWindowHit.nonEmpty",
	"virtualScroll.coverageBand.emptyAbove",
	"virtualScroll.coverageBand.emptyBelow",
	"virtualScroll.coverageBand.emptyData",
	"virtualScroll.coverageBand.invalid",
	"virtualScroll.rangeMeasurementApplied",
	"virtualScroll.rangeMeasurementChanged",
	"virtualScroll.rangeMeasurementReused",
	"virtualList.observer.scrollEvent",
	"virtualList.observer.coverageHit",
	"virtualList.observer.coverageMiss",
	"virtualList.observer.scrollTask.scheduled",
	"virtualList.observer.scrollTask.executed",
	"virtualList.observer.scrollTask.skippedRecoveredCoverage",
	"virtualList.observer.scrollTask.cancelledRecoveredCoverage",
	"virtualList.observer.layoutTask.scheduled",
	"virtualList.observer.dependencyTask.scheduled",
	"virtualList.scheduler.observerScroll.animationFrame",
	"virtualList.scheduler.observerLayout.animationFrame",
	"virtualList.scheduler.dependencyRefresh.animationFrame",
	"virtualList.scheduler.measurementScroll.animationFrame",
	"virtualList.scheduler.measurementLayout.animationFrame",
	"virtualList.scheduler.unstableRetry.animationFrame",
	"virtualGrid.buildMountedRows",
	"virtualGrid.contiguousSlotPool.apply",
	"virtualGrid.residentSlotPool.rangeHit",
	"virtualGrid.residentSlotPool.changedSlots",
	"virtualGrid.rowShellCreated",
	"virtualGrid.cellShellCreated",
	"virtualGrid.cellShellRebound",
	"virtualFrame.critical",
	"virtualFrame.postPaint",
	"virtualFrame.idle",
	"twoHop.sectionDescriptorIdentityCache.exactHit",
	"twoHop.sectionDescriptorIdentityCache.hit",
	"twoHop.sectionDescriptorIdentityCache.miss",
	"twoHop.cardRenderModelCache.hit",
	"twoHop.cardRenderModelCache.miss",
	"twoHop.cardRenderModelCache.invalidate",
	"virtualList.scheduler.animationFrame",
	"virtualList.postPaintScheduler.animationFrame",
	"virtualScroll.measurementMarker.animationFrame",
	"preview.activationScheduler.animationFrame",
	"preview.renderScheduler.animationFrame",
	"preview.domCommitScheduler.animationFrame",
	"preview.activationDuringScroll",
	"preview.domCommitDuringScroll",
	"component.ViewItemCard.reevaluate",
	"twoHop.body.mount.item",
	"twoHop.body.mount.header",
	"twoHop.body.mount.load-more",
	"twoHop.body.unmount.item",
	"twoHop.body.unmount.header",
	"twoHop.body.unmount.load-more",
	"twoHop.cardSlotBindings.sync",
	"twoHop.cardSlotBindings.scannedSlots",
	"twoHop.cardSlotBindings.changedSlots",
	"twoHop.preview.entered",
	"twoHop.preview.rebound",
	"twoHop.preview.released",
	"twoHop.preview.stopRender",
	"twoHop.resolveItemCardModel.call",
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
	if (process.env.NODE_ENV === "production") {
		return;
	}

	const counter = counters.get(name);
	if (!counter) {
		counters.set(name, {
			count: 1,
			lastUpdatedAt: nowIsoString(),
		});
		return;
	}

	counter.count += 1;
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
		enabled: process.env.NODE_ENV !== "production",
		counters: snapshot,
	};
}

export function resetCCLDevMeasurements(): void {
	counters.clear();
}

export function markCCLComponentReevaluation(name: "ViewItemCard"): string {
	recordCCLDevMeasurement(`component.${name}.reevaluate`);
	return "";
}
