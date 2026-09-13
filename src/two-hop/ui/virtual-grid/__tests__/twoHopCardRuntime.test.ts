import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import { compileCardPreviewRequest } from "card-preview/pipeline/cardPreviewRequest";
import type {
	VirtualPreviewSurface,
	VirtualPreviewSurfaceSnapshot,
} from "card-preview/scheduling/virtualPreviewSurface";
import type { CardRenderModel } from "cards/rendering/cardRenderModel";
import { createResidentRowSlotAllocator } from "cards/virtualization/public";
import { DEFAULT_SETTINGS } from "settings/model";
import type {
	VirtualFrameCoordinator,
	VirtualFrameLane,
} from "shared/ui/scheduling/frameCoordinator";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
} from "two-hop/ui/twoHopSectionModel";
import { buildMountedTwoHopRows, type MountedTwoHopBuild } from "../mountedRows";
import { createTwoHopRowModel } from "../rowModel";
import { createTwoHopCardRuntime, type TwoHopCardRuntime } from "../twoHopCardRuntime";

interface TestFrameCoordinator {
	readonly coordinator: VirtualFrameCoordinator;
	isScheduled(lane: VirtualFrameLane): boolean;
	drain(lane: VirtualFrameLane): void;
	drainAll(): void;
}

function createTestFrameCoordinator(): TestFrameCoordinator {
	const tasks = new Map<string, () => void>();
	const taskKey = (lane: VirtualFrameLane, key: string): string => `${lane}:${key}`;
	const coordinator: VirtualFrameCoordinator = {
		schedule: (lane, key, task) => {
			const keyWithLane = taskKey(lane, key);
			if (tasks.has(keyWithLane)) return false;
			tasks.set(keyWithLane, task);
			return true;
		},
		cancel: (lane, key) => {
			tasks.delete(taskKey(lane, key));
		},
		isScheduled: (lane, key) => tasks.has(taskKey(lane, key)),
		dispose: () => tasks.clear(),
	};

	function drain(lane: VirtualFrameLane): void {
		for (let guard = 0; guard < 1_000; guard += 1) {
			const next = Array.from(tasks.entries()).find(([key]) =>
				key.startsWith(`${lane}:`),
			);
			if (!next) return;
			tasks.delete(next[0]);
			next[1]();
		}
		throw new Error(`Lane ${lane} did not settle`);
	}

	return {
		coordinator,
		isScheduled: (lane) =>
			Array.from(tasks.keys()).some((key) => key.startsWith(`${lane}:`)),
		drain,
		drainAll() {
			for (const lane of ["post-paint", "idle"] as const) drain(lane);
		},
	};
}

function createFakePreviewSurface() {
	const publish = vi.fn<(snapshot: VirtualPreviewSurfaceSnapshot) => void>();
	const surface = {
		registerHost: vi.fn(),
		publish,
		dispose: vi.fn(),
	} as unknown as VirtualPreviewSurface;
	return { surface, publish };
}

function createItem(index: number): TwoHopItemModel {
	return {
		item: { type: "newLink" } as TwoHopItemModel["item"],
		interactionId: `interaction:${index}`,
		searchKey: `search:${index}`,
		key: `item:${index}`,
	};
}

function createPreviewRequest(index: number) {
	const file = {
		path: `note-${index}.md`,
		basename: `note-${index}`,
		extension: "md",
		stat: { mtime: index },
	} as TFile;
	return compileCardPreviewRequest({
		file,
		searchQuery: "",
		previewOverride: null,
		previewRenderVersion: "1",
		settings: DEFAULT_SETTINGS,
	});
}

function resolveCardModel(item: TwoHopItemModel): CardRenderModel {
	return {
		item: item.item,
		targetFile: null,
		title: item.key,
		ariaLabel: item.key,
		className: null,
		extension: null,
		interactionId: item.interactionId ?? item.key,
		interactionDescriptor: null,
		searchQuery: "",
		previewRequest: createPreviewRequest(0),
	};
}

