import { expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "settings/model";
import type { CardPreviewRenderer } from "card-preview/ui/cardPreviewRenderer";
import type { CardRenderModel } from "cards/rendering/cardRenderModel";
import type {
	VirtualFrameCoordinator,
	VirtualFrameLane,
} from "shared/ui/scheduling/frameCoordinator";
import { createVirtualizerEngine } from "cards/virtualization/engine/virtualizer";
import { createCardGridVisibilityPolicyResolver } from "cards/grid/model/cardGridVisibilityPolicy";
import { compileCardPreviewRequest } from "card-preview/pipeline/cardPreviewRequest";
import { createVirtualPreviewSurface } from "card-preview/scheduling/virtualPreviewSurface";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
} from "two-hop/ui/twoHopSectionModel";
import {
	createTwoHopRowModel,
	type TwoHopRowModel,
	type TwoHopVirtualCell,
} from "../rowModel";
import { buildMountedTwoHopRows, type MountedTwoHopBuild } from "../mountedRows";
import { createTwoHopCardSurfaceRuntime } from "../twoHopCardSurfaceRuntime";

function createFrames() {
	const tasks = new Map<string, () => void>();
	const coordinator: VirtualFrameCoordinator = {
		schedule(lane, key, task) {
			const id = `${lane}:${key}`;
			if (tasks.has(id)) return false;
			tasks.set(id, task);
			return true;
		},
		cancel: (lane, key) => {
			tasks.delete(`${lane}:${key}`);
		},
		isScheduled: (lane, key) => tasks.has(`${lane}:${key}`),
		dispose: () => tasks.clear(),
	};
	return {
		coordinator,
		drain(lane: VirtualFrameLane) {
			for (let i = 0; i < 100; i += 1) {
				const next = Array.from(tasks.entries()).find(([key]) =>
					key.startsWith(`${lane}:`),
				);
				if (!next) return;
				tasks.delete(next[0]);
				next[1]();
			}
			expect.fail("Queue did not settle");
		},
	};
}

function createFixture() {
	const frames = createFrames();
	const items: TwoHopItemModel[] = Array.from({ length: 4 }, (_, index) => {
		const file = Object.assign(new TFile(), {
			path: `note-${index}.md`,
			basename: `note-${index}`,
			extension: "md",
			stat: { ctime: 1, mtime: 1, size: 1 },
		});
		return {
			item: { type: "file", data: file },
			searchKey: file.path,
			key: file.path,
		};
	});
	const rowModel = createTwoHopRowModel({
		sections: [
			createTwoHopSectionModel({
				id: "section",
				kind: "primary-section",
				title: "Section",
				items,
				totalCount: items.length,
			}),
		],
		layout: {
			containerWidth: 100,
			columns: 1,
			cellWidth: 100,
			rowHeight: 100,
			gap: 0,
			sectionMarginBottom: 0,
		},
	});
	const dimensions = { widthPx: 100, heightPx: 100 };
	const hosts = new Map<string, HTMLElement>();
	const renderer = vi.fn<CardPreviewRenderer>((host, request, callbacks) => {
		host.textContent = request.file.basename;
		callbacks?.onCommitted("text", "detachable");
		return () => {};
	});
	const previewSurface = createVirtualPreviewSurface({
		frameCoordinator: frames.coordinator,
		createRenderer: () => renderer,
		prefetchPreview: async () => {},
	});
	const resolveCardModel = vi.fn((item: TwoHopItemModel): CardRenderModel => {
		if (item.item.type !== "file") expect.fail("Expected a file card");
		const file = item.item.data;
		return {
			item: item.item,
			targetFile: file,
			title: file.basename,
			ariaLabel: file.basename,
			className: null,
			extension: null,
			interactionId: item.key,
			interactionDescriptor: null,
			searchQuery: "",
			previewRequest: compileCardPreviewRequest({
				file,
				searchQuery: "",
				previewOverride: null,
				previewRenderVersion: "1",
				settings: DEFAULT_SETTINGS,
			}),
		};
	});
	const runtime = createTwoHopCardSurfaceRuntime({
		frameCoordinator: frames.coordinator,
		previewSurface,
		getMountedBuild: () => engine.getSnapshot()?.mountedBuild ?? null,
		getPreviewVisibleRange: () => engine.getSnapshot()?.ranges.previewVisible,
		getRowCount: () => rowModel.rowCount,
		getCardDimensions: () => dimensions,
		getRevision: () => 0,
		isPreviewActive: () => true,
		resolveCardModel,
		onInteractionHandlesChanged: () => {},
	});
	const policy = createCardGridVisibilityPolicyResolver();
	const engine = createVirtualizerEngine<
		TwoHopVirtualCell,
		TwoHopRowModel,
		TwoHopRowModel,
		MountedTwoHopBuild
	>({
		resolveRowModel: (model) => model,
		resolveVisibilityPolicy: (model) => policy(model.layout.rowStride),
		buildMountedRows: ({ rowModel: model, ...rest }) =>
			buildMountedTwoHopRows({ ...rest, rowModel: model }),
		onSnapshotUpdated: (snapshot) =>
			runtime.onSnapshotUpdated(snapshot.mountedBuild),
	});
	for (let row = 0; row < rowModel.rowCount; row += 1) {
		const cell = rowModel.getRow(row)?.getCell(0);
		if (cell?.kind !== "item") continue;
		const host = document.createElement("div");
		hosts.set(cell.item.key, host);
		previewSurface.registerHost(cell.logicalKey, host);
	}
	function scroll(scrollTop: number) {
		engine.applyRangeMeasurement(
			{
				scrollTop,
				viewportHeight: 300,
				sectionTop: 0,
				hasValidScrollMetrics: true,
				isScrollActive: false,
				scrollGeneration: 0,
				source: "scroll",
			},
			rowModel,
		);
		frames.drain("post-paint");
	}
	return {
		frames,
		engine,
		scroll,
		resolveCardModel,
		lastHost: hosts.get("note-3.md")!,
		dispose() {
			runtime.dispose();
			engine.dispose();
			frames.coordinator.dispose();
		},
	};
}

it.each([true, false])(
	"renders the last row after scrolling, background completed first=%s",
	(backgroundFirst) => {
		const fixture = createFixture();
		try {
			fixture.scroll(0);
			const build = fixture.engine.getSnapshot()?.mountedBuild;
			expect(fixture.engine.getSnapshot()?.ranges).toEqual({
				mounted: { start: 0, end: 5 },
				previewVisible: { start: 0, end: 3 },
			});
			if (backgroundFirst) {
				fixture.frames.drain("idle");
				fixture.frames.drain("post-paint");
				expect(fixture.resolveCardModel).toHaveBeenCalledTimes(4);
			}
			fixture.scroll(200);
			expect(fixture.engine.getSnapshot()?.mountedBuild).toBe(build);
			expect(fixture.engine.getSnapshot()?.ranges.previewVisible).toEqual({
				start: 2,
				end: 5,
			});
			expect(fixture.resolveCardModel).toHaveBeenCalledTimes(4);
			expect(fixture.lastHost.textContent).toBe("note-3");
		} finally {
			fixture.dispose();
		}
	},
);
