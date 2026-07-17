import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import { createTwoHopDomPool } from "../twoHopDomPool";
import { createTwoHopPreviewHydrator } from "../twoHopPreviewHydrator";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";

function createModel(path: string): CardRenderModel {
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
		hydrator.notifyViewport({
			visibleStart: 0,
			visibleEnd: 1,
			scrollActive: false,
			velocityRowsPerMs: 0,
			criticalWorkPending: false,
		});
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
		const notify = () =>
			hydrator.notifyViewport({
				visibleStart: 0,
				visibleEnd: 1,
				scrollActive: true,
				velocityRowsPerMs: 0,
				criticalWorkPending: false,
			});

		notify();
		timestamp = 250;
		notify();
		timestamp = 400;
		notify();

		expect(hydrator.getStats().opportunisticActivations).toBe(2);
		expect(hydrator.getStats().requested).toBe(2);
		hydrator.dispose();
	});
});