interface RuntimeHarness {
	readonly runtime: TwoHopCardRuntime;
	readonly frames: TestFrameCoordinator;
	readonly publish: ReturnType<typeof createFakePreviewSurface>["publish"];
	readonly resolveCardModel: ReturnType<typeof vi.fn>;
	readonly getMountedBuild: () => MountedTwoHopBuild | null;
	readonly setMountedBuild: (build: MountedTwoHopBuild | null) => void;
	readonly setVisibleRange: (start: number, end: number) => void;
	readonly setRevision: (revision: unknown) => void;
	readonly setPreviewActive: (active: boolean) => void;
	readonly setDimensions: (widthPx: number, heightPx: number) => void;
	readonly applyRangeEffects: () => void;
	readonly dispose: () => void;
}

function createHarness(params: {
	readonly itemCount: number;
	readonly columns?: number;
	readonly previewActive?: boolean;
	readonly resolveCardModel?: (
		item: TwoHopItemModel,
		revision: unknown,
	) => CardRenderModel;
	readonly wrapMountedRows?: (build: MountedTwoHopBuild) => MountedTwoHopBuild;
}): RuntimeHarness {
	const columns = params.columns ?? 1;
	const items = Array.from({ length: params.itemCount }, (_, index) =>
		createItem(index),
	);
	const rowModel = createTwoHopRowModel({
		sections: [
			createTwoHopSectionModel({
				id: "section",
				kind: "new-links-section",
				title: "Section",
				items,
				totalCount: items.length,
			}),
		],
		layout: {
			containerWidth: 320,
			columns,
			cellWidth: 100,
			rowHeight: 100,
			gap: 0,
			sectionMarginBottom: 0,
		},
	});
	const allocator = createResidentRowSlotAllocator();
	const built = buildMountedTwoHopRows({
		rowModel,
		rowRange: { start: 0, end: rowModel.rowCount },
		rowSlotAllocator: allocator,
	});
	let mountedBuild: MountedTwoHopBuild | null =
		params.wrapMountedRows?.(built) ?? built;
	let visibleRange = { start: 0, end: 0 };
	let revision: unknown = 0;
	let previewActive = params.previewActive ?? false;
	let dimensions = { widthPx: 100, heightPx: 100 };
	const frames = createTestFrameCoordinator();
	const { surface, publish } = createFakePreviewSurface();
	const resolveCardModelFn = vi.fn(
		params.resolveCardModel ?? (resolveCardModel as never),
	);
	const runtime = createTwoHopCardRuntime({
		frameCoordinator: frames.coordinator,
		previewSurface: surface,
		getMountedBuild: () => mountedBuild,
		getPreviewVisibleRange: () => visibleRange,
		getRowCount: () => rowModel.rowCount,
		getCardDimensions: () => dimensions,
		getRevision: () => revision,
		isPreviewActive: () => previewActive,
		resolveCardModel: resolveCardModelFn as never,
		onInteractionHandlesChanged: vi.fn(),
	});

	return {
		runtime,
		frames,
		publish,
		resolveCardModel: resolveCardModelFn,
		getMountedBuild: () => mountedBuild,
		setMountedBuild: (build) => {
			mountedBuild = build;
		},
		setVisibleRange: (start, end) => {
			visibleRange = { start, end };
		},
		setRevision: (next) => {
			revision = next;
		},
		setPreviewActive: (active) => {
			previewActive = active;
		},
		setDimensions: (widthPx, heightPx) => {
			dimensions = { widthPx, heightPx };
		},
		applyRangeEffects: () => {
			runtime.scheduleRangeEffects();
			frames.drain("post-paint");
		},
		dispose: () => {
			runtime.dispose();
			allocator.dispose();
			frames.coordinator.dispose();
		},
	};
}

function createBindingsReadCounter(build: MountedTwoHopBuild) {
	let reads = 0;
	const rowsInMountedRange = build.rowsInMountedRange.map(
		(row) =>
			new Proxy(row as unknown as object, {
				get(target, property, receiver) {
					if (property === "bindings") reads += 1;
					return Reflect.get(target, property, receiver);
				},
			}) as unknown as MountedTwoHopBuild["rowsInMountedRange"][number],
	);
	return {
		build: { ...build, rowsInMountedRange },
		reads: () => reads,
	};
}

