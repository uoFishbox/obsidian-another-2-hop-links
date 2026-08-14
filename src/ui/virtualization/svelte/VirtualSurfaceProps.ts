import type { Snippet } from "svelte";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { InteractionDescriptorResolverProvider } from "ui/interactions/interactionRegistry";
import type { MountedVirtualCell, VirtualNavigationTarget } from "../types";
import type { ProgrammaticScrollSnapshot } from "../dom/flushVirtualScrollMeasurement";
import type { VirtualCellBodyLifecyclePolicy } from "ui/virtualization/core/bodyLifecycle";
import type { VirtualSurfaceMountedRow } from "./VirtualSurfaceTypes";

export interface VirtualSurfaceCommonProps<TMountedCell extends MountedVirtualCell> {
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
				observerRoot: HTMLElement | null;
			},
		]
	>;
	afterContent?: Snippet;
	rootEl?: HTMLDivElement | null;
	contentEl?: HTMLDivElement | null;
	interactionShadowRoot?: ShadowRoot | null;
	observerRoot?: HTMLElement | null;
	getCellClassName?: (cell: TMountedCell) => string | undefined;
	getCellDataTestId?: (cell: TMountedCell) => string | undefined;
	bodyLifecyclePolicy?: VirtualCellBodyLifecyclePolicy<TMountedCell>;
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

export type VirtualSurfaceProps<TMountedCell extends MountedVirtualCell> =
	VirtualSurfaceCommonProps<TMountedCell> & {
		mountedRows: readonly VirtualSurfaceMountedRow<TMountedCell>[];
	};
