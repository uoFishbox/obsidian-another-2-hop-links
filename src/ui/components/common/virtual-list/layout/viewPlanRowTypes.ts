import type { SectionRenderDescriptor } from "../../../sections/types";
import type { RowKey } from "../rowKey";
export interface FlatRow<T, G> {
	readonly __type?: readonly [T, G];
	sectionIndex: number;
	key: RowKey;
	rowIndexInSection: number;
	cellStartIndex: number;
	rowCellCount: number;
	top: number;
	bottomSpacing: number;
}

export interface RowNumberLookup {
	readonly length: number;
	readonly [index: number]: number;
	[Symbol.iterator](): IterableIterator<number>;
}

export interface SectionStructure {
	sectionIndex: number;
	sectionId: string;
	visibleCount: number;
	showLoadMore: boolean;
	cellCount: number;
	rowCount: number;
	contentHeight: number;
	blockHeight: number;
	sectionTop: number;
}

export interface ResolvedSection<T, G> extends SectionStructure {
	descriptor: SectionRenderDescriptor<T, G>;
}

export type SectionLayout<T, G> = ResolvedSection<T, G>;
