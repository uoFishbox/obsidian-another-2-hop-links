import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import { createTwoHopDomPool } from "../twoHopDomPool";
import { createTwoHopPreviewHydrator } from "../twoHopPreviewHydrator";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { PreviewRequestOptions } from "features/preview/public-types";

function createModel(
	path: string,
	previewCacheRevision?: number | string,
): CardRenderModel {
	const targetFile = { path, extension: "md" } as TFile;
	return {
		item: { type: "file" } as CardRenderModel["item"],
		targetFile,
		title: path,
		ariaLabel: path,
		className: null,
		extension: "md",
		directory: null,
		interactionId: path,
		interactionKey: path,
		presentation: undefined,
		searchQuery: "",
		searchScope: "title-only",
		contentPreview: undefined,
		previewRefreshToken: 0,
		previewCacheRevision,
		previewActivationIdentity: `preview:${path}`,
	};
}

function createReadyPool() {
	const content = document.createElement("div");
	const pool = createTwoHopDomPool({ content, rowCapacity: 1, columns: 2 });
	pool.positionRow(pool.rows[0], 0, 0);
	for (const [index, slot] of pool.rows[0].cells.entries()) {
		slot.rich = true;
		slot.logicalIdentity = `item:${index}`;
		slot.cardModel = createModel(`notes/${index}.md`);
	}
	return pool;
}

