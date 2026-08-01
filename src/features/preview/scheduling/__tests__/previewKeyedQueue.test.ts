import { describe, expect, it } from "vitest";
import { createPreviewKeyedQueue } from "../previewKeyedQueue";

describe("PreviewKeyedQueue", () => {
	it("coalesces by key while preserving FIFO order for current entries", () => {
		const queue = createPreviewKeyedQueue<number>();

		expect(queue.enqueue("a", 1)).toBeUndefined();
		queue.enqueue("b", 2);
		expect(queue.enqueue("a", 3)).toBe(1);

		expect(queue.dequeue()).toBe(1);
		expect(queue.get("a")).toBe(3);
		expect(queue.dequeue()).toBe(2);
		queue.delete("b", 2);
		expect(queue.dequeue()).toBe(3);
		queue.delete("a", 3);
		expect(queue.size).toBe(0);
	});

	it("does not delete a newer value through an older ownership token", () => {
		const queue = createPreviewKeyedQueue<object>();
		const first = {};
		const second = {};
		queue.enqueue("slot", first);
		queue.enqueue("slot", second);

		expect(queue.delete("slot", first)).toBe(false);
		expect(queue.get("slot")).toBe(second);
	});
});
