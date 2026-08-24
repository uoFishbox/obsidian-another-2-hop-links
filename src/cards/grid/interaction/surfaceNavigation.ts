import {
	RESULT_FOCUS_SELECTOR,
	type ResultNavigationDirection,
} from "cards/navigation/resultFocus";
import { waitForNextAnimationFrame } from "shared/ui/scheduling/frame";
import type { VirtualNavigationTarget } from "cards/virtualization/public";
import {
	getScrollMetrics,
	type ProgrammaticScrollSnapshot,
} from "cards/virtualization/public";
import { createCardGridKeyboardHandler } from "./keyboardNavigation";
import {
	findNearestScrollContainer,
	invalidateNearestScrollContainerCache,
} from "shared/ui/scroll/scrollContainer";
import type { VirtualCellBindingRegistry } from "./cellBindingRegistry";

export function findMountedCellElementByKey(
	container: HTMLElement | null,
	key: string | null | undefined,
	cellBindingRegistry: VirtualCellBindingRegistry,
): HTMLElement | null {
	if (!container || !key) {
		return null;
	}

	return cellBindingRegistry.findCellElementByKey(container, key);
}

const scrollElementIntoVirtualViewport = (params: {
	rootEl: HTMLElement;
	scrollContainerEl: HTMLElement | null;
	targetTop: number;
	targetHeight: number;
}): ProgrammaticScrollSnapshot => {
	const scrollMetrics = getScrollMetrics(params.rootEl, params.scrollContainerEl);
	const absoluteTargetTop = scrollMetrics.sectionTop + params.targetTop;
	const absoluteTargetBottom = absoluteTargetTop + params.targetHeight;
	const viewportTop = scrollMetrics.scrollTop;
	const viewportBottom = viewportTop + scrollMetrics.viewportHeight;
	let nextScrollTop = viewportTop;

	if (absoluteTargetTop < viewportTop) {
		nextScrollTop = absoluteTargetTop;
	} else if (absoluteTargetBottom > viewportBottom) {
		nextScrollTop = absoluteTargetBottom - scrollMetrics.viewportHeight;
	}

	const resolvedScrollTop = Math.max(0, nextScrollTop);
	const snapshot: ProgrammaticScrollSnapshot = {
		scrollContainerEl: params.scrollContainerEl,
		scrollTop: resolvedScrollTop,
		viewportHeight: scrollMetrics.viewportHeight,
		sectionTop: Math.max(0, resolvedScrollTop - params.targetTop),
		didScroll: resolvedScrollTop !== viewportTop,
	};
	if (resolvedScrollTop === viewportTop) {
		return snapshot;
	}

	if (params.scrollContainerEl) {
		params.scrollContainerEl.scrollTop = resolvedScrollTop;
	} else {
		params.rootEl.ownerDocument.defaultView?.scrollTo({
			top: resolvedScrollTop,
		});
	}
	return snapshot;
};

export { scrollElementIntoVirtualViewport };

interface DelegatedKeyboardInteractions {
	handleKeyDown(event: KeyboardEvent): void;
}

export const createCardSurfaceNavigation = (options: {
	getRootEl: () => HTMLElement | null;
	getContentEl: () => HTMLElement | null;
	getScrollContainerEl: () => HTMLElement | null;
	getRowHeight: () => number;
	delegatedInteractions: DelegatedKeyboardInteractions;
	cellBindingRegistry: VirtualCellBindingRegistry;
	flushMountedState: () => Promise<void>;
	resolveNavigationTarget?: (
		currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: {
			rowIndex: number;
			columnIndex: number;
		},
	) => VirtualNavigationTarget | null;
	flushVirtualScrollMeasurement?: (snapshot: ProgrammaticScrollSnapshot) => void;
}): ((event: KeyboardEvent) => Promise<void>) => {
	const getFocusableCellTarget = (
		cellElement: HTMLElement | null,
	): HTMLElement | null =>
		cellElement?.querySelector<HTMLElement>(RESULT_FOCUS_SELECTOR) ?? null;

	const focusCellTarget = (cellElement: HTMLElement | null): boolean => {
		const target = getFocusableCellTarget(cellElement);
		if (!target) {
			return false;
		}

		target.focus({ preventScroll: true });
		return true;
	};

	const moveFocusToNavigationTarget = async (
		target: VirtualNavigationTarget,
	): Promise<boolean> => {
		const getMountedCellElement = (key: string): HTMLElement | null =>
			findMountedCellElementByKey(
				options.getContentEl(),
				key,
				options.cellBindingRegistry,
			);
		const mountedCellElement = getMountedCellElement(target.key);

		const rootEl = options.getRootEl();
		if (!rootEl) {
			return focusCellTarget(mountedCellElement);
		}
		const scrollContainerEl =
			options.getScrollContainerEl() ?? findNearestScrollContainer(rootEl);

		const scrollSnapshot = scrollElementIntoVirtualViewport({
			rootEl,
			scrollContainerEl,
			targetTop: target.rowTop,
			targetHeight: options.getRowHeight(),
		});
		if (scrollSnapshot.didScroll) {
			invalidateNearestScrollContainerCache(rootEl);
		}
		if (!scrollSnapshot.didScroll && focusCellTarget(mountedCellElement)) {
			return true;
		}

		await waitForNextAnimationFrame(rootEl.ownerDocument.defaultView);
		options.flushVirtualScrollMeasurement?.(scrollSnapshot);
		await options.flushMountedState();

		return focusCellTarget(getMountedCellElement(target.key));
	};

	const moveFocusWithinResolvedNavigation = async (
		currentTarget: HTMLElement,
		direction: ResultNavigationDirection,
	): Promise<boolean> => {
		const registeredCell =
			options.cellBindingRegistry.findClosestCell(currentTarget);
		if (!registeredCell) {
			return false;
		}

		const { rowIndex, columnIndex } = registeredCell.metadata;
		if (rowIndex === undefined || columnIndex === undefined) {
			return false;
		}

		const target = options.resolveNavigationTarget?.(
			registeredCell.metadata.logicalKey,
			direction,
			{
				rowIndex,
				columnIndex,
			},
		);
		if (!target) {
			return false;
		}

		return moveFocusToNavigationTarget(target);
	};

	return createCardGridKeyboardHandler({
		getRootEl: options.getRootEl,
		getScrollContainerEl: options.getScrollContainerEl,
		delegatedInteractions: options.delegatedInteractions,
		moveFocusWithinList: async (currentTarget, direction) =>
			options.resolveNavigationTarget
				? moveFocusWithinResolvedNavigation(currentTarget, direction)
				: false,
		flushMountedState: options.flushMountedState,
	});
};
