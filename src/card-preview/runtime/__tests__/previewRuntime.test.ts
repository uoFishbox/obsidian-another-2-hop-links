import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { DEFAULT_SETTINGS } from "settings/model";
import type { CardPreviewLoader } from "card-preview/ui/cardPreviewRenderer";
import type { CardPreviewSharedCache } from "card-preview/ui/cardPreviewSharedCache";
import type { EnqueuePreviewRender } from "card-preview/renderers/previewRenderQueue";
import type { PreviewDomCommitScope } from "card-preview/scheduling/previewDomCommitScheduler";
import { createTestVirtualFrameCoordinator } from "testing/testVirtualFrameCoordinator";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import {
	markScrollActivityActive,
	resetScrollActivityForTests,
} from "shared/ui/scroll/scrollActivity";

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
		resetScrollActivityForTests();
	});

	afterEach(() => {
		resetScrollActivityForTests();
	});

	it("uses the runtime preview loader for surfaces", () => {
		const runtimeLoader = vi.fn() as unknown as CardPreviewLoader;
		const rawContentLoader = vi.fn();
		const runtime = createPreviewRuntime({
			app: {} as App,
			getPreview: runtimeLoader,
			getRawContent: rawContentLoader,
		});

		runtime.createSurface({
			frameCoordinator: createTestVirtualFrameCoordinator(),
		});
		const surfaceOptions = state.surfaceOptions.at(-1);
		const createRenderer = surfaceOptions?.createRenderer as () => unknown;
		createRenderer();
		expect(state.rendererOptions.at(-1)?.getPreview).toBe(runtimeLoader);
		expect(state.rendererOptions.at(-1)?.getRawContent).toBe(rawContentLoader);
		const prefetchPreview = surfaceOptions?.prefetchPreview as (
			request: {
				file: unknown;
				previewCacheRevision: string;
				previewOverride: null;
				settings: unknown;
			},
			signal: AbortSignal,
		) => Promise<void>;
		const signal = new AbortController().signal;
		const file = {};
		const settings = { cardWidthPx: 170 };
		void prefetchPreview(
			{
				file,
				previewCacheRevision: "revision",
				previewOverride: null,
				settings,
			},
			signal,
		);
		expect(runtimeLoader).toHaveBeenCalledWith(file, signal, {
			cacheRevision: "revision",
			renderSettings: settings,
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

	it("owns separate DOM commit budget scopes for images and other previews", async () => {
		const getDomCommitsPerSecond = vi.fn(() => 40);
		const getImageDomCommitsPerSecond = vi.fn(() => 12);
		const scheduledTasks: Array<() => void> = [];
		const frameCoordinator: VirtualFrameCoordinator = {
			schedule: vi.fn((_lane, _key, task) => {
				scheduledTasks.push(task);
				return true;
			}),
			cancel: vi.fn(),
			isScheduled: vi.fn(() => false),
			dispose: vi.fn(),
		};
		markScrollActivityActive({});
		const runtime = createPreviewRuntime({
			app: {} as App,
			getPreview: vi.fn() as unknown as CardPreviewLoader,
			getDomCommitsPerSecond,
			getImageDomCommitsPerSecond,
		});
		const surface = runtime.createSurface({
			frameCoordinator,
		});
		const createRenderer = state.surfaceOptions.at(-1)
			?.createRenderer as () => unknown;
		createRenderer();
		const rendererOptions = state.rendererOptions.at(-1);
		const domCommitScope = rendererOptions?.domCommitScope as PreviewDomCommitScope;
		const imageDomCommitScope =
			rendererOptions?.imageDomCommitScope as PreviewDomCommitScope;
		const disposeDomCommits = vi.spyOn(domCommitScope, "dispose");
		const disposeImageCommits = vi.spyOn(imageDomCommitScope, "dispose");

		expect(imageDomCommitScope).not.toBe(domCommitScope);
		const domCommit = domCommitScope.schedule({
			targetKey: "text-preview",
			isStale: () => false,
			commit: () => true,
		});
		const imageCommit = imageDomCommitScope.schedule({
			targetKey: "image-preview",
			isStale: () => false,
			commit: () => true,
		});
		expect(scheduledTasks).toHaveLength(2);
		for (const task of scheduledTasks) task();
		await expect(Promise.all([domCommit, imageCommit])).resolves.toEqual([
			{ type: "committed" },
			{ type: "committed" },
		]);
		expect(getDomCommitsPerSecond).toHaveBeenCalledOnce();
		expect(getImageDomCommitsPerSecond).toHaveBeenCalledOnce();
		surface.dispose();
		expect(disposeDomCommits).toHaveBeenCalledOnce();
		expect(disposeImageCommits).toHaveBeenCalledOnce();
		runtime.dispose();
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
