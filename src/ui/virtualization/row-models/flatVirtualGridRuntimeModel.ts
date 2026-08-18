import {
	createFlatLogicalCellSource,
	type FlatLogicalCellSource,
} from "../flatLogicalCellSource";
import type { FlatGridLayoutMetrics } from "../layoutMetrics";
import type { RenderRevision } from "../renderRevision";
import { createFlatLinkRowModel, type FlatLinkRowModel } from "./flatLinkRowModel";
import { resolveVirtualListKeyRevision } from "./virtualListKeyRevision";

interface FlatListBindingTopologyRevision {
	readonly data: unknown;
	readonly key: unknown;
	readonly hasHeader: boolean;
	readonly sectionId?: string;
}

interface FlatListContentRevision {
	readonly data: unknown;
	readonly key: unknown;
	readonly itemRender: unknown;
	readonly visibleCount: number;
	readonly hasHeader: boolean;
	readonly showLoadMore: boolean;
	readonly sectionId?: string;
}

type FlatGridLayoutMemoKey = readonly [
	columns: number,
	cellWidth: number,
	rowHeight: number,
	gap: number,
	rowCount: number,
];

interface FlatListBindingTopologyMemoEntry {
	readonly revision: FlatListBindingTopologyRevision;
}

interface LogicalCellSourceMemoEntry<T> {
	readonly revision: FlatListContentRevision;
	readonly source: FlatLogicalCellSource<T>;
}

interface FlatLinkRowModelMemoEntry<T> {
	readonly cellSourceRevision: unknown;
	readonly layoutMemoKey: FlatGridLayoutMemoKey;
	readonly rowModel: FlatLinkRowModel<T>;
}

function createFlatListContentRevision(params: {
	dataRevision: unknown;
	keyRevision: unknown;
	itemRenderRevision: unknown;
	visibleCount: number;
	hasHeader: boolean;
	showLoadMore: boolean;
	sectionId?: string;
}): FlatListContentRevision {
	return {
		data: params.dataRevision,
		key: params.keyRevision,
		itemRender: params.itemRenderRevision,
		visibleCount: params.visibleCount,
		hasHeader: params.hasHeader,
		showLoadMore: params.showLoadMore,
		sectionId: params.sectionId,
	};
}

function hasSameFlatListContentRevision(
	current: FlatListContentRevision,
	next: FlatListContentRevision,
): boolean {
	return (
		Object.is(current.data, next.data) &&
		Object.is(current.key, next.key) &&
		Object.is(current.itemRender, next.itemRender) &&
		current.visibleCount === next.visibleCount &&
		current.hasHeader === next.hasHeader &&
		current.showLoadMore === next.showLoadMore &&
		current.sectionId === next.sectionId
	);
}

function createFlatListBindingTopologyRevision(params: {
	dataRevision: unknown;
	keyRevision: unknown;
	hasHeader: boolean;
	sectionId?: string;
}): FlatListBindingTopologyRevision {
	return {
		data: params.dataRevision,
		key: params.keyRevision,
		hasHeader: params.hasHeader,
		sectionId: params.sectionId,
	};
}

function hasSameFlatListBindingTopologyRevision(
	current: FlatListBindingTopologyRevision,
	next: FlatListBindingTopologyRevision,
): boolean {
	return (
		Object.is(current.data, next.data) &&
		Object.is(current.key, next.key) &&
		current.hasHeader === next.hasHeader &&
		current.sectionId === next.sectionId
	);
}

function createFlatGridLayoutMemoKey(
	layout: FlatGridLayoutMetrics,
): FlatGridLayoutMemoKey {
	return [
		layout.columns,
		layout.cellWidth,
		layout.rowHeight,
		layout.gap,
		layout.rowCount,
	];
}

function hasSameFlatGridLayoutMemoKey(
	current: FlatGridLayoutMemoKey,
	next: FlatGridLayoutMemoKey,
): boolean {
	return current.every((value, index) => Object.is(value, next[index]));
}

/**
 * Keeps one logical-source memo and one row-model memo per list instance.
 * Callers mutating an items array in place must change itemsRevision. Callers
 * changing item-id behavior without replacing getItemId must change itemIdRevision.
 */
export function createFlatVirtualGridRuntimeModel<T>() {
	let bindingTopologyMemo: FlatListBindingTopologyMemoEntry | null = null;
	let logicalCellSourceMemo: LogicalCellSourceMemoEntry<T> | null = null;
	let rowModelMemo: FlatLinkRowModelMemoEntry<T> | null = null;

	return {
		resolveLogicalCellSource(params: {
			items: readonly T[];
			getItemId: (item: T, index: number) => string;
			itemsRevision?: unknown;
			itemIdRevision?: unknown;
			itemRenderRevisionToken?: RenderRevision;
			getItemRenderRevision?: (
				item: T,
				index: number,
			) => RenderRevision | undefined;
			visibleCount: number;
			hasHeader: boolean;
			showLoadMore: boolean;
			sectionId?: string;
		}): FlatLogicalCellSource<T> {
			const itemIdRevision = resolveVirtualListKeyRevision({
				explicitRevision: params.itemIdRevision,
				resolver: params.getItemId,
			});
			const dataRevision = params.itemsRevision ?? params.items;
			const nextBindingTopologyRevision = createFlatListBindingTopologyRevision({
				dataRevision,
				keyRevision: itemIdRevision,
				hasHeader: params.hasHeader,
				sectionId: params.sectionId,
			});
			if (
				!bindingTopologyMemo ||
				!hasSameFlatListBindingTopologyRevision(
					bindingTopologyMemo.revision,
					nextBindingTopologyRevision,
				)
			) {
				bindingTopologyMemo = {
					revision: nextBindingTopologyRevision,
				};
			}
			const bindingTopologyRevision = bindingTopologyMemo.revision;
			const revision = createFlatListContentRevision({
				dataRevision,
				keyRevision: itemIdRevision,
				itemRenderRevision:
					params.itemRenderRevisionToken ?? params.getItemRenderRevision,
				visibleCount: params.visibleCount,
				hasHeader: params.hasHeader,
				showLoadMore: params.showLoadMore,
				sectionId: params.sectionId,
			});
			const memo = logicalCellSourceMemo;
			if (memo && hasSameFlatListContentRevision(memo.revision, revision)) {
				return memo.source;
			}

			const source = createFlatLogicalCellSource({
				header: params.hasHeader,
				items: params.items,
				getItemId: params.getItemId,
				getItemRenderRevision: params.getItemRenderRevision,
				visibleCount: params.visibleCount,
				showLoadMore: params.showLoadMore,
				sectionId: params.sectionId,
				revision,
				bindingTopologyRevision,
			});
			logicalCellSourceMemo = {
				revision,
				source,
			};
			return source;
		},

		resolveRowModel(params: {
			cellSource: FlatLogicalCellSource<T>;
			layout: FlatGridLayoutMetrics;
		}): FlatLinkRowModel<T> {
			const layoutMemoKey = createFlatGridLayoutMemoKey(params.layout);
			const memo = rowModelMemo;
			if (
				memo &&
				Object.is(memo.cellSourceRevision, params.cellSource.revision) &&
				hasSameFlatGridLayoutMemoKey(memo.layoutMemoKey, layoutMemoKey)
			) {
				return memo.rowModel;
			}

			const rowModel = createFlatLinkRowModel({
				cellSource: params.cellSource,
				layout: params.layout,
			});
			rowModelMemo = {
				cellSourceRevision: params.cellSource.revision,
				layoutMemoKey,
				rowModel,
			};
			return rowModel;
		},
	};
}
