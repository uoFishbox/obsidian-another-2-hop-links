import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleAfterAnimationFrames } from "../frame";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("scheduleAfterAnimationFrames", () => {
	it("runs only after the requested number of frames", () => {
		const frames: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frames.push(callback);
			return frames.length;
		});
		const callback = vi.fn();

		scheduleAfterAnimationFrames(window, 2, callback);
		expect(frames).toHaveLength(1);

		frames[0](0);
		expect(callback).not.toHaveBeenCalled();
		expect(frames).toHaveLength(2);

		frames[1](16);
		expect(callback).toHaveBeenCalledOnce();
	});

	it("cancels the currently pending frame", () => {
		const frames: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frames.push(callback);
			return frames.length;
		});
		const cancelAnimationFrame = vi
			.spyOn(window, "cancelAnimationFrame")
			.mockImplementation(() => {});
		const callback = vi.fn();
		const task = scheduleAfterAnimationFrames(window, 2, callback);

		frames[0](0);
		task.cancel();
		frames[1](16);

		expect(cancelAnimationFrame).toHaveBeenCalledWith(2);
		expect(callback).not.toHaveBeenCalled();
	});
});
