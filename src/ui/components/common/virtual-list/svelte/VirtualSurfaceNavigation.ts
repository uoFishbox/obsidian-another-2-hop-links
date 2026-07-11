import {
	RESULT_FOCUS_SELECTOR,
	type ResultNavigationDirection,
} from "features/keyboard-navigation/resultFocus";
import { waitForNextAnimationFrame } from "ui/utils/frame";
import type { VirtualNavigationTarget } from "../types";
import { getScrollMetrics } from "../dom/virtualListMeasurementAdapter";
import { createVirtualListKeyboardHandler } from "./VirtualSurfaceKeyboard";
import { findNearestScrollContainer } from "../dom/scrollContainer";
import { invalidateScrollGeometry } from "../dom/virtualListScrollGeometryInvalidation";
import type { ProgrammaticScrollSnapshot } from "../dom/flushVirtualScrollMeasurement";
import {
	findClosestRegisteredVirtualCell,
	findRegisteredVirtualCellElementByKey,
	type VirtualCellRegistry,
} from "./VirtualCellRegistry";

const LOGICAL_CELL_SELECTOR = "[data-ccl-logical-key]";

export function findMountedCellElementByKey(
	container: HTMLElement | null,
	key: string | null | undefined,
): HTMLElement | null {
	if (!container || !key) {
		return null;
	}

	const registeredElement = findRegisteredVirtualCellElementByKey(container, key);
	if (registeredElement) {
		return registeredElement;
	}

	for (const element of container.querySelectorAll<HTMLElement>(
		LOGICAL_CELL_SELECTOR,
	)) {
		if (element.dataset.cclLogicalKey === key) {
			return element;
		}
	}

	return null;
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
	} else if (typeof window !== "undefined") {
		window.scrollTo({
			top: resolvedScrollTop,
		});
	}
	return snapshot;
};

export { scrollElementIntoVirtualViewport };

export interface VirtualSurfaceNavigationContext {
	rootEl: HTMLElement | null;
	scrollContainerEl: HTMLElement | null;
	getMountedElementByKey(key: string): HTMLElement | null;
	hasMountedElement(key: string): boolean;
	flushMountedState(): Promise<void>;
}

interface DelegatedKeyboardInteractions {
	handleKeyDown(event: KeyboardEvent): void;
}

export const createVirtualSurfaceNavigation = (options: {
	getRootEl: () => HTMLElement | null;
	getContentEl: () => HTMLElement | null;
	getScrollContainerEl: () => HTMLElement | null;
	getRowHeight: () => number;
	delegatedInteractions: DelegatedKeyboardInteractions;
	flushMountedState: () => Promise<void>;
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
			options.cellRegistry?.findByKey(key) ??
			findMountedCellElementByKey(options.getContentEl(), key);
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
			invalidateScrollGeometry(rootEl, "navigation-scroll");
		}
		if (!scrollSnapshot.didScroll && focusCellTarget(mountedCellElement)) {
			return true;
		}

		await waitForNextAnimationFrame();
		options.flushVirtualScrollMeasurement?.(scrollSnapshot);
		await options.flushMountedState();

		return focusCellTarget(getMountedCellElement(target.key));
	};

	const moveFocusWithinResolvedNavigation = async (
		currentTarget: HTMLElement,
		direction: ResultNavigationDirection,
	): Promise<boolean> => {
		const registeredCell =
			options.cellRegistry?.findClosest(currentTarget) ??
			findClosestRegisteredVirtualCell(currentTarget);
		const currentCellElement =
			registeredCell?.element ??
			currentTarget.closest<HTMLElement>(LOGICAL_CELL_SELECTOR);
		const currentKey =
			registeredCell?.metadata.logicalKey ??
			currentCellElement?.dataset.cclLogicalKey;
		const rowIndex =
			registeredCell?.metadata.rowIndex ??
			Number(currentCellElement?.dataset.cclRowIndex);
		const columnIndex =
			registeredCell?.metadata.columnIndex ??
			Number(currentCellElement?.dataset.cclColumnIndex);
		if (
			!currentKey ||
			!Number.isInteger(rowIndex) ||
			!Number.isInteger(columnIndex)
		) {
			return false;
		}

		const target = options.resolveNavigationTarget?.(currentKey, direction, {
			rowIndex,
			columnIndex,
		});
		if (!target) {
			return false;
		}

		return moveFocusToNavigationTarget(target);
	};

	return createVirtualListKeyboardHandler({
		getRootEl: options.getRootEl,
		getScrollContainerEl: options.getScrollContainerEl,
		delegatedInteractions: options.delegatedInteractions,
		moveFocusWithinList: async (currentTarget, direction) => {
			if (options.resolveNavigationTarget) {
				const moved = await moveFocusWithinResolvedNavigation(
					currentTarget,
					direction,
				);
				if (moved) {
					return true;
				}
			}

			return (
				(await options.moveFocusWithinList?.(currentTarget, direction, {
					rootEl: options.getRootEl(),
					scrollContainerEl: options.getScrollContainerEl(),
					getMountedElementByKey: (key) =>
						options.cellRegistry?.findByKey(key) ??
						findMountedCellElementByKey(options.getContentEl(), key),
					hasMountedElement: (key) =>
						(options.cellRegistry?.findByKey(key) ??
							findMountedCellElementByKey(
								options.getContentEl(),
								key,
							)) !== null,
					flushMountedState: options.flushMountedState,
				})) ?? false
			);
		},
		flushMountedState: options.flushMountedState,
	});
};
