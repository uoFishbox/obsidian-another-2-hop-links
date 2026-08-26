import type { TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "settings/model";
import type {
	CardPreviewRenderer,
	PreviewRenderCallbacks,
} from "preview/ui/cardPreviewRenderer";
import type { CardPreviewRequest } from "preview/pipeline/cardPreviewRequest";
import { createPreviewRenderSettings } from "preview/pipeline/previewRenderSettings";
import { createTestVirtualFrameCoordinator } from "testing/testVirtualFrameCoordinator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createVirtualPreviewSurface,
	type VirtualPreviewBinding,
} from "../virtualPreviewSurface";

const FRAME_INTERVAL_MS = 1000 / 60;

interface RenderRecord {
	readonly identity: string;
	readonly callbacks: PreviewRenderCallbacks;
	readonly cleanup: ReturnType<typeof vi.fn>;
}

function createRequest(identity: string, previewOverride = false): CardPreviewRequest {
	return {
		renderKey: identity,
		previewCacheRevision: "0:0",
		file: {
			path: `${identity}.md`,
			basename: identity,
			extension: "md",
			stat: { mtime: 1 },
		} as TFile,
		searchQuery: "",
		previewOverride: previewOverride ? { type: "text", content: identity } : null,
		settings: createPreviewRenderSettings(DEFAULT_SETTINGS),
	};
}

function createBinding(
	key: string,
	rowIndex: number,
	identity = key,
	previewOverride = false,
): VirtualPreviewBinding {
	return {
		key,
		rowIndex,
		request: createRequest(identity, previewOverride),
	};
}

function createHarness(
	prefetchPreview: (
		request: CardPreviewRequest,
		signal: AbortSignal,
	) => Promise<void> = vi.fn(async () => {}),
	onRender?: (request: CardPreviewRequest) => void,
) {
	const renders: RenderRecord[] = [];
	const disposedKeys: string[] = [];
	const renderer: CardPreviewRenderer = (_host, request, callbacks) => {
		if (!callbacks) throw new TypeError("Missing render callbacks");
		onRender?.(request);
		const cleanup = vi.fn();
		renders.push({ identity: request.renderKey, callbacks, cleanup });
		return cleanup;
	};
	const surface = createVirtualPreviewSurface({
		frameCoordinator: createTestVirtualFrameCoordinator(),
		createRenderer: () => renderer,
		prefetchPreview,
		onEntryDisposed: (key) => disposedKeys.push(key),
	});
	return { surface, renders, disposedKeys };
}

