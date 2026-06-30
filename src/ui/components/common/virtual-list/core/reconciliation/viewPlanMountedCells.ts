import type { SectionRenderDescriptor } from "../../../../sections/types";
import type { VirtualListLogicalCell } from "../../logicalCell";
import type { RenderBodyKey, RenderRevisionFallbackPolicy } from "../../renderRevision";
import {
	logicalCellKey,
	renderSlotKey,
	type LogicalCellKey,
	type RenderSlotKey,
} from "../../types";
import {
	getViewPlanRenderBodyIdentityFields,
	resolveStableViewPlanRenderBodyKey,
	type MountedRenderBodyIdentity,
} from "./renderBodyRevision";
import type { FlatRow, SectionLayout } from "../../layout/viewPlanRowTypes";

type HeaderProps<T, G> = SectionRenderDescriptor<T, G>["headerProps"];
type HeaderLogicalCell<T> = Extract<VirtualListLogicalCell<T>, { kind: "header" }>;
type ItemLogicalCell<T> = Extract<VirtualListLogicalCell<T>, { kind: "item" }>;
type LoadMoreLogicalCell<T> = Extract<VirtualListLogicalCell<T>, { kind: "load-more" }>;

export interface MountedFlatCellPosition {
	readonly row: number;
	readonly column: number;
	readonly top: number;
	readonly left: number;
	readonly width: number;
	readonly height: number;
}

interface MountedFlatCellBase<T> extends MountedRenderBodyIdentity {
	readonly key: LogicalCellKey;
	readonly logicalKey: LogicalCellKey;
	readonly renderSlotIndex: number;
	readonly renderSlotKey: RenderSlotKey;
	readonly cell: VirtualListLogicalCell<T>;
	readonly rowIndex: number;
	readonly rowIndexInSection: number;
	readonly columnIndex: number;
	readonly rowTop: number;
	readonly sectionId: string;
	readonly cellMetadataKey?: unknown;
	readonly renderBodyKey?: RenderBodyKey;
	readonly position?: MountedFlatCellPosition;
	readonly cellSlotKey?: number;
}

export interface MountedFlatHeaderCell<T, G> extends MountedFlatCellBase<T> {
	readonly cell: HeaderLogicalCell<T>;
	readonly section: G;
	readonly title: string;
	readonly totalCount: number;
	readonly headerProps: HeaderProps<T, G>;
}

export interface MountedFlatItemCell<T, G> extends MountedFlatCellBase<T> {
	readonly cell: ItemLogicalCell<T>;
	readonly section: G;
}

export interface MountedFlatLoadMoreCell<T, G> extends MountedFlatCellBase<T> {
	readonly cell: LoadMoreLogicalCell<T>;
	readonly section: G;
}

export type MountedFlatCell<T, G> =
	| MountedFlatHeaderCell<T, G>
	| MountedFlatItemCell<T, G>
	| MountedFlatLoadMoreCell<T, G>;

type MountedFlatCellUpdate<T> = Pick<
	MountedFlatCellBase<T>,
	| "rowIndex"
	| "rowIndexInSection"
	| "columnIndex"
	| "rowTop"
	| "renderSlotIndex"
	| "renderSlotKey"
	| keyof MountedRenderBodyIdentity
> &
	Partial<
		Pick<
			MountedFlatCellBase<T>,
			"cellMetadataKey" | "renderBodyKey" | "position" | "cellSlotKey"
		>
	>;

export function canReuseMountedFlatCellContent<T, G>(
	previous: MountedFlatCell<T, G> | undefined,
	cell: VirtualListLogicalCell<T>,
	section: SectionLayout<T, G>,
): previous is MountedFlatCell<T, G> {
	if (
		!previous ||
		previous.cell.kind !== cell.kind ||
		previous.cell.key !== cell.key ||
		previous.sectionId !== section.descriptor.sectionId
	) {
		return false;
	}

	if (previous.cell.kind === "header" && cell.kind === "header") {
		const headerCell = previous as MountedFlatHeaderCell<T, G>;
		return (
			headerCell.section === section.descriptor.section &&
			headerCell.title === section.descriptor.title &&
			headerCell.totalCount === section.descriptor.totalCount &&
			headerCell.headerProps === section.descriptor.headerProps
		);
	}

	if (previous.cell.kind === "item" && cell.kind === "item") {
		const itemCell = previous as MountedFlatItemCell<T, G>;
		return (
			previous.cell.itemIndex === cell.itemIndex &&
			previous.cell.item === cell.item &&
			Object.is(previous.cell.itemRenderRevision, cell.itemRenderRevision) &&
			itemCell.section === section.descriptor.section
		);
	}

	if (previous.cell.kind === "load-more" && cell.kind === "load-more") {
		const loadMoreCell = previous as MountedFlatLoadMoreCell<T, G>;
		return loadMoreCell.section === section.descriptor.section;
	}

	return true;
}

