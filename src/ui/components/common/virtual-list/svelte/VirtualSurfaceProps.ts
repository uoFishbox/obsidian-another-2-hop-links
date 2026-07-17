import type { Snippet } from "svelte";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { InteractionDescriptor } from "ui/interactions/interactionTypes";
import type {
	InteractionDescriptorResolver,
	InteractionDescriptorResolverProvider,
} from "ui/interactions/interactionRegistry";
import type { MountedVirtualCell, VirtualNavigationTarget } from "../types";
import type { ProgrammaticScrollSnapshot } from "../dom/flushVirtualScrollMeasurement";
import type { VirtualSurfaceNavigationContext } from "./VirtualSurfaceNavigation";
import type { VirtualCellRegistry } from "./VirtualCellRegistry";
import type { VirtualCellBodyLifecyclePolicy } from "ui/virtualization/bodyLifecycle";
import type {
	VirtualSurfaceCellPosition,
	VirtualSurfaceRenderInput,
} from "./VirtualSurfaceTypes";

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
	mountedCellsForChange?: readonly TMountedCell[];
	interactionDescriptorScopeId?: string;
	interactionDescriptors?: readonly InteractionDescriptor[];
	interactionDescriptorResolvers?: readonly InteractionDescriptorResolver[];
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
	getCellPosition?: (cell: TMountedCell) => VirtualSurfaceCellPosition;
	getCellClassName?: (cell: TMountedCell) => string | undefined;
	getCellDataTestId?: (cell: TMountedCell) => string | undefined;
	onCellMount?: (cell: TMountedCell) => void;
	onCellDestroy?: (cell: TMountedCell) => void;
	onMountedCellsChange?: (cells: readonly TMountedCell[]) => void;
	bodyLifecyclePolicy?: VirtualCellBodyLifecyclePolicy<TMountedCell>;
	resolveNavigationTarget?: (
		currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: {
			rowIndex: number;
			columnIndex: number;
		},
	) => VirtualNavigationTarget | null;
	moveFocusWithinList?: (
		currentTarget: HTMLElement,
		direction: ResultNavigationDirection,
		context: VirtualSurfaceNavigationContext,
	) => Promise<boolean>;
	flushVirtualScrollMeasurement?: (snapshot: ProgrammaticScrollSnapshot) => void;
	cellRegistry?: VirtualCellRegistry;
}

export type VirtualSurfaceProps<TMountedCell extends MountedVirtualCell> =
	VirtualSurfaceCommonProps<TMountedCell> & VirtualSurfaceRenderInput<TMountedCell>;
