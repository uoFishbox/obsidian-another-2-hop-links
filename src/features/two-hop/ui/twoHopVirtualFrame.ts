import type { CardPreviewRequest } from "features/preview/core/cardPreviewRequest";
import type {
	RowPreviewCardBinding,
	RowPreviewWindow,
	PreviewFrame,
} from "features/preview/scheduling/rowPreviewTypes";
import {
	hasContinuousTwoHopPhysicalCellSlot,
	hasSameTwoHopCellPublication,
	type TwoHopMountedCell,
	type TwoHopMountedRow,
	type TwoHopMountedRowsBuild,
} from "features/two-hop/ui/twoHopMountedRows";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";
import type { InteractionDescriptorResolverProvider } from "ui/interactions/interactionRegistry";
import type { SectionedGridMountedCellSlot } from "ui/virtualization/core/reconciliation/mountedSectionedGridRows";
import type { LogicalCellKey, MountedVirtualCell } from "ui/virtualization/types";
import type { VirtualSurfaceMountedRow } from "ui/virtualization/svelte/VirtualSurfaceTypes";
import {
	isSameViewPlanLayout,
	type ViewPlanLayoutMetrics,
} from "ui/virtualization/svelte/viewPlanLayout";

const cellOwnerLeaseBrand: unique symbol = Symbol("CellOwnerLease");
const cellSlotRefBrand: unique symbol = Symbol("CellSlotRef");

/** Opaque identity for one uninterrupted logical ownership period of a cell slot. */
export interface CellOwnerLease {
	readonly [cellOwnerLeaseBrand]: true;
}

/** Opaque identity for one physical cell shell exposed by a committed frame. */
export interface CellSlotRef {
	readonly [cellSlotRefBrand]: true;
	/** Diagnostic coordinate only; consumers must use the object reference as identity. */
	readonly debugIndex: number;
	/** DOM host lookup key. It is not an ownership proof. */
	readonly hostId: string;
}

/**
 * Immutable component-lifecycle specification.
 *
 * Item shells intentionally share this object while a physical slot remains
 * continuous, preserving the virtual surface's allocation-free item recycling.
 */
export interface TwoHopRenderBodySpec {
	readonly kind: "item-shell" | "logical-cell";
	readonly logicalKey?: LogicalCellKey;
}

/** Immutable preview input whose reference proves preview ownership. */
export interface TwoHopPreviewSpec {
	readonly request: CardPreviewRequest;
}

/** Immutable interaction input published by the frame. */
export interface TwoHopInteractionSpec {
	readonly descriptor: ItemInteractionDescriptor;
}

/** Complete immutable binding rendered by one physical cell shell. */
export interface TwoHopCommittedCellBinding extends MountedVirtualCell {
	readonly slot: CellSlotRef;
	readonly owner: CellOwnerLease;
	readonly logicalKey: LogicalCellKey;
	readonly mountedCell: TwoHopMountedCell;
	readonly body: TwoHopRenderBodySpec;
	readonly cardModel: CardRenderModel | null;
	readonly preview: TwoHopPreviewSpec | null;
	readonly interaction: TwoHopInteractionSpec | null;
}

/** Row projection whose cells all belong to the same committed frame. */
export interface TwoHopCommittedRow extends VirtualSurfaceMountedRow<TwoHopCommittedCellBinding> {
	readonly slotIndex: number;
	readonly slotKey: number;
	readonly cells: readonly TwoHopCommittedCellBinding[];
	readonly cellSlots: readonly SectionedGridMountedCellSlot<TwoHopCommittedCellBinding>[];
}

/** One atomic, immutable publication of the TwoHop virtual surface. */
export interface CommittedTwoHopVirtualFrame extends PreviewFrame {
	/** Diagnostics and measurement only. Never use this value for invalidation. */
	readonly sequence: number;
	readonly layout: ViewPlanLayoutMetrics;
	readonly contentHeight: number;
	readonly rowSlots: readonly TwoHopCommittedRow[];
	readonly cellsBySlot: ReadonlyMap<CellSlotRef, TwoHopCommittedCellBinding>;
	readonly interactionsById: ReadonlyMap<string, ItemInteractionDescriptor>;
}

/** Optimization hints derived from two immutable frames. */
export interface TwoHopVirtualFrameDiff {
	readonly ownerEnded: readonly TwoHopCommittedCellBinding[];
	readonly ownerStarted: readonly TwoHopCommittedCellBinding[];
	readonly previewChanged: readonly TwoHopCommittedCellBinding[];
}

