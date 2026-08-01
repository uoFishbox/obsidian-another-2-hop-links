import type { TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "features/settings/model";
import type { CardPreviewRequest } from "features/preview/core/cardPreviewRequest";
import { createPreviewRenderSettings } from "features/preview/core/previewRenderSettings";
import type {
	CardPreviewRenderer,
	PreviewRenderCallbacks,
} from "../cardPreviewRenderer";
import { createPreviewSlotController } from "../previewSlotController";
import { describe, expect, it, vi } from "vitest";

function request(renderKey: string): CardPreviewRequest {
	return {
		renderKey,
		previewContentKey: `content:${renderKey}`,
		previewCacheRevision: "0:0",
		file: { path: `${renderKey}.md` } as TFile,
		searchQuery: "",
		previewOverride: null,
		settings: createPreviewRenderSettings(DEFAULT_SETTINGS),
	};
}

describe("PreviewSlotController", () => {
	it("does not let an old lease detach a newer lease for the same host", () => {
		const render = vi.fn<CardPreviewRenderer>(() => vi.fn());
		const controller = createPreviewSlotController({
			createRenderer: () => render,
		});
		const host = document.createElement("div");
		const firstLease = controller.attachHost(host);
		const secondLease = controller.attachHost(host);

		firstLease.dispose();
		controller.bind({ ownerToken: {}, request: request("current") });
		controller.setActive(true);
		controller.activate();

		expect(render).toHaveBeenCalledOnce();
		expect(render.mock.calls[0]?.[0]).toBe(host);
		secondLease.dispose();
		controller.dispose();
	});

	it("keeps errors separate from committed content and allows retry", () => {
		const cleanups: Array<ReturnType<typeof vi.fn>> = [];
		const callbacks: PreviewRenderCallbacks[] = [];
		const render: CardPreviewRenderer = (_host, _request, _generation, next) => {
			if (!next) throw new TypeError("Missing callbacks");
			const cleanup = vi.fn();
			callbacks.push(next);
			cleanups.push(cleanup);
			next.onLoadingChange(true);
			next.onError?.();
			return cleanup;
		};
		const states: string[] = [];
		const controller = createPreviewSlotController({
			createRenderer: () => render,
			onStateChange: (state) => states.push(state.phase),
		});
		controller.attachHost(document.createElement("div"));
		controller.bind({ ownerToken: {}, request: request("retry") });
		controller.setActive(true);

		controller.activate();
		expect(states.at(-1)).toBe("error");
		expect(controller.needsActivation()).toBe(true);

		controller.activate();
		expect(callbacks).toHaveLength(2);
		expect(cleanups[0]).toHaveBeenCalledOnce();
		expect(states.at(-1)).toBe("error");
		controller.dispose();
	});

	it("deduplicates equivalent state notifications", () => {
		let callbacks: PreviewRenderCallbacks | undefined;
		const render: CardPreviewRenderer = (_host, _request, _generation, next) => {
			callbacks = next;
			next?.onLoadingChange(true);
			next?.onLoadingChange(true);
			return vi.fn();
		};
		const onStateChange = vi.fn();
		const controller = createPreviewSlotController({
			createRenderer: () => render,
			onStateChange,
		});
		controller.attachHost(document.createElement("div"));
		controller.bind({ ownerToken: {}, request: request("dedupe") });
		controller.setActive(true);
		controller.activate();

		expect(callbacks).toBeDefined();
		expect(
			onStateChange.mock.calls.filter(([state]) => state.phase === "loading"),
		).toHaveLength(1);
		controller.dispose();
	});
});
