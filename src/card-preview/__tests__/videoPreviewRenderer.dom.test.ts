import { afterEach, describe, expect, test, vi } from "vitest";
import type { TFile } from "obsidian";
import {
	clearVideoPreviewQueue,
	generateVideoPreview,
} from "../renderers/videoPreviewRenderer";

afterEach(() => {
	clearVideoPreviewQueue();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("generateVideoPreview scheduling", () => {
	test("settles an aborted preview while its idle callback is still pending", async () => {
		vi.useFakeTimers();
		const idleCallback = vi
			.spyOn(window, "requestIdleCallback")
			.mockImplementation(() => 41);
		const cancelIdleCallback = vi.spyOn(window, "cancelIdleCallback");
		const controller = new AbortController();
		const file = {
			path: "slow.mp4",
			vault: { getResourcePath: vi.fn(() => "app://slow.mp4") },
		} as unknown as TFile;

		const preview = generateVideoPreview(file, controller.signal, document);
		expect(idleCallback).toHaveBeenCalledWith(expect.any(Function), {
			timeout: 150,
		});

		controller.abort();

		await expect(preview).resolves.toBeUndefined();
		expect(cancelIdleCallback).toHaveBeenCalledWith(41);
	});
});
