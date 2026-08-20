import type { Snippet } from "svelte";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { InteractionDescriptorResolverProvider } from "ui/interactions/interactionRegistry";
import type {
	MountedVirtualCell,
	VirtualNavigationTarget,
} from "ui/virtualization/public";
import type { ProgrammaticScrollSnapshot } from "ui/virtualization/public";
import type { CardGridMountedRow } from "./cardGridSurfaceTypes";

export interface CardGridSurfaceCommonProps<TMountedCell extends MountedVirtualCell> {
	className?: string;
	contentClassName?: string;
	rowClassName?: string;
	cellClassName?: string;
	contentHeight: number;
	cellWidth?: number;
	rowHeight: number;
	columns?: number;
	gap?: number;
	interactionDescriptorScopeId?: string;
	interactionDescriptorResolverProvider?: InteractionDescriptorResolverProvider;
	renderCell: Snippet<
		[
			{
				mountedCell: TMountedCell;
				scrollContainerEl: HTMLElement | null;
			},
		]
	>;
	afterContent?: Snippet;
	rootEl?: HTMLDivElement | null;
	contentEl?: HTMLDivElement | null;
	interactionShadowRoot?: ShadowRoot | null;
	scrollContainerEl?: HTMLElement | null;
	getCellClassName?: (cell: TMountedCell) => string | undefined;
	getCellDataTestId?: (cell: TMountedCell) => string | undefined;
	slotBodyRevision?: unknown;
	resolveNavigationTarget?: (
		currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: {
			rowIndex: number;
			columnIndex: number;
		},
	) => VirtualNavigationTarget | null;
	flushVirtualScrollMeasurement?: (snapshot: ProgrammaticScrollSnapshot) => void;
}

export type CardGridSurfaceProps<TMountedCell extends MountedVirtualCell> =
	CardGridSurfaceCommonProps<TMountedCell> & {
		mountedRows: readonly CardGridMountedRow<TMountedCell>[];
	};
