import type { TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "settings/model";
import type { CardPreviewRequest } from "preview/pipeline/cardPreviewRequest";
import { createPreviewRenderSettings } from "preview/pipeline/previewRenderSettings";
import type {
	CardPreviewRenderer,
	PreviewRenderCallbacks,
} from "../cardPreviewRenderer";
import { createPreviewSlotController } from "../previewSlotController";
import { describe, expect, it, vi } from "vitest";

function request(renderKey: string): CardPreviewRequest {
	return {
		renderKey,
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
		const controller = createPreviewSlotController(() => render);
		const host = document.createElement("div");
		const firstLease = controller.attachHost(host);
		const secondLease = controller.attachHost(host);

		firstLease.dispose();
		controller.bind(request("current"));
		controller.setActive(true);
		controller.activate();

		expect(render).toHaveBeenCalledOnce();
		expect(render.mock.calls[0]?.[0]).toBe(host);
		secondLease.dispose();
		controller.dispose();
	});

	it("releases detachable renderer resources at commit and moves its DOM without rendering again", () => {
		const callbacks: PreviewRenderCallbacks[] = [];
		const cleanup = vi.fn();
		const render = vi.fn<CardPreviewRenderer>((_host, _request, next) => {
			if (!next) throw new TypeError("Missing callbacks");
			callbacks.push(next);
			return cleanup;
		});
		const controller = createPreviewSlotController(() => render);
		const firstHost = document.createElement("div");
		const firstLease = controller.attachHost(firstHost);
		controller.bind(request("stable"));
		controller.setActive(true);
		controller.activate();

		const image = document.createElement("img");
		firstHost.replaceChildren(image);
		callbacks[0]?.onCommitted("image", "detachable");
		expect(cleanup).toHaveBeenCalledOnce();
		expect(render).toHaveBeenCalledOnce();

		firstLease.dispose();
		expect(firstHost.childNodes).toHaveLength(0);

		const secondHost = document.createElement("div");
		controller.attachHost(secondHost);
		expect(secondHost.firstChild).toBe(image);
		expect(secondHost.dataset.previewState).toBe("committed");
		expect(controller.needsActivation()).toBe(false);

		controller.activate();
		expect(render).toHaveBeenCalledOnce();
		controller.dispose();
	});

	it("keeps committed DOM visible while a changed render key is refreshing", () => {
		const callbacks: PreviewRenderCallbacks[] = [];
		const render = vi.fn<CardPreviewRenderer>((_host, _request, next) => {
			if (!next) throw new TypeError("Missing callbacks");
			callbacks.push(next);
			return vi.fn();
		});
		const controller = createPreviewSlotController(() => render);
		const host = document.createElement("div");
		controller.attachHost(host);
		controller.bind(request("v1"));
		controller.setActive(true);
		controller.activate();

		const oldNode = document.createElement("span");
		oldNode.textContent = "old";
		host.replaceChildren(oldNode);
		callbacks[0]?.onCommitted("text", "detachable");

		controller.bind(request("v2"));
		controller.activate();
		expect(host.firstChild).toBe(oldNode);
		expect(host.dataset.previewState).toBe("refreshing");
		expect(host.classList.contains("is-stale")).toBe(false);
		controller.dispose();
	});

	it("keeps host-bound resources until their visible DOM is replaced", () => {
		const callbacks: PreviewRenderCallbacks[] = [];
		const cleanups: Array<ReturnType<typeof vi.fn>> = [];
		const render = vi.fn<CardPreviewRenderer>((_host, _request, next) => {
			if (!next) throw new TypeError("Missing callbacks");
			const cleanup = vi.fn();
			callbacks.push(next);
			cleanups.push(cleanup);
			return cleanup;
		});
		const controller = createPreviewSlotController(() => render);
		const host = document.createElement("div");
		controller.attachHost(host);
		controller.bind(request("v1"));
		controller.setActive(true);
		controller.activate();

		const oldNode = document.createElement("span");
		host.replaceChildren(oldNode);
		callbacks[0]?.onCommitted("dom", "host-bound");
		expect(cleanups[0]).not.toHaveBeenCalled();

		controller.bind(request("v2"));
		controller.activate();
		expect(host.firstChild).toBe(oldNode);
		expect(cleanups[0]).not.toHaveBeenCalled();

		host.replaceChildren(document.createElement("img"));
		callbacks[1]?.onCommitted("image", "detachable");
		expect(cleanups[0]).toHaveBeenCalledOnce();
		expect(cleanups[1]).toHaveBeenCalledOnce();
		controller.dispose();
	});

	it("keeps errors separate from committed content and allows retry", () => {
		const cleanups: Array<ReturnType<typeof vi.fn>> = [];
		const callbacks: PreviewRenderCallbacks[] = [];
		const render: CardPreviewRenderer = (_host, _request, next) => {
			if (!next) throw new TypeError("Missing callbacks");
			const cleanup = vi.fn();
			callbacks.push(next);
			cleanups.push(cleanup);
			next.onError?.();
			return cleanup;
		};
		const controller = createPreviewSlotController(() => render);
		const host = document.createElement("div");
		controller.attachHost(host);
		controller.bind(request("retry"));
		controller.setActive(true);

		controller.activate();
		expect(host.dataset.previewState).toBe("error");
		expect(controller.needsActivation()).toBe(true);

		controller.activate();
		expect(callbacks).toHaveLength(2);
		expect(cleanups[0]).toHaveBeenCalledOnce();
		expect(host.dataset.previewState).toBe("error");
		controller.dispose();
	});
});
