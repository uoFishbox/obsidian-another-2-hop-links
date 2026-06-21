import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	findFirstAllowedFencedCodeBlockAsync,
	getContentSnippetAsync,
	highlightSearchMatchesInHtmlAsync,
} from "../previewTextProcessingAsync";
import {
	PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH,
} from "../previewTextWorkerTypes";

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

	test("uses worker above threshold", async () => {
		state.runPreviewTextWorker.mockResolvedValue("worker-result");
		const content = "x".repeat(PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH + 1);

		await expect(getContentSnippetAsync(content)).resolves.toBe(
			"worker-result",
		);
		expect(state.runPreviewTextWorker).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "get-content-snippet",
				content,
			}),
			undefined,
		);
	});

	test("falls back to synchronous implementation when worker is unavailable", async () => {
		state.runPreviewTextWorker.mockReturnValue(undefined);
		const content =
			"Hello [[World]]" +
			"x".repeat(PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH + 1);

		await expect(getContentSnippetAsync(content)).resolves.toContain(
			'Hello <span class="cosense-card-links__wikilink">World</span>',
		);
	});

	test("propagates abort errors instead of falling back", async () => {
		const error = new DOMException("aborted", "AbortError");
		state.runPreviewTextWorker.mockRejectedValue(error);
		const content = "x".repeat(PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH + 1);

		await expect(
			highlightSearchMatchesInHtmlAsync(content, "x"),
		).rejects.toBe(error);
	});

	test("reuses normalized allowed block type arrays for worker requests", async () => {
		state.runPreviewTextWorker.mockResolvedValue(undefined);
		const content = "x".repeat(PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH + 1);
		const allowedTypesArray = ["dataview"] as const;

		await findFirstAllowedFencedCodeBlockAsync(
			content,
			new Set(allowedTypesArray),
			{},
			allowedTypesArray,
		);

		expect(state.runPreviewTextWorker).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "find-first-allowed-fenced-code-block",
				allowedTypes: allowedTypesArray,
			}),
			undefined,
		);
	});
});
