import { describe, expect, it, vi } from "vitest";
import { createTwoHopPreviewWindowController } from "features/two-hop/ui/twoHopPreviewWindowController";

describe("createTwoHopPreviewWindowController", () => {
	it("notifies only rows entering or leaving an overlapping resident range", () => {
		const onChanged = vi.fn();
		const controller = createTwoHopPreviewWindowController(onChanged);
		const consumers = Array.from({ length: 8 }, () => vi.fn());

		for (const [rowIndex, consumer] of consumers.entries()) {
			controller.registerRow(rowIndex, consumer);
			consumer.mockClear();
		}

		controller.apply({ start: 2, end: 5 }, { start: 2, end: 5 });
		for (const consumer of consumers) consumer.mockClear();

		controller.apply({ start: 3, end: 6 }, { start: 3, end: 6 });

		expect(consumers[2]).toHaveBeenCalledExactlyOnceWith(false);
		expect(consumers[5]).toHaveBeenCalledExactlyOnceWith(true);
		for (const rowIndex of [0, 1, 3, 4, 6, 7]) {
			expect(consumers[rowIndex]).not.toHaveBeenCalled();
		}
		expect(onChanged).toHaveBeenCalledTimes(2);
	});

	it("notifies both bounded ranges when the resident window jumps", () => {
		const controller = createTwoHopPreviewWindowController(vi.fn());
		const consumers = new Map<number, ReturnType<typeof vi.fn>>();

		for (const rowIndex of [1, 2, 1000, 1001]) {
			const consumer = vi.fn();
			consumers.set(rowIndex, consumer);
			controller.registerRow(rowIndex, consumer);
			consumer.mockClear();
		}

		controller.apply({ start: 1, end: 3 }, { start: 1, end: 3 });
		for (const consumer of consumers.values()) consumer.mockClear();

		controller.apply({ start: 1000, end: 1002 }, { start: 1000, end: 1002 });

		expect(consumers.get(1)).toHaveBeenCalledExactlyOnceWith(false);
		expect(consumers.get(2)).toHaveBeenCalledExactlyOnceWith(false);
		expect(consumers.get(1000)).toHaveBeenCalledExactlyOnceWith(true);
		expect(consumers.get(1001)).toHaveBeenCalledExactlyOnceWith(true);
	});

	it("does not republish residents when only the active range changes", () => {
		const onChanged = vi.fn();
		const controller = createTwoHopPreviewWindowController(onChanged);
		const consumer = vi.fn();
		controller.registerRow(4, consumer);
		controller.apply({ start: 4, end: 5 }, { start: 4, end: 5 });
		consumer.mockClear();

		controller.apply({ start: 5, end: 6 }, { start: 4, end: 5 });

		expect(consumer).not.toHaveBeenCalled();
		expect(onChanged).toHaveBeenCalledTimes(2);
	});
});
