import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { DEFAULT_SETTINGS } from "features/settings/model";
import type { CardPreviewLoader } from "features/card-preview/ui/cardPreviewRenderer";
import type { CardPreviewSharedCache } from "features/card-preview/ui/cardPreviewSharedCache";
import type { CardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";

const state = vi.hoisted(() => ({
	surfaceOptions: [] as Array<Record<string, unknown>>,
	rendererOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("features/card-preview/scheduling/virtualPreviewSurface", () => ({
	createVirtualPreviewSurface: (options: Record<string, unknown>) => {
		state.surfaceOptions.push(options);
		return {
			registerHost: () => ({ dispose: () => {} }),
			publish: () => {},
			dispose: () => {},
		};
	},
}));

vi.mock("features/card-preview/ui/cardPreviewRenderer", () => ({
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

	it("uses the runtime preview loader for surfaces and standalone renderers", () => {
		const runtimeLoader = vi.fn() as unknown as CardPreviewLoader;
		const runtime = createPreviewRuntime({
			app: {} as App,
			getPreview: runtimeLoader,
		});

		runtime.createSurface({});
		const surfaceOptions = state.surfaceOptions.at(-1);
		const createRenderer = surfaceOptions?.createRenderer as () => unknown;
		createRenderer();
		expect(state.rendererOptions.at(-1)?.getPreview).toBe(runtimeLoader);

		runtime.createRenderer({});
		expect(state.rendererOptions.at(-1)?.getPreview).toBe(runtimeLoader);
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
		const rendererOptions = {};
		first.createRenderer(rendererOptions);
		const firstCache = state.rendererOptions.at(-1)
			?.sharedCache as CardPreviewSharedCache;
		second.createRenderer(rendererOptions);
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

	it("returns disabled surfaces and renderers after disposal", () => {
		const runtime = createPreviewRuntime({
			app: {} as App,
			getPreview: vi.fn() as unknown as CardPreviewLoader,
		});
		runtime.dispose();

		const surface = runtime.createSurface({});
		const renderer = runtime.createRenderer({});
		const cleanup = renderer({} as HTMLElement, {} as CardPreviewRequest);

		expect(state.surfaceOptions).toHaveLength(0);
		expect(state.rendererOptions).toHaveLength(0);
		expect(() => surface.publish({} as never)).not.toThrow();
		expect(() => cleanup()).not.toThrow();
	});
});