interface FrameCompilerMemo {
	readonly bindingIdentity: unknown;
	readonly mountedBuild: TwoHopMountedRowsBuild | null;
}

const compilerMemoByFrame = new WeakMap<
	CommittedTwoHopVirtualFrame,
	FrameCompilerMemo
>();

/** Creates an empty initial publication for a TwoHop virtual surface. */
export function createEmptyTwoHopVirtualFrame(
	layout: ViewPlanLayoutMetrics,
): CommittedTwoHopVirtualFrame {
	const frame: CommittedTwoHopVirtualFrame = Object.freeze({
		sequence: 0,
		layout: Object.freeze({ ...layout }),
		contentHeight: 0,
		rowSlots: Object.freeze([]),
		cellsBySlot: new Map(),
		previewBindingsBySlot: new Map(),
		previewWindow: Object.freeze({
			previewRange: Object.freeze({ start: 0, end: 0 }),
			active: false,
		}),
		interactionsById: new Map(),
	});
	compilerMemoByFrame.set(frame, {
		bindingIdentity: undefined,
		mountedBuild: null,
	});
	return frame;
}

/**
 * Compiles every DOM, preview, and interaction binding without mutating the
 * previously published frame. When only the preview window changed, the stable
 * render publication is reused without visiting mounted cells.
 */
export function compileTwoHopVirtualFrame(params: {
	readonly previous: CommittedTwoHopVirtualFrame;
	readonly mountedBuild: TwoHopMountedRowsBuild | null;
	readonly layout: ViewPlanLayoutMetrics;
	readonly contentHeight?: number;
	readonly previewWindow: RowPreviewWindow;
	readonly bindingIdentity: unknown;
	readonly resolveCardModel: (
		mountedCell: TwoHopMountedCell,
	) => CardRenderModel | undefined;
}): CommittedTwoHopVirtualFrame {
	const contentHeight =
		params.contentHeight ??
		params.mountedBuild?.rowModel.totalHeight ??
		params.previous.contentHeight;
	const previousMemo = compilerMemoByFrame.get(params.previous);
	const layoutUnchanged = isSameViewPlanLayout(params.previous.layout, params.layout);
	const canReuseStablePublication =
		previousMemo?.mountedBuild === params.mountedBuild &&
		previousMemo.bindingIdentity === params.bindingIdentity &&
		layoutUnchanged &&
		params.previous.contentHeight === contentHeight;
	if (canReuseStablePublication) {
		return publishPreviewWindowOnly(params.previous, params.previewWindow);
	}

	const previousBySlotIndex = indexBindingsBySlot(params.previous);
	const canReuseResolvedOutputs =
		previousMemo?.bindingIdentity === params.bindingIdentity;
	const nextBindingsBySlotIndex = new Map<number, TwoHopCommittedCellBinding>();
	const cellsBySlot = new Map<CellSlotRef, TwoHopCommittedCellBinding>();
	const previewBindingsBySlot = new Map<string, RowPreviewCardBinding>();
	const interactionsById = new Map<string, ItemInteractionDescriptor>();

	for (const mountedCell of params.mountedBuild?.cells ?? []) {
		const slotIndex = mountedCell.renderSlotIndex;
		const previous = previousBySlotIndex.get(slotIndex);
		const binding = compileCellBinding({
			previous,
			mountedCell,
			canReuseResolvedOutputs,
			resolveCardModel: params.resolveCardModel,
		});
		nextBindingsBySlotIndex.set(slotIndex, binding);
		cellsBySlot.set(binding.slot, binding);

		if (binding.preview) {
			const previousPreviewBinding = params.previous.previewBindingsBySlot.get(
				binding.slot.hostId,
			);
			const previewBinding =
				previousPreviewBinding?.ownerToken === binding.preview &&
				previousPreviewBinding.rowIndex === binding.rowIndex
					? previousPreviewBinding
					: Object.freeze({
							slotId: binding.slot.hostId,
							rowIndex: binding.rowIndex,
							request: binding.preview.request,
							ownerToken: binding.preview,
						});
			previewBindingsBySlot.set(binding.slot.hostId, previewBinding);
		}
		if (binding.interaction) {
			interactionsById.set(
				binding.interaction.descriptor.interactionId,
				binding.interaction.descriptor,
			);
		}
	}

	const rowSlots = compileRows(
		params.mountedBuild?.occupiedRowsInSlotOrder ?? [],
		nextBindingsBySlotIndex,
		params.previous.rowSlots,
	);
	const layout = layoutUnchanged
		? params.previous.layout
		: Object.freeze({ ...params.layout });
	const previewWindow = reusePreviewWindow(
		params.previous.previewWindow,
		params.previewWindow,
	);
	const frame: CommittedTwoHopVirtualFrame = Object.freeze({
		sequence: params.previous.sequence + 1,
		layout,
		contentHeight,
		rowSlots,
		cellsBySlot,
		previewBindingsBySlot,
		previewWindow,
		interactionsById,
	});
	compilerMemoByFrame.set(frame, {
		bindingIdentity: params.bindingIdentity,
		mountedBuild: params.mountedBuild,
	});

	return frame;
}

