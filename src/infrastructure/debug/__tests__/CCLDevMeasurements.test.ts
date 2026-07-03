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

		expect(counters["twoHop.rowSlotChanges.apply"]).toBeDefined();
		expect(counters["twoHop.rowSlotChanges.assignedRows"]).toBeDefined();
		expect(counters["twoHop.rowSlotChanges.clearedSlots"]).toBeDefined();
		expect(counters["twoHop.VirtualSurfaceRowSlot.setRow.changed"]).toBeDefined();
		expect(counters["twoHop.rowSlotCapacity.grow"]).toBeDefined();
		expect(counters["twoHop.rowSlotCapacity.trim"]).toBeDefined();
		expect(counters["CardPreviewGate.resetPreviewActivation"]).toBeDefined();
		expect(counters["CardPreviewGate.subscribeActivationVersion"]).toBeDefined();
		expect(counters["CardPreviewGate.requestVisibleActivation"]).toBeDefined();
		expect(counters["CardPreviewGate.activateVisibleVirtualPreview"]).toBeDefined();
		expect(counters["CardPreviewGate.commitVisibleActivation"]).toBeDefined();
		expect(
			counters["CardPreviewGate.renderedPreviewSnapshot.commit"],
		).toBeDefined();
		expect(counters["CardPreviewGate.shouldRenderPreview.true"]).toBeDefined();
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
