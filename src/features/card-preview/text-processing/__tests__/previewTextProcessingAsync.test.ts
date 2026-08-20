import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	getContentSnippetAsync,
	highlightSearchMatchesInHtmlAsync,
} from "../previewTextProcessingAsync";
import { PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH } from "../previewTextWorkerTypes";
import { DEFAULT_SETTINGS } from "features/settings/model";

const state = vi.hoisted(() => ({
	runPreviewTextWorker: vi.fn(),
}));

vi.mock("../previewTextWorkerClient", () => ({
	runPreviewTextWorker: state.runPreviewTextWorker,
}));

describe("preview text processing async wrappers", () => {
	beforeEach(() => {
		state.runPreviewTextWorker.mockReset();
	});

	test("uses synchronous implementation below threshold", async () => {
		const result = await getContentSnippetAsync("Hello [[World]]");

		expect(result).toBe(
			'Hello <span class="cosense-card-links__wikilink">World</span>',
		);
		expect(state.runPreviewTextWorker).not.toHaveBeenCalled();
	});

	test("prepares snippet before deciding whether to use worker", async () => {
		const content = "x".repeat(PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH + 1);

		const result = await getContentSnippetAsync(content, DEFAULT_SETTINGS);

		expect(result.length).toBeLessThan(PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH);
		expect(result.endsWith("...")).toBe(true);
		expect(state.runPreviewTextWorker).not.toHaveBeenCalled();
	});

	test("uses worker when prepared snippet remains above threshold", async () => {
		state.runPreviewTextWorker.mockResolvedValue("worker-result");
		const content = "x".repeat(200000);
		const settings = {
			...DEFAULT_SETTINGS,
			previewMaxChars: 20000,
			previewMaxLines: 0,
		};

		await expect(getContentSnippetAsync(content, settings)).resolves.toBe(
			"worker-result",
		);
		expect(state.runPreviewTextWorker).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "render-prepared-content-snippet",
				prepared: expect.objectContaining({
					contentToProcess: "x".repeat(80000),
				}),
				settings: expect.not.objectContaining({
					language: expect.any(String),
				}),
			}),
			undefined,
		);
	});

	test("falls back to synchronous implementation when worker is unavailable", async () => {
		state.runPreviewTextWorker.mockReturnValue(undefined);
		const content = "Hello [[World]]" + "x".repeat(200000);
		const settings = {
			...DEFAULT_SETTINGS,
			previewMaxChars: 20000,
			previewMaxLines: 0,
		};

		await expect(getContentSnippetAsync(content, settings)).resolves.toContain(
			'Hello <span class="cosense-card-links__wikilink">World</span>',
		);
	});

	test("keeps small search content on the main thread", async () => {
		const result = await getContentSnippetAsync(
			"Hello [[World]] target",
			undefined,
			"target",
		);

		expect(result).toBe(
			'Hello <span class="cosense-card-links__wikilink">World</span> target',
		);
		expect(state.runPreviewTextWorker).not.toHaveBeenCalled();
	});

	test("routes large search content end-to-end through the worker", async () => {
		state.runPreviewTextWorker.mockResolvedValue("worker-result");
		const content = "x".repeat(200000) + " target needle";
		const settings = {
			...DEFAULT_SETTINGS,
			previewMaxChars: 20000,
			previewMaxLines: 0,
		};

		await expect(getContentSnippetAsync(content, settings, "target")).resolves.toBe(
			"worker-result",
		);
		expect(state.runPreviewTextWorker).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "get-content-snippet",
				content,
				searchQuery: "target",
				settings: expect.not.objectContaining({
					language: expect.any(String),
				}),
			}),
			undefined,
		);
	});

	test("does not pre-slice search content before sending it to the worker", async () => {
		state.runPreviewTextWorker.mockResolvedValue("worker-result");
		const content = "x".repeat(50000) + " target";
		const searchOptions = { firstMatchIndex: 50000 };

		await expect(
			getContentSnippetAsync(content, undefined, "target", searchOptions),
		).resolves.toBe("worker-result");
		expect(state.runPreviewTextWorker).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "get-content-snippet",
				content,
				searchOptions,
			}),
			undefined,
		);
	});

	test("falls back to synchronous search snippet when worker is unavailable", async () => {
		state.runPreviewTextWorker.mockReturnValue(undefined);
		const content = "a".repeat(60000) + "\n\n# target note\n[[World]]";
		const settings = {
			...DEFAULT_SETTINGS,
			previewMaxChars: 20000,
			previewMaxLines: 0,
		};

		await expect(
			getContentSnippetAsync(content, settings, "target"),
		).resolves.toContain('<span class="cosense-card-links__wikilink">');
	});

	test("propagates abort errors instead of falling back", async () => {
		const error = new DOMException("aborted", "AbortError");
		state.runPreviewTextWorker.mockRejectedValue(error);
		const content = "x".repeat(PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH + 1);

		await expect(highlightSearchMatchesInHtmlAsync(content, "x")).rejects.toBe(
			error,
		);
	});
});