describe("createTwoHopCardRuntime", () => {
	it("traverses mounted rows once per range update", () => {
		let counter: ReturnType<typeof createBindingsReadCounter> | undefined;
		const harness = createHarness({
			itemCount: 6,
			columns: 2,
			previewActive: true,
			wrapMountedRows: (build) => {
				counter = createBindingsReadCounter(build);
				return counter.build;
			},
		});
		try {
			harness.setVisibleRange(0, 2);
			harness.runtime.onSnapshotUpdated(harness.getMountedBuild());
			harness.applyRangeEffects();
			harness.frames.drainAll();
			const rowCount = harness.getMountedBuild()!.rowsInMountedRange.length;
			const readsAfterSettling = counter!.reads();
			expect(harness.resolveCardModel).toHaveBeenCalledTimes(6);

			harness.setVisibleRange(0, 1);
			harness.runtime.scheduleRangeEffects();
			harness.frames.drain("post-paint");

			expect(harness.resolveCardModel).toHaveBeenCalledTimes(6);
			expect(counter!.reads() - readsAfterSettling).toBe(rowCount);
		} finally {
			harness.dispose();
		}
	});

	it("hydrates visible cards first and keeps background cards on idle", () => {
		const harness = createHarness({ itemCount: 8, previewActive: true });
		try {
			harness.setVisibleRange(2, 3);
			harness.runtime.onSnapshotUpdated(harness.getMountedBuild());
			harness.applyRangeEffects();

			expect(
				harness.resolveCardModel.mock.calls.map((call) => call[0].key),
			).toEqual(["item:0", "item:1", "item:2"]);
			expect(harness.frames.isScheduled("idle")).toBe(true);

			harness.frames.drain("idle");
			expect(
				harness.resolveCardModel.mock.calls.map((call) => call[0].key),
			).toEqual([
				"item:0",
				"item:1",
				"item:2",
				"item:3",
				"item:4",
				"item:5",
				"item:6",
				"item:7",
			]);
		} finally {
			harness.dispose();
		}
	});

	it("drops superseded windows before their hydration drains", () => {
		const harness = createHarness({ itemCount: 10 });
		try {
			harness.setVisibleRange(0, 1);
			harness.runtime.scheduleRangeEffects();
			harness.setVisibleRange(6, 7);
			harness.runtime.scheduleRangeEffects();
			harness.frames.drain("post-paint");

			expect(
				harness.resolveCardModel.mock.calls.map((call) => call[0].key),
			).toEqual(["item:5"]);
		} finally {
			harness.dispose();
		}
	});

	it("promotes background cards to post-paint without hydrating them twice", () => {
		const harness = createHarness({ itemCount: 5, previewActive: true });
		try {
			harness.setVisibleRange(1, 2);
			harness.runtime.onSnapshotUpdated(harness.getMountedBuild());
			harness.applyRangeEffects();

			expect(
				harness.resolveCardModel.mock.calls.map((call) => call[0].key),
			).toEqual(["item:0", "item:1"]);
			expect(harness.frames.isScheduled("idle")).toBe(true);

			harness.setVisibleRange(3, 4);
			harness.applyRangeEffects();

			expect(harness.frames.isScheduled("idle")).toBe(false);
			expect(
				harness.resolveCardModel.mock.calls.map((call) => call[0].key),
			).toEqual(["item:0", "item:1", "item:2", "item:3", "item:4"]);
		} finally {
			harness.dispose();
		}
	});

	it("refreshes resident cards when the revision changes", () => {
		const harness = createHarness({ itemCount: 1 });
		try {
			harness.setVisibleRange(1, 2);
			harness.runtime.onSnapshotUpdated(harness.getMountedBuild());
			harness.applyRangeEffects();
			expect(harness.resolveCardModel).toHaveBeenCalledTimes(1);
			expect(harness.resolveCardModel.mock.calls[0]?.[1]).toBe(0);

			harness.setRevision(1);
			harness.runtime.refreshDemand();
			harness.frames.drain("post-paint");
			expect(harness.resolveCardModel).toHaveBeenCalledTimes(2);
			expect(harness.resolveCardModel.mock.calls[1]?.[1]).toBe(1);
		} finally {
			harness.dispose();
		}
	});

	it("bounds retained models and notifies consumers when retained models expire", () => {
		const harness = createHarness({ itemCount: 80 });
		try {
			const consumer = vi.fn();
			harness.runtime.registerCardModelConsumer("item:0", consumer);

			for (let itemIndex = 0; itemIndex < 70; itemIndex += 1) {
				harness.setVisibleRange(itemIndex + 1, itemIndex + 2);
				harness.runtime.scheduleRangeEffects();
				harness.frames.drain("post-paint");
			}

			expect(harness.resolveCardModel.mock.calls.length).toBeGreaterThanOrEqual(
				70,
			);
			expect(consumer).toHaveBeenCalled();
			expect(consumer).toHaveBeenLastCalledWith(undefined);
		} finally {
			harness.dispose();
		}
	});

	it("hydrates only the entering card across 300 rapid scroll frames", () => {
		const harness = createHarness({ itemCount: 1_000 });
		try {
			for (let frame = 0; frame < 300; frame += 1) {
				const rowIndex = frame + 1;
				harness.setVisibleRange(rowIndex, rowIndex + 1);
				harness.runtime.scheduleRangeEffects();
				harness.frames.drain("post-paint");
			}

			expect(harness.resolveCardModel).toHaveBeenCalledTimes(300);
			expect(
				new Set(harness.resolveCardModel.mock.calls.map((call) => call[0].key))
					.size,
			).toBe(300);
		} finally {
			harness.dispose();
		}
	});

	it("reuses preview bindings when only the visible range changes", () => {
		const harness = createHarness({
			itemCount: 4,
			columns: 2,
			previewActive: true,
		});
		try {
			harness.setVisibleRange(0, 2);
			harness.runtime.onSnapshotUpdated(harness.getMountedBuild());
			harness.applyRangeEffects();
			harness.frames.drainAll();
			const initialBindings = harness.publish.mock.calls.at(-1)?.[0].bindings;
			expect(initialBindings).toHaveLength(4);

			harness.setVisibleRange(1, 2);
			harness.applyRangeEffects();

			const nextSnapshot = harness.publish.mock.calls.at(-1)?.[0];
			expect(nextSnapshot?.bindings).toBe(initialBindings);
			expect(nextSnapshot?.visibleRange).toEqual({ start: 1, end: 2 });
		} finally {
			harness.dispose();
		}
	});

	it("rebuilds preview bindings after hydration, resize, mounted-window, and active-state changes", () => {
		let previewEnabled = false;
		const harness = createHarness({
			itemCount: 4,
			columns: 2,
			previewActive: true,
			resolveCardModel: (item) => ({
				...resolveCardModel(item),
				previewRequest: previewEnabled ? createPreviewRequest(0) : null,
			}),
		});
		try {
			harness.setVisibleRange(0, 2);
			harness.runtime.onSnapshotUpdated(harness.getMountedBuild());
			harness.applyRangeEffects();
			harness.frames.drainAll();
			const emptyBindings = harness.publish.mock.calls.at(-1)?.[0].bindings;
			expect(emptyBindings).toHaveLength(0);

			previewEnabled = true;
			harness.setRevision(1);
			harness.runtime.refreshDemand();
			harness.frames.drain("post-paint");
			const hydratedBindings = harness.publish.mock.calls.at(-1)?.[0].bindings;
			expect(hydratedBindings).toHaveLength(4);
			expect(hydratedBindings).not.toBe(emptyBindings);

			harness.setDimensions(140, 140);
			harness.applyRangeEffects();
			const resizedBindings = harness.publish.mock.calls.at(-1)?.[0].bindings;
			expect(resizedBindings).not.toBe(hydratedBindings);

			const movedBuild: MountedTwoHopBuild = {
				...harness.getMountedBuild()!,
				rowsInMountedRange: [...harness.getMountedBuild()!.rowsInMountedRange],
			};
			harness.setMountedBuild(movedBuild);
			harness.runtime.onSnapshotUpdated(movedBuild);
			harness.runtime.scheduleRangeEffects();
			harness.frames.drain("post-paint");
			const movedBindings = harness.publish.mock.calls.at(-1)?.[0].bindings;
			expect(movedBindings).not.toBe(resizedBindings);

			harness.setPreviewActive(false);
			harness.applyRangeEffects();
			expect(harness.publish.mock.calls.at(-1)?.[0].bindings).toHaveLength(0);
		} finally {
			harness.dispose();
		}
	});
});