function updateMountedFlatCellDiscriminated<T, G>(
	previous: MountedFlatCell<T, G>,
	cell: VirtualListLogicalCell<T>,
	update: MountedFlatCellUpdate<T>,
): MountedFlatCell<T, G> {
	// Direct construction without spreading `previous`.
	// Fields that don't change are read directly from `previous`.
	const commonBase = {
		key: previous.key,
		logicalKey: previous.logicalKey,
		rowIndex: update.rowIndex,
		rowIndexInSection: update.rowIndexInSection,
		columnIndex: update.columnIndex,
		rowTop: update.rowTop,
		sectionId: previous.sectionId,
		renderSlotIndex: update.renderSlotIndex,
		renderSlotKey: update.renderSlotKey,
		cellMetadataKey: previous.cellMetadataKey,
		renderBodyKey: update.renderBodyKey ?? previous.renderBodyKey,
		position: update.position,
		cellSlotKey: update.cellSlotKey ?? previous.cellSlotKey,
		renderBodyKind: update.renderBodyKind,
		renderBodySectionId: update.renderBodySectionId,
		renderBodySourceKey: update.renderBodySourceKey,
		renderBodyCellKey: update.renderBodyCellKey,
		renderBodyRevision: update.renderBodyRevision,
	};

	switch (cell.kind) {
		case "header": {
			const prev = previous as MountedFlatHeaderCell<T, G>;
			return {
				...commonBase,
				cell,
				section: prev.section,
				title: prev.title,
				totalCount: prev.totalCount,
				headerProps: prev.headerProps,
			};
		}
		case "item": {
			const prev = previous as MountedFlatItemCell<T, G>;
			return {
				...commonBase,
				cell,
				section: prev.section,
			};
		}
		case "load-more": {
			const prev = previous as MountedFlatLoadMoreCell<T, G>;
			return {
				...commonBase,
				cell,
				section: prev.section,
			};
		}
	}
}

export function updateMountedFlatCell<T, G>(params: {
	previous: MountedFlatCell<T, G>;
	cell: VirtualListLogicalCell<T>;
	rowIndex: number;
	columnIndex: number;
	row: FlatRow<T, G>;
	section: SectionLayout<T, G>;
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy;
	renderSlotIndex?: number;
	cellSlotKey?: number;
}): MountedFlatCell<T, G> {
	const renderSlotIndex = params.renderSlotIndex ?? params.previous.renderSlotIndex;
	const renderBodyKey = resolveStableViewPlanRenderBodyKey({
		previous: params.previous,
		cell: params.cell,
		descriptor: params.section.descriptor,
		fallbackPolicy: params.renderRevisionFallbackPolicy,
	});
	const hasSameLayoutMetadata =
		params.previous.rowIndex === params.rowIndex &&
		params.previous.rowIndexInSection === params.row.rowIndexInSection &&
		params.previous.columnIndex === params.columnIndex &&
		params.previous.rowTop === params.row.top &&
		params.previous.renderSlotIndex === renderSlotIndex &&
		params.previous.position === undefined;
	if (hasSameLayoutMetadata && params.previous.renderBodyKey === renderBodyKey) {
		return params.previous;
	}

	const identity = getViewPlanRenderBodyIdentityFields(
		params.cell,
		params.section.descriptor,
		params.renderRevisionFallbackPolicy,
	);
	return updateMountedFlatCellDiscriminated(params.previous, params.cell, {
		rowIndex: params.rowIndex,
		rowIndexInSection: params.row.rowIndexInSection,
		columnIndex: params.columnIndex,
		rowTop: params.row.top,
		renderSlotIndex,
		renderSlotKey: renderSlotKey(renderSlotIndex),
		renderBodyKey,
		cellSlotKey: params.cellSlotKey,
		position: undefined,
		renderBodyKind: identity.renderBodyKind,
		renderBodySectionId: identity.renderBodySectionId,
		renderBodySourceKey: identity.renderBodySourceKey,
		renderBodyCellKey: identity.renderBodyCellKey,
		renderBodyRevision: identity.renderBodyRevision,
	});
}

export function createMountedFlatCell<T, G>(params: {
	key: LogicalCellKey;
	cell: VirtualListLogicalCell<T>;
	row: FlatRow<T, G>;
	section: SectionLayout<T, G>;
	rowIndex: number;
	columnIndex: number;
	renderSlotIndex: number;
	position?: MountedFlatCellPosition;
	renderBodyKey: RenderBodyKey;
	renderBodyIdentity: MountedRenderBodyIdentity;
	cellSlotKey?: number;
}): MountedFlatCell<T, G> {
	// Direct construction without intermediate `base` object or spread.
	// All optional fields are always present (as undefined when unused)
	// to stabilise the object shape for V8 hidden classes.
	const key = logicalCellKey(params.key);
	const identity = params.renderBodyIdentity;
	const descriptor = params.section.descriptor;
	const commonBase = {
		key,
		logicalKey: key,
		rowIndex: params.rowIndex,
		rowIndexInSection: params.row.rowIndexInSection,
		columnIndex: params.columnIndex,
		rowTop: params.row.top,
		sectionId: descriptor.sectionId,
		renderSlotIndex: params.renderSlotIndex,
		renderSlotKey: renderSlotKey(params.renderSlotIndex),
		cellMetadataKey: undefined as unknown,
		renderBodyKey: params.renderBodyKey,
		position: params.position,
		cellSlotKey: params.cellSlotKey,
		renderBodyKind: identity.renderBodyKind,
		renderBodySectionId: identity.renderBodySectionId,
		renderBodySourceKey: identity.renderBodySourceKey,
		renderBodyCellKey: identity.renderBodyCellKey,
		renderBodyRevision: identity.renderBodyRevision,
	};

	switch (params.cell.kind) {
		case "header":
			return {
				...commonBase,
				cell: params.cell,
				section: descriptor.section,
				title: descriptor.title,
				totalCount: descriptor.totalCount,
				headerProps: descriptor.headerProps,
			};
		case "item":
			return {
				...commonBase,
				cell: params.cell,
				section: descriptor.section,
			};
		case "load-more":
			return {
				...commonBase,
				cell: params.cell,
				section: descriptor.section,
			};
	}
}