/**
 * Computes optional diagnostics for callers that explicitly need to compare
 * two committed publications. The render hot path does not pay this cost.
 */
export function diffTwoHopVirtualFrames(
	previous: CommittedTwoHopVirtualFrame,
	next: CommittedTwoHopVirtualFrame,
): TwoHopVirtualFrameDiff {
	return createFrameDiff(indexBindingsBySlot(previous), indexBindingsBySlot(next));
}

/** Creates a provider that always resolves descriptors from the current frame. */
export function createTwoHopFrameInteractionProvider(
	getCurrentFrame: () => CommittedTwoHopVirtualFrame,
): InteractionDescriptorResolverProvider {
	return {
		resolveInteractionDescriptor(interactionId) {
			return getCurrentFrame().interactionsById.get(interactionId) ?? null;
		},
	};
}

function compileCellBinding(params: {
	readonly previous: TwoHopCommittedCellBinding | undefined;
	readonly mountedCell: TwoHopMountedCell;
	readonly canReuseResolvedOutputs: boolean;
	readonly resolveCardModel: (
		mountedCell: TwoHopMountedCell,
	) => CardRenderModel | undefined;
}): TwoHopCommittedCellBinding {
	const { previous, mountedCell } = params;
	const retainsPhysicalSlot =
		previous !== undefined &&
		hasContinuousTwoHopPhysicalCellSlot(previous.mountedCell, mountedCell);
	const retainsOwner = retainsPhysicalSlot && previous.logicalKey === mountedCell.key;
	const retainsPublication =
		retainsOwner && hasSameTwoHopCellPublication(previous.mountedCell, mountedCell);
	const canReuseOutputs = retainsPublication && params.canReuseResolvedOutputs;

	if (canReuseOutputs && previous.mountedCell === mountedCell) return previous;

	const slot = previous?.slot ?? createCellSlotRef(mountedCell.renderSlotIndex);
	const owner = retainsOwner ? previous.owner : createCellOwnerLease();
	const body = resolveBodySpec(previous, mountedCell, retainsOwner);
	const cardModel = canReuseOutputs
		? previous.cardModel
		: (params.resolveCardModel(mountedCell) ?? null);
	const preview = resolvePreviewSpec(previous, cardModel, canReuseOutputs);
	const interaction = resolveInteractionSpec(previous, cardModel, canReuseOutputs);

	return Object.freeze({
		key: mountedCell.key,
		renderSlotKey: mountedCell.renderSlotKey,
		renderSlotIndex: mountedCell.renderSlotIndex,
		rowIndex: mountedCell.rowIndex,
		columnIndex: mountedCell.columnIndex,
		cellSlotKey: mountedCell.cellSlotKey,
		slot,
		owner,
		logicalKey: mountedCell.key,
		mountedCell,
		body,
		cardModel,
		preview,
		interaction,
	});
}

function resolveBodySpec(
	previous: TwoHopCommittedCellBinding | undefined,
	mountedCell: TwoHopMountedCell,
	retainsOwner: boolean,
): TwoHopRenderBodySpec {
	if (previous?.body.kind === "item-shell" && mountedCell.cell.kind === "item") {
		return previous.body;
	}
	if (retainsOwner && previous) return previous.body;
	if (mountedCell.cell.kind === "item") {
		return Object.freeze({ kind: "item-shell" });
	}
	return Object.freeze({
		kind: "logical-cell",
		logicalKey: mountedCell.key,
	});
}

