import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { DEFAULT_SETTINGS } from "settings/model";
import type { CardPreviewLoader } from "card-preview/ui/cardPreviewRenderer";
import type { CardPreviewSharedCache } from "card-preview/ui/cardPreviewSharedCache";
import type { EnqueuePreviewRender } from "card-preview/renderers/previewRenderQueue";
import { createTestVirtualFrameCoordinator } from "testing/testVirtualFrameCoordinator";

const state = vi.hoisted(() => ({
	surfaceOptions: [] as Array<Record<string, unknown>>,
	rendererOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("card-preview/scheduling/virtualPreviewSurface", () => ({
	createVirtualPreviewSurface: (options: Record<string, unknown>) => {
		state.surfaceOptions.push(options);
		return {
			registerHost: () => ({ dispose: () => {} }),
			publish: () => {},
			dispose: () => {},
		};
	},
}));

vi.mock("card-preview/ui/cardPreviewRenderer", () => ({
	createCardPreviewRenderer: (options: Record<string, unknown>) => {
		state.rendererOptions.push(options);
		return vi.fn(() => vi.fn());
	},
}));

import { createPreviewRuntime } from "../previewRuntime";

describe("PreviewRuntime", () => {
	beforeEach(() => {
		state.surfaceOptions.length = 0;
		state.rendererOptions.length = 0;
	});

	it("uses the runtime preview loader for surfaces", () => {
		const runtimeLoader = vi.fn() as unknown as CardPreviewLoader;
		const runtime = createPreviewRuntime({
			app: {} as App,
			getPreview: runtimeLoader,
		});

		runtime.createSurface({
			frameCoordinator: createTestVirtualFrameCoordinator(),
		});
		const surfaceOptions = state.surfaceOptions.at(-1);
		const createRenderer = surfaceOptions?.createRenderer as () => unknown;
		createRenderer();
		expect(state.rendererOptions.at(-1)?.getPreview).toBe(runtimeLoader);
		const prefetchPreview = surfaceOptions?.prefetchPreview as (
			request: {
				file: unknown;
				previewCacheRevision: string;
				previewOverride: null;
			},
			signal: AbortSignal,
		) => Promise<void>;
		const signal = new AbortController().signal;
		const file = {};
		void prefetchPreview(
			{ file, previewCacheRevision: "revision", previewOverride: null },
			signal,
		);
		expect(runtimeLoader).toHaveBeenCalledWith(file, signal, {
			cacheRevision: "revision",
		});
		runtime.dispose();
	});

	it("owns a cache which is not cleared by another runtime", () => {
		const createRuntime = () =>
			createPreviewRuntime({
				app: {} as App,
				getPreview: vi.fn() as unknown as CardPreviewLoader,
			});
		const first = createRuntime();
		const second = createRuntime();
		const firstSurfaceOptions = first.createSurface({
			frameCoordinator: createTestVirtualFrameCoordinator(),
		});
		void firstSurfaceOptions;
		const firstCreateRenderer = state.surfaceOptions.at(-1)
			?.createRenderer as () => unknown;
		firstCreateRenderer();
		const firstCache = state.rendererOptions.at(-1)
			?.sharedCache as CardPreviewSharedCache;
		const secondSurfaceOptions = second.createSurface({
			frameCoordinator: createTestVirtualFrameCoordinator(),
		});
		void secondSurfaceOptions;
		const secondCreateRenderer = state.surfaceOptions.at(-1)
			?.createRenderer as () => unknown;
		secondCreateRenderer();
		const secondCache = state.rendererOptions.at(-1)
			?.sharedCache as CardPreviewSharedCache;
		const firstClear = vi.spyOn(firstCache, "clear");
		const secondClear = vi.spyOn(secondCache, "clear");

		expect(firstCache).not.toBe(secondCache);
		first.dispose();
		expect(firstClear).toHaveBeenCalledOnce();
		expect(secondClear).not.toHaveBeenCalled();
		second.dispose();
		expect(secondClear).toHaveBeenCalledOnce();
	});

	it("owns a render queue which is not disposed by another runtime", async () => {
		const createRuntime = () =>
			createPreviewRuntime({
				app: {} as App,
				getPreview: vi.fn() as unknown as CardPreviewLoader,
			});
		const first = createRuntime();
		const second = createRuntime();

		first.createSurface({
			frameCoordinator: createTestVirtualFrameCoordinator(),
		});
		const firstCreateRenderer = state.surfaceOptions.at(-1)
			?.createRenderer as () => unknown;
		firstCreateRenderer();
		const firstEnqueue = state.rendererOptions.at(-1)
			?.enqueuePreviewRender as EnqueuePreviewRender;

		second.createSurface({
			frameCoordinator: createTestVirtualFrameCoordinator(),
		});
		const secondCreateRenderer = state.surfaceOptions.at(-1)
			?.createRenderer as () => unknown;
		secondCreateRenderer();
		const secondEnqueue = state.rendererOptions.at(-1)
			?.enqueuePreviewRender as EnqueuePreviewRender;

		expect(firstEnqueue).not.toBe(secondEnqueue);
		first.dispose();
		await expect(firstEnqueue(async () => "disposed")).rejects.toMatchObject({
			name: "AbortError",
		});
		await expect(secondEnqueue(async () => "active")).resolves.toBe("active");
		second.dispose();
	});

	it("returns disabled surfaces after disposal", () => {
		const runtime = createPreviewRuntime({
			app: {} as App,
			getPreview: vi.fn() as unknown as CardPreviewLoader,
		});
		runtime.dispose();

		const surface = runtime.createSurface({
			frameCoordinator: createTestVirtualFrameCoordinator(),
		});

		expect(state.surfaceOptions).toHaveLength(0);
		expect(state.rendererOptions).toHaveLength(0);
		expect(() => {
			surface.publish({
				bindings: [],
				visibleRange: { start: 0, end: 0 },
				prefetchRange: { start: 0, end: 0 },
				active: false,
			});
		}).not.toThrow();
	});
});
