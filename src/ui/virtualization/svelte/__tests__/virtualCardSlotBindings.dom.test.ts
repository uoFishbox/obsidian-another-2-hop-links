import type { TFile } from "obsidian";
import { describe, expect, it, vi, type MockedFunction } from "vitest";
import type { CardPreviewSnapshot } from "features/preview/ui/cardPreviewSnapshot";
import type { VirtualPreviewSurface } from "features/preview/scheduling/virtualPreviewSurface";
import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";
import { createVirtualCardInteractionController } from "ui/interactions/virtualCardInteractionController";
import { createVirtualCardSlotBindings } from "ui/virtualization/svelte/virtualCardSlotBindings.svelte";
import type {
	ResidentSlotLeaseToken,
	ResidentSlotPoolId,
} from "ui/virtualization/core/residentSlotBinding";
import {
	logicalCellKey,
	renderSlotKey,
	type MountedVirtualCell,
} from "ui/virtualization/types";

interface TestMountedCell extends MountedVirtualCell {
	readonly label: string;
	readonly publicationRevision: number;
	readonly slotLease: ResidentSlotLeaseToken;
}

const TEST_POOL_ID = Object.freeze({}) as ResidentSlotPoolId;

function createMountedCell(
	slotIndex: number,
	rowIndex: number,
	label: string,
	publicationRevision = 1,
): TestMountedCell {
	return {
		key: logicalCellKey(label),
		renderSlotKey: renderSlotKey(slotIndex),
		renderSlotIndex: slotIndex,
		cellSlotKey: slotIndex,
		rowIndex,
		columnIndex: 0,
		label,
		publicationRevision,
		slotLease: Object.freeze({
			poolId: TEST_POOL_ID,
			poolEpoch: 0,
			slotIndex,
			slotGeneration: rowIndex + 1,
		}),
	};
}

function createPreview(identity: string): CardPreviewSnapshot {
	return {
		identity,
		file: { path: `${identity}.md` } as TFile,
		searchQuery: "",
		previewRefreshToken: 0,
		previewOverride: null,
	};
}

function createInteraction(interactionId: string): ItemInteractionDescriptor {
	return {
		interactionId,
		kind: "item",
		item: {
			type: "file",
			data: { path: `${interactionId}.md` } as TFile,
		},
		targetFile: null,
	};
}

type TestPreviewSurface = Omit<VirtualPreviewSurface, "commitBindingDelta"> & {
	readonly commitBindingDelta: MockedFunction<
		VirtualPreviewSurface["commitBindingDelta"]
	>;
};

function createPreviewSurface(): TestPreviewSurface {
	return {
		registerHost: () => ({ dispose() {} }),
		syncBindingDelta: vi.fn(),
		setPreviewWindow: vi.fn(),
		commitBindingDelta: vi.fn<VirtualPreviewSurface["commitBindingDelta"]>(),
		dispose: vi.fn(),
	};
}