async function flushSurface(): Promise<void> {
	await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS * 2);
	await Promise.resolve();
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) =>
			setTimeout(() => callback(FRAME_INTERVAL_MS), FRAME_INTERVAL_MS),
		),
	);
	vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("VirtualPreviewSurface", () => {
	it("renders only visible cards and data-prefetches the ahead range", async () => {
		const prefetchedRequests: CardPreviewRequest[] = [];
		const prefetchPreview = async (request: CardPreviewRequest): Promise<void> => {
			prefetchedRequests.push(request);
		};
		const { surface, renders } = createHarness(prefetchPreview);
		const visible = createBinding("visible", 4);
		const ahead = createBinding("ahead", 6);
		surface.registerHost(visible.key, document.createElement("div"));
		surface.registerHost(ahead.key, document.createElement("div"));

		surface.publish({
			bindings: [visible, ahead],
			visibleRange: { start: 4, end: 5 },
			prefetchRange: { start: 4, end: 7 },
			active: true,
		});
		await flushSurface();

		expect(renders.map((render) => render.identity)).toEqual(["visible"]);
		expect(prefetchedRequests).toEqual([ahead.request]);
		surface.dispose();
	});

	it("joins a promoted prefetch before detaching its caller", async () => {
		const events: string[] = [];
		const prefetchPreview = vi.fn(
			(request: CardPreviewRequest, signal: AbortSignal) =>
				new Promise<void>((_resolve, reject) => {
					events.push(`prefetch:${request.renderKey}`);
					signal.addEventListener(
						"abort",
						() => {
							events.push(`abort:${request.renderKey}`);
							reject(new DOMException("Aborted", "AbortError"));
						},
						{ once: true },
					);
				}),
		);
		const { surface } = createHarness(prefetchPreview, (request) => {
			events.push(`render:${request.renderKey}`);
		});
		const card = createBinding("card", 2);
		surface.publish({
			bindings: [card],
			visibleRange: { start: 0, end: 1 },
			prefetchRange: { start: 0, end: 3 },
			active: true,
		});
		await flushSurface();
		surface.registerHost(card.key, document.createElement("div"));
		surface.publish({
			bindings: [card],
			visibleRange: { start: 2, end: 3 },
			prefetchRange: { start: 2, end: 5 },
			active: true,
		});
		await flushSurface();

		expect(events).toEqual(["prefetch:card", "render:card", "abort:card"]);
		surface.dispose();
	});

	it("aborts prefetch that leaves the latest window", async () => {
		let signal: AbortSignal | undefined;
		const { surface } = createHarness(async (_request, nextSignal) => {
			signal = nextSignal;
			await new Promise<void>(() => {});
		});
		const card = createBinding("ahead", 3);
		surface.publish({
			bindings: [card],
			visibleRange: { start: 0, end: 1 },
			prefetchRange: { start: 0, end: 4 },
			active: true,
		});
		await flushSurface();
		expect(signal?.aborted).toBe(false);

		surface.publish({
			bindings: [],
			visibleRange: { start: 8, end: 9 },
			prefetchRange: { start: 8, end: 11 },
			active: true,
		});
		await flushSurface();
		expect(signal?.aborted).toBe(true);
		surface.dispose();
	});

	it("does not prefetch a card with an explicit preview override", async () => {
		const prefetchPreview = vi.fn(async () => {});
		const { surface } = createHarness(prefetchPreview);
		const card = createBinding("override", 2, "override", true);
		surface.publish({
			bindings: [card],
			visibleRange: { start: 0, end: 1 },
			prefetchRange: { start: 0, end: 3 },
			active: true,
		});
		await flushSurface();

		expect(prefetchPreview).not.toHaveBeenCalled();
		surface.dispose();
	});

	it("applies only the latest snapshot before its keyed flush", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot", host);
		surface.publish({
			bindings: [createBinding("slot", 0, "superseded")],
			visibleRange: { start: 0, end: 1 },
			prefetchRange: { start: 0, end: 1 },
			active: true,
		});
		surface.publish({
			bindings: [createBinding("slot", 0, "latest")],
			visibleRange: { start: 0, end: 1 },
			prefetchRange: { start: 0, end: 1 },
			active: true,
		});
		await flushSurface();

		expect(renders.map((render) => render.identity)).toEqual(["latest"]);
		surface.dispose();
	});

	it("activates a visible entry when its host arrives", async () => {
		const { surface, renders } = createHarness();
		const card = createBinding("late-host", 0);
		surface.publish({
			bindings: [card],
			visibleRange: { start: 0, end: 1 },
			prefetchRange: { start: 0, end: 1 },
			active: true,
		});
		await flushSurface();
		expect(renders).toHaveLength(0);

		surface.registerHost(card.key, document.createElement("div"));
		expect(renders.map((render) => render.identity)).toEqual(["late-host"]);
		surface.dispose();
	});

	it("disposes a rendered entry after it leaves the mounted bindings", async () => {
		const { surface, disposedKeys } = createHarness();
		const card = createBinding("departed", 0);
		surface.registerHost(card.key, document.createElement("div"));
		surface.publish({
			bindings: [card],
			visibleRange: { start: 0, end: 1 },
			prefetchRange: { start: 0, end: 1 },
			active: true,
		});
		await flushSurface();
		surface.publish({
			bindings: [],
			visibleRange: { start: 2, end: 3 },
			prefetchRange: { start: 2, end: 3 },
			active: true,
		});
		await flushSurface();

		expect(disposedKeys).toEqual(["departed"]);
		surface.dispose();
	});
});