describe("twoHopPreviewHydrator", () => {
	it("does not commit an async preview after its slot generation changes", async () => {
		const pool = createReadyPool();
		let resolvePreview!: (value: { type: "text"; content: string }) => void;
		const previewPromise = new Promise<{ type: "text"; content: string }>(
			(resolve) => {
				resolvePreview = resolve;
			},
		);
		const getPreview = vi.fn(() => previewPromise);
		const hydrator = createTwoHopPreviewHydrator({
			getRows: () => pool.rows,
			getPreview,
			setTimer: () => 1,
			clearTimer: () => {},
		});
		hydrator.notifyViewport(0, 1, false, 0, false);
		expect(hydrator.hydrateNext("visible-idle")).toBe(true);
		const slot = pool.rows[0].cells[0];
		slot.generation += 1;
		resolvePreview({ type: "text", content: "stale" });
		await Promise.resolve();
		await Promise.resolve();

		expect(slot.previewHost.textContent).toBe("");
		expect(hydrator.getStats().staleCompletions).toBe(1);
		hydrator.dispose();
	});

	it("rate-limits opportunistic preview activation while scrolling", () => {
		const pool = createReadyPool();
		let timestamp = 200;
		const hydrator = createTwoHopPreviewHydrator({
			getRows: () => pool.rows,
			getPreview: () => new Promise(() => {}),
			now: () => timestamp,
			setTimer: () => 1,
			clearTimer: () => {},
			opportunisticIntervalMs: 160,
		});
		const notify = () => hydrator.notifyViewport(0, 1, true, 0, false);

		notify();
		timestamp = 250;
		notify();
		timestamp = 400;
		notify();

		expect(hydrator.getStats().opportunisticActivations).toBe(2);
		expect(hydrator.getStats().requested).toBe(2);
		hydrator.dispose();
	});

	it("keeps one idle timer while viewport notifications extend the deadline", () => {
		const pool = createReadyPool();
		let timestamp = 0;
		const callbacks: Array<() => void> = [];
		const delays: number[] = [];
		const clearTimer = vi.fn();
		const hydrator = createTwoHopPreviewHydrator({
			getRows: () => pool.rows,
			getPreview: () => new Promise(() => {}),
			now: () => timestamp,
			idleDelayMs: 100,
			setTimer: (callback, delayMs) => {
				callbacks.push(callback);
				delays.push(delayMs);
				return callbacks.length;
			},
			clearTimer,
		});

		hydrator.notifyViewport(0, 1, false, 0, false);
		timestamp = 20;
		hydrator.notifyViewport(0, 1, false, 0, false);
		timestamp = 40;
		hydrator.notifyViewport(0, 1, false, 0, false);

		expect(callbacks).toHaveLength(1);
		expect(clearTimer).not.toHaveBeenCalled();
		timestamp = 100;
		callbacks[0]();
		expect(delays).toEqual([100, 40]);
		expect(callbacks[1]).toBe(callbacks[0]);

		timestamp = 140;
		callbacks[1]();
		expect(hydrator.getStats().requested).toBe(1);
		expect(delays).toEqual([100, 40, 0]);
		expect(callbacks[2]).toBe(callbacks[0]);
		hydrator.dispose();
	});

	it("renders text preview markup as HTML instead of escaped source", async () => {
		const pool = createReadyPool();
		const hydrator = createTwoHopPreviewHydrator({
			getRows: () => pool.rows,
			getPreview: async () => ({
				type: "text",
				content: '<strong>Rendered</strong><a href="#target">link</a>',
			}),
			setTimer: () => 1,
			clearTimer: () => {},
		});
		hydrator.notifyViewport(0, 1, false, 0, false);

		expect(hydrator.hydrateNext("visible-idle")).toBe(true);
		await Promise.resolve();
		await Promise.resolve();

		const host = pool.rows[0].cells[0].previewHost;
		expect(host.querySelector("strong")?.textContent).toBe("Rendered");
		expect(host.querySelector("a")?.textContent).toBe("link");
		expect(host.textContent).not.toContain("<strong>");
		hydrator.dispose();
	});

	it("highlights visible preview matches during content search", async () => {
		const pool = createReadyPool();
		const slot = pool.rows[0].cells[0];
		if (!slot.cardModel) throw new Error("expected card model");
		slot.cardModel = {
			...slot.cardModel,
			searchQuery: "needle",
			searchScope: "title-and-content",
			contentPreview: "<p>Before Needle after</p>",
		};
		pool.rows[0].cells[1].previewStatus = "ready";
		const hydrator = createTwoHopPreviewHydrator({
			getRows: () => pool.rows,
			getPreview: vi.fn(async () => ({ type: "empty" as const, content: "" })),
			setTimer: () => 1,
			clearTimer: () => {},
		});
		hydrator.notifyViewport(0, 1, false, 0, false);

		expect(hydrator.hydrateNext("visible-idle")).toBe(true);
		await Promise.resolve();
		await Promise.resolve();

		expect(
			slot.previewHost.querySelector(".ccl-search-highlight")?.textContent,
		).toBe("Needle");
		expect(slot.previewHost.querySelector("p")?.textContent).toBe(
			"Before Needle after",
		);
		hydrator.dispose();
	});

	it("keeps the previous preview visible until its replacement is ready", async () => {
		const pool = createReadyPool();
		const slot = pool.rows[0].cells[0];
		const previousPreview = document.createElement("strong");
		previousPreview.textContent = "Previous";
		slot.previewHost.append(previousPreview);
		const disposePrevious = vi.fn();
		slot.disposePreview = disposePrevious;
		pool.rows[0].cells[1].previewStatus = "ready";
		let resolvePreview!: (value: { type: "text"; content: string }) => void;
		const previewPromise = new Promise<{ type: "text"; content: string }>(
			(resolve) => {
				resolvePreview = resolve;
			},
		);
		const hydrator = createTwoHopPreviewHydrator({
			getRows: () => pool.rows,
			getPreview: () => previewPromise,
			setTimer: () => 1,
			clearTimer: () => {},
		});
		hydrator.notifyViewport(0, 1, false, 0, false);

		expect(hydrator.hydrateNext("visible-idle")).toBe(true);
		expect(slot.previewHost.textContent).toBe("Previous");
		expect(disposePrevious).not.toHaveBeenCalled();

		resolvePreview({ type: "text", content: "<em>Updated</em>" });
		await Promise.resolve();
		await Promise.resolve();

		expect(slot.previewHost.querySelector("em")?.textContent).toBe("Updated");
		expect(disposePrevious).toHaveBeenCalledOnce();
		hydrator.dispose();
	});

	it("passes the index preview revision to the preview cache", async () => {
		const pool = createReadyPool();
		pool.rows[0].cells[0].cardModel = createModel("notes/0.md", "3:7:0");
		pool.rows[0].cells[1].previewStatus = "ready";
		const getPreview = vi.fn(
			async (
				_file: TFile,
				_signal?: AbortSignal,
				_options?: PreviewRequestOptions,
			) => ({ type: "empty" as const, content: "" }),
		);
		const hydrator = createTwoHopPreviewHydrator({
			getRows: () => pool.rows,
			getPreview,
			setTimer: () => 1,
			clearTimer: () => {},
		});
		hydrator.notifyViewport(0, 1, false, 0, false);

		expect(hydrator.hydrateNext("visible-idle")).toBe(true);
		expect(getPreview.mock.calls[0]?.[2]?.cacheRevision).toBe("3:7:0");
		await Promise.resolve();
		await Promise.resolve();
		hydrator.dispose();
	});
});