function resolvePreviewSpec(
	previous: TwoHopCommittedCellBinding | undefined,
	cardModel: CardRenderModel | null,
	canReuseOutputs: boolean,
): TwoHopPreviewSpec | null {
	if (canReuseOutputs) return previous?.preview ?? null;
	const request = cardModel?.previewRequest;
	return request ? Object.freeze({ request }) : null;
}

function resolveInteractionSpec(
	previous: TwoHopCommittedCellBinding | undefined,
	cardModel: CardRenderModel | null,
	canReuseOutputs: boolean,
): TwoHopInteractionSpec | null {
	if (canReuseOutputs) return previous?.interaction ?? null;
	const descriptor = cardModel?.interactionDescriptor;
	return descriptor ? Object.freeze({ descriptor }) : null;
}

function compileRows(
	rows: readonly TwoHopMountedRow[],
	bindingsBySlotIndex: ReadonlyMap<number, TwoHopCommittedCellBinding>,
	previousRows: readonly TwoHopCommittedRow[],
): readonly TwoHopCommittedRow[] {
	const previousRowsBySlot = new Map(
		previousRows.map((row) => [row.slotIndex, row] as const),
	);
	const nextRows = rows.map((row) =>
		compileRow(row, bindingsBySlotIndex, previousRowsBySlot.get(row.slotIndex)),
	);
	return hasSameReferences(previousRows, nextRows)
		? previousRows
		: Object.freeze(nextRows);
}

function compileRow(
	row: TwoHopMountedRow,
	bindingsBySlotIndex: ReadonlyMap<number, TwoHopCommittedCellBinding>,
	previous: TwoHopCommittedRow | undefined,
): TwoHopCommittedRow {
	if (previous && canReuseCommittedRow(previous, row, bindingsBySlotIndex)) {
		return previous;
	}

	const nextCells = row.cells.flatMap((cell) => {
		const binding = bindingsBySlotIndex.get(cell.renderSlotIndex);
		return binding ? [binding] : [];
	});
	const cells =
		previous && hasSameReferences(previous.cells, nextCells)
			? previous.cells
			: Object.freeze(nextCells);
	const nextCellSlots = row.cellSlots.map((cellSlot, index) => {
		const binding = resolveCommittedCellSlotBinding(cellSlot, bindingsBySlotIndex);
		const previousCellSlot = previous?.cellSlots[index];
		if (
			previousCellSlot?.renderSlotIndex === cellSlot.renderSlotIndex &&
			previousCellSlot.renderSlotKey === cellSlot.renderSlotKey &&
			previousCellSlot.columnIndex === cellSlot.columnIndex &&
			previousCellSlot.binding === binding
		) {
			return previousCellSlot;
		}
		return Object.freeze({
			renderSlotIndex: cellSlot.renderSlotIndex,
			renderSlotKey: cellSlot.renderSlotKey,
			columnIndex: cellSlot.columnIndex,
			binding,
		});
	});
	const cellSlots =
		previous && hasSameReferences(previous.cellSlots, nextCellSlots)
			? previous.cellSlots
			: Object.freeze(nextCellSlots);

	return Object.freeze({
		key: row.key,
		rowIndex: row.rowIndex,
		top: row.top,
		slotIndex: row.slotIndex,
		slotKey: row.slotKey,
		cells,
		cellSlots,
	});
}

function canReuseCommittedRow(
	previous: TwoHopCommittedRow,
	row: TwoHopMountedRow,
	bindingsBySlotIndex: ReadonlyMap<number, TwoHopCommittedCellBinding>,
): boolean {
	if (
		previous.key !== row.key ||
		previous.rowIndex !== row.rowIndex ||
		previous.top !== row.top ||
		previous.slotIndex !== row.slotIndex ||
		previous.slotKey !== row.slotKey ||
		previous.cells.length !== row.cells.length ||
		previous.cellSlots.length !== row.cellSlots.length
	) {
		return false;
	}

	for (let index = 0; index < row.cells.length; index += 1) {
		const cell = row.cells[index];
		if (
			!cell ||
			previous.cells[index] !== bindingsBySlotIndex.get(cell.renderSlotIndex)
		) {
			return false;
		}
	}
	for (let index = 0; index < row.cellSlots.length; index += 1) {
		const cellSlot = row.cellSlots[index];
		const previousCellSlot = previous.cellSlots[index];
		if (
			!cellSlot ||
			!previousCellSlot ||
			previousCellSlot.renderSlotIndex !== cellSlot.renderSlotIndex ||
			previousCellSlot.renderSlotKey !== cellSlot.renderSlotKey ||
			previousCellSlot.columnIndex !== cellSlot.columnIndex ||
			previousCellSlot.binding !==
				resolveCommittedCellSlotBinding(cellSlot, bindingsBySlotIndex)
		) {
			return false;
		}
	}
	return true;
}

