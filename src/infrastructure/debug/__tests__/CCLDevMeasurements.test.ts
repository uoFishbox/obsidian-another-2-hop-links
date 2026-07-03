import { afterEach, describe, expect, it } from "vitest";
import {
	getCCLDevMeasurementSnapshot,
	recordCCLDevMeasurement,
	recordCCLDevMeasurementCount,
	resetCCLDevMeasurements,
} from "../CCLDevMeasurements";

describe("CCLDevMeasurements", () => {
	afterEach(() => {
		resetCCLDevMeasurements();
	});

	it("exposes current row slot and CardPreviewGate measurement counters", () => {
		const snapshot = getCCLDevMeasurementSnapshot();
		const counters = snapshot.counters as Record<string, unknown>;

		const expectedCounterNames = [
			"twoHop.rowSlotChanges.apply",
			"twoHop.rowSlotChanges.assignedRows",
			"twoHop.rowSlotChanges.clearedSlots",
			"twoHop.VirtualSurfaceRowSlot.setRow.changed",
			"twoHop.rowSlotCapacity.grow",
			"twoHop.rowSlotCapacity.trim",
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

		for (const name of expectedCounterNames) {
			expect(counters[name]).toBeDefined();
		}
	});

	it("does not expose obsolete fixed slot measurement counters", () => {
		const counters = getCCLDevMeasurementSnapshot().counters as Record<
			string,
			unknown
		>;

		expect(counters["twoHop.fixedSlotPool.syncFromBuild"]).toBeUndefined();
		expect(counters["twoHop.TwoHopFixedCellSlot.update"]).toBeUndefined();
	});

	it("adds measurement counts by amount", () => {
		recordCCLDevMeasurement("twoHop.rowSlotChanges.apply");
		recordCCLDevMeasurementCount("twoHop.rowSlotChanges.assignedRows", 3);
		recordCCLDevMeasurementCount("twoHop.rowSlotChanges.assignedRows", 2);

		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.rowSlotChanges.apply"].count).toBe(1);
		expect(counters["twoHop.rowSlotChanges.assignedRows"].count).toBe(5);
	});
});
