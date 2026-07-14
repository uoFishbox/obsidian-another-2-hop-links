export type CCLDevMeasurementName =
	| "virtualScroll.applyScrollMeasurement"
	| "virtualScroll.stableBandHit"
	| "virtualScroll.previewOnlyCrossing"
	| "virtualGrid.buildMountedRows"
	| "virtualGrid.contiguousSlotPool.apply"
	| "virtualGrid.rowShellCreated"
	| "virtualGrid.cellShellCreated"
	| "virtualGrid.cellShellRebound"
	| "twoHop.rowWindow.apply"
	| "twoHop.rowWindow.apply.changed"
	| "twoHop.buildMountedRows"
	| "twoHop.reboundRowSlot"
	| "twoHop.reboundCellSlot"
	| "twoHop.scalarKernel.mountedRangeCommit"
	| "twoHop.scalarKernel.rowShellCreated"
	| "twoHop.scalarKernel.cellShellCreated"
	| "twoHop.plan.compile"
	| "twoHop.physicalPool.resize"
	| "twoHop.binding.commit"
	| "twoHop.itemBody.mount"
	| "twoHop.interactionDescriptorCache.hit"
	| "twoHop.interactionDescriptorCache.miss"
	| "twoHop.interactionDescriptorCache.invalidate"
	| "twoHop.compiledPlanCache.hit"
	| "twoHop.compiledPlanCache.miss"
	| "twoHop.compiledPlanCache.invalidate"
	| "twoHop.sectionDescriptorIdentityCache.hit"
	| "twoHop.sectionDescriptorIdentityCache.miss"
	| "twoHop.sectionDescriptorIdentityCache.invalidate"
	| "twoHop.rowModelCache.hit"
	| "twoHop.rowModelCache.miss"
	| "twoHop.rowModelCache.miss.firstResolve"
	| "twoHop.rowModelCache.miss.sections"
	| "twoHop.rowModelCache.miss.visibleCounts"
	| "twoHop.rowModelCache.miss.visibleCountsSemanticallySame"
	| "twoHop.rowModelCache.miss.layout"
	| "twoHop.rowModelCache.miss.layoutSemanticallySame"
	| "component.TwoHopVirtualItemCard.reevaluate"
	| "component.ViewItemCard.reevaluate"
	| "component.CardPreviewGate.reevaluate";

export const CCL_DEV_MEASUREMENT_NAMES: readonly CCLDevMeasurementName[] = [
	"virtualScroll.applyScrollMeasurement",
	"virtualScroll.stableBandHit",
	"virtualScroll.previewOnlyCrossing",
	"virtualGrid.buildMountedRows",
	"virtualGrid.contiguousSlotPool.apply",
	"virtualGrid.rowShellCreated",
	"virtualGrid.cellShellCreated",
	"virtualGrid.cellShellRebound",
	"twoHop.rowWindow.apply",
	"twoHop.rowWindow.apply.changed",
	"twoHop.buildMountedRows",
	"twoHop.reboundRowSlot",
	"twoHop.reboundCellSlot",
	"twoHop.scalarKernel.mountedRangeCommit",
	"twoHop.scalarKernel.rowShellCreated",
	"twoHop.scalarKernel.cellShellCreated",
	"twoHop.plan.compile",
	"twoHop.physicalPool.resize",
	"twoHop.binding.commit",
	"twoHop.itemBody.mount",
	"twoHop.interactionDescriptorCache.hit",
	"twoHop.interactionDescriptorCache.miss",
	"twoHop.interactionDescriptorCache.invalidate",
	"twoHop.compiledPlanCache.hit",
	"twoHop.compiledPlanCache.miss",
	"twoHop.compiledPlanCache.invalidate",
	"twoHop.sectionDescriptorIdentityCache.hit",
	"twoHop.sectionDescriptorIdentityCache.miss",
	"twoHop.sectionDescriptorIdentityCache.invalidate",
	"twoHop.rowModelCache.hit",
	"twoHop.rowModelCache.miss",
	"twoHop.rowModelCache.miss.firstResolve",
	"twoHop.rowModelCache.miss.sections",
	"twoHop.rowModelCache.miss.visibleCounts",
	"twoHop.rowModelCache.miss.visibleCountsSemanticallySame",
	"twoHop.rowModelCache.miss.layout",
	"twoHop.rowModelCache.miss.layoutSemanticallySame",
	"component.TwoHopVirtualItemCard.reevaluate",
	"component.ViewItemCard.reevaluate",
	"component.CardPreviewGate.reevaluate",
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

export function markCCLComponentReevaluation(
	name: "TwoHopVirtualItemCard" | "ViewItemCard" | "CardPreviewGate",
): string {
	recordCCLDevMeasurement(`component.${name}.reevaluate`);
	return "";
}