describe("virtualCardSlotBindings", () => {
	it("publishes shell, preview, and interaction from one slot binding", () => {
		const previewSurface = createPreviewSurface();
		const interactionController = createVirtualCardInteractionController();
		const resolver = vi.fn((mountedCell: TestMountedCell) => ({
			mountedCell,
			cardModel: mountedCell.label,
			preview: createPreview(mountedCell.label),
			interaction: createInteraction(mountedCell.label),
		}));
		const bindings = createVirtualCardSlotBindings({
			previewSurface,
			interactionController,
			resolveSlotLease: (mountedCell) => mountedCell.slotLease,
			resolvePublicationRevision: (mountedCell) =>
				mountedCell.publicationRevision,
			resolveBinding: resolver,
		});
		const initial = createMountedCell(0, 2, "initial");

		bindings.sync({
			mountedCells: [initial],
			bindingIdentity: resolver,
			previewWindow: { previewRange: { start: 2, end: 3 }, active: true },
		});

		expect(bindings.getSlotState(initial)?.binding).toMatchObject({
			mountedCell: initial,
			cardModel: "initial",
		});
		const initialToken = bindings.getSlotState(initial)?.binding?.bindingToken;
		expect(
			interactionController.provider.resolveInteractionDescriptor("initial"),
		).toBeTruthy();
		expect(previewSurface.commitBindingDelta).toHaveBeenLastCalledWith(
			expect.objectContaining({
				enteredSlots: [expect.objectContaining({ slotId: "0", rowIndex: 2 })],
			}),
			{ previewRange: { start: 2, end: 3 }, active: true },
		);

		const rebound = createMountedCell(0, 3, "rebound");
		bindings.sync({
			mountedCells: [rebound],
			bindingIdentity: resolver,
			previewWindow: { previewRange: { start: 3, end: 4 }, active: true },
		});

		expect(bindings.getSlotState(initial)).toBeUndefined();
		expect(bindings.getSlotState(rebound)?.binding?.cardModel).toBe("rebound");
		expect(
			bindings.getSlotState(rebound)?.binding?.bindingToken.slotGeneration,
		).toBeGreaterThan(initialToken?.slotGeneration ?? 0);
		expect(
			interactionController.provider.resolveInteractionDescriptor("initial"),
		).toBeNull();
		expect(
			interactionController.provider.resolveInteractionDescriptor("rebound"),
		).toBeTruthy();

		bindings.sync({
			mountedCells: [],
			bindingIdentity: resolver,
			previewWindow: { previewRange: { start: 0, end: 0 }, active: false },
		});

		expect(bindings.getSlotState(rebound)).toBeUndefined();
		expect(
			interactionController.provider.resolveInteractionDescriptor("rebound"),
		).toBeNull();
		expect(previewSurface.commitBindingDelta).toHaveBeenLastCalledWith(
			expect.objectContaining({
				releasedSlots: ["0"],
			}),
			{ previewRange: { start: 0, end: 0 }, active: false },
		);
	});

	it("reuses an unchanged slot while still publishing the preview window", () => {
		const previewSurface = createPreviewSurface();
		const resolver = vi.fn((mountedCell: TestMountedCell) => ({
			mountedCell,
			cardModel: mountedCell.label,
		}));
		const bindings = createVirtualCardSlotBindings({
			previewSurface,
			interactionController: createVirtualCardInteractionController(),
			resolveSlotLease: (mountedCell) => mountedCell.slotLease,
			resolvePublicationRevision: (mountedCell) =>
				mountedCell.publicationRevision,
			resolveBinding: resolver,
		});
		const mountedCell = createMountedCell(0, 0, "retained");
		const sync = (active: boolean) =>
			bindings.sync({
				mountedCells: [mountedCell],
				bindingIdentity: resolver,
				previewWindow: {
					previewRange: { start: 0, end: 1 },
					active,
				},
			});

		sync(true);
		sync(false);

		expect(resolver).toHaveBeenCalledTimes(1);
		expect(previewSurface.commitBindingDelta).toHaveBeenCalledTimes(2);
		expect(previewSurface.commitBindingDelta).toHaveBeenLastCalledWith(
			{ enteredSlots: [], reboundSlots: [], releasedSlots: [] },
			{ previewRange: { start: 0, end: 1 }, active: false },
		);
	});

	it("updates the preview window without reconciling unchanged bindings", () => {
		const previewSurface = createPreviewSurface();
		const resolver = vi.fn((mountedCell: TestMountedCell) => ({
			mountedCell,
			cardModel: mountedCell.label,
		}));
		const bindings = createVirtualCardSlotBindings({
			previewSurface,
			interactionController: createVirtualCardInteractionController(),
			resolveSlotLease: (mountedCell) => mountedCell.slotLease,
			resolvePublicationRevision: (mountedCell) =>
				mountedCell.publicationRevision,
			resolveBinding: resolver,
		});
		const mountedCell = createMountedCell(0, 0, "retained");

		bindings.sync({
			mountedCells: [mountedCell],
			bindingIdentity: resolver,
			previewWindow: {
				previewRange: { start: 0, end: 1 },
				active: true,
			},
		});
		bindings.syncPreviewWindow({
			previewRange: { start: 0, end: 1 },
			active: true,
		});
		bindings.syncPreviewWindow({
			previewRange: { start: 0, end: 1 },
			active: false,
		});

		expect(resolver).toHaveBeenCalledTimes(1);
		expect(previewSurface.setPreviewWindow).toHaveBeenCalledTimes(2);
		expect(previewSurface.commitBindingDelta).toHaveBeenCalledTimes(1);
	});

	it("refreshes a same-key binding when its publication revision changes", () => {
		const resolver = vi.fn((mountedCell: TestMountedCell) => ({
			mountedCell,
			cardModel: `${mountedCell.label}:${mountedCell.publicationRevision}`,
		}));
		const bindings = createVirtualCardSlotBindings({
			previewSurface: createPreviewSurface(),
			interactionController: createVirtualCardInteractionController(),
			resolveSlotLease: (mountedCell) => mountedCell.slotLease,
			resolvePublicationRevision: (mountedCell) =>
				mountedCell.publicationRevision,
			resolveBinding: resolver,
		});
		const initial = createMountedCell(0, 0, "retained", 1);
		bindings.sync({
			mountedCells: [initial],
			bindingIdentity: resolver,
			previewWindow: { previewRange: { start: 0, end: 1 }, active: true },
		});
		const initialToken = bindings.getSlotState(initial)?.binding?.bindingToken;
		const refreshed = createMountedCell(0, 0, "retained", 2);

		bindings.sync({
			mountedCells: [refreshed],
			bindingIdentity: resolver,
			previewWindow: { previewRange: { start: 0, end: 1 }, active: true },
		});

		expect(resolver).toHaveBeenCalledTimes(2);
		expect(bindings.getSlotState(initial)).toBeUndefined();
		expect(bindings.getSlotState(refreshed)?.binding).toMatchObject({
			mountedCell: refreshed,
			cardModel: "retained:2",
		});
		expect(bindings.getSlotState(refreshed)?.binding?.bindingToken).toBe(
			initialToken,
		);
	});

	it("rebinds preview and interaction when the logical owner changes", () => {
		const previewSurface = createPreviewSurface();
		const interactionController = createVirtualCardInteractionController();
		const resolver = vi.fn((mountedCell: TestMountedCell) => ({
			mountedCell,
			cardModel: `model:${mountedCell.label}`,
			preview: createPreview(mountedCell.label),
			interaction: createInteraction(mountedCell.label),
		}));
		const bindings = createVirtualCardSlotBindings({
			previewSurface,
			interactionController,
			resolveSlotLease: (mountedCell) => mountedCell.slotLease,
			resolvePublicationRevision: (mountedCell) =>
				mountedCell.publicationRevision,
			resolveBinding: resolver,
		});
		const loadMore = createMountedCell(0, 0, "load-more");
		bindings.sync({
			mountedCells: [loadMore],
			bindingIdentity: resolver,
			previewWindow: { previewRange: { start: 0, end: 1 }, active: true },
		});
		const item = createMountedCell(0, 0, "item:1");

		bindings.sync({
			mountedCells: [item],
			bindingIdentity: resolver,
			previewWindow: { previewRange: { start: 0, end: 1 }, active: true },
		});

		expect(resolver).toHaveBeenCalledTimes(2);
		expect(bindings.getSlotState(item)?.binding?.cardModel).toBe("model:item:1");
		expect(previewSurface.commitBindingDelta).toHaveBeenLastCalledWith(
			expect.objectContaining({
				reboundSlots: [
					expect.objectContaining({
						slotId: "0",
						snapshot: expect.objectContaining({ identity: "item:1" }),
					}),
				],
			}),
			{ previewRange: { start: 0, end: 1 }, active: true },
		);
		expect(
			interactionController.provider.resolveInteractionDescriptor("load-more"),
		).toBeNull();
		expect(
			interactionController.provider.resolveInteractionDescriptor("item:1"),
		).toBeTruthy();
	});

	it("keeps the slot lease for a resolver-only refresh", () => {
		const bindings = createVirtualCardSlotBindings({
			previewSurface: createPreviewSurface(),
			interactionController: createVirtualCardInteractionController(),
			resolveSlotLease: (mountedCell) => mountedCell.slotLease,
			resolvePublicationRevision: (mountedCell) =>
				mountedCell.publicationRevision,
			resolveBinding: (mountedCell: TestMountedCell, revision: number) => ({
				mountedCell,
				cardModel: `${mountedCell.label}:${revision}`,
			}),
		});
		const initial = createMountedCell(0, 0, "retained");
		bindings.sync({
			mountedCells: [initial],
			bindingIdentity: 1,
			previewWindow: { previewRange: { start: 0, end: 1 }, active: true },
		});
		const initialToken = bindings.getSlotState(initial)?.binding?.bindingToken;
		const refreshed = createMountedCell(0, 0, "retained");

		bindings.sync({
			mountedCells: [refreshed],
			bindingIdentity: 2,
			previewWindow: { previewRange: { start: 0, end: 1 }, active: true },
		});

		expect(bindings.getSlotState(refreshed)?.binding?.bindingToken).toBe(
			initialToken,
		);
		expect(bindings.getSlotState(refreshed)?.binding?.cardModel).toBe("retained:2");
	});
});