function resolveCommittedCellSlotBinding(
	cellSlot: SectionedGridMountedCellSlot<TwoHopMountedCell>,
	bindingsBySlotIndex: ReadonlyMap<number, TwoHopCommittedCellBinding>,
): TwoHopCommittedCellBinding | null {
	if (cellSlot.binding === null) return null;
	return bindingsBySlotIndex.get(cellSlot.binding.renderSlotIndex) ?? null;
}

function hasSameReferences<T>(previous: readonly T[], next: readonly T[]): boolean {
	if (previous.length !== next.length) return false;
	for (let index = 0; index < next.length; index += 1) {
		if (previous[index] !== next[index]) return false;
	}
	return true;
}

function indexBindingsBySlot(
	frame: CommittedTwoHopVirtualFrame,
): Map<number, TwoHopCommittedCellBinding> {
	const result = new Map<number, TwoHopCommittedCellBinding>();
	for (const binding of frame.cellsBySlot.values()) {
		result.set(binding.slot.debugIndex, binding);
	}
	return result;
}

function reusePreviewWindow(
	previous: RowPreviewWindow,
	next: RowPreviewWindow,
): RowPreviewWindow {
	if (
		previous.active === next.active &&
		previous.previewRange.start === next.previewRange.start &&
		previous.previewRange.end === next.previewRange.end
	) {
		return previous;
	}
	return Object.freeze({
		active: next.active,
		previewRange: Object.freeze({
			start: next.previewRange.start,
			end: next.previewRange.end,
		}),
	});
}

function publishPreviewWindowOnly(
	previous: CommittedTwoHopVirtualFrame,
	nextWindow: RowPreviewWindow,
): CommittedTwoHopVirtualFrame {
	const previewWindow = reusePreviewWindow(previous.previewWindow, nextWindow);
	if (previewWindow === previous.previewWindow) return previous;

	const frame: CommittedTwoHopVirtualFrame = Object.freeze({
		sequence: previous.sequence + 1,
		layout: previous.layout,
		contentHeight: previous.contentHeight,
		rowSlots: previous.rowSlots,
		cellsBySlot: previous.cellsBySlot,
		previewBindingsBySlot: previous.previewBindingsBySlot,
		previewWindow,
		interactionsById: previous.interactionsById,
	});
	const previousMemo = compilerMemoByFrame.get(previous);
	if (previousMemo) compilerMemoByFrame.set(frame, previousMemo);
	return frame;
}

function createFrameDiff(
	previousBySlot: ReadonlyMap<number, TwoHopCommittedCellBinding>,
	nextBySlot: ReadonlyMap<number, TwoHopCommittedCellBinding>,
): TwoHopVirtualFrameDiff {
	const ownerEnded: TwoHopCommittedCellBinding[] = [];
	const ownerStarted: TwoHopCommittedCellBinding[] = [];
	const previewChanged: TwoHopCommittedCellBinding[] = [];
	const slotIndices = new Set([...previousBySlot.keys(), ...nextBySlot.keys()]);

	for (const slotIndex of slotIndices) {
		const previous = previousBySlot.get(slotIndex);
		const next = nextBySlot.get(slotIndex);
		if (previous?.owner !== next?.owner) {
			if (previous) ownerEnded.push(previous);
			if (next) ownerStarted.push(next);
		}
		if (previous?.preview !== next?.preview) {
			const changed = next ?? previous;
			if (changed) previewChanged.push(changed);
		}
	}

	return {
		ownerEnded: Object.freeze(ownerEnded),
		ownerStarted: Object.freeze(ownerStarted),
		previewChanged: Object.freeze(previewChanged),
	};
}

function createCellSlotRef(debugIndex: number): CellSlotRef {
	return Object.freeze({
		[cellSlotRefBrand]: true as const,
		debugIndex,
		hostId: String(debugIndex),
	});
}

function createCellOwnerLease(): CellOwnerLease {
	return Object.freeze({ [cellOwnerLeaseBrand]: true as const });
}
