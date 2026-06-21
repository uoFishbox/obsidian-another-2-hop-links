import {
	RESULT_FOCUS_SELECTOR,
	type ResultNavigationDirection,
} from "features/keyboard-navigation/resultFocus";
import { waitForNextAnimationFrame } from "ui/utils/frame";
import type { VirtualNavigationTarget } from "../types";
import { getScrollMetrics } from "../dom/virtualListMeasurementAdapter";
import { createVirtualListKeyboardHandler } from "./VirtualSurfaceKeyboard";
import {
	findNearestScrollContainer,
	invalidateNearestScrollContainerCache,
} from "../../virtualGridLinkListScroll";

const LOGICAL_CELL_SELECTOR = "[data-ccl-logical-key]";

export function findMountedCellElementByKey(
	container: HTMLElement | null,
	key: string | null | undefined,
): HTMLElement | null {
	if (!container || !key) {
		return null;
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
}): void => {
	const scrollMetrics = getScrollMetrics(
		params.rootEl,
		params.scrollContainerEl,
	);
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

	if (params.scrollContainerEl) {
		params.scrollContainerEl.scrollTop = Math.max(0, nextScrollTop);
		params.scrollContainerEl.dispatchEvent(new Event("scroll"));
	} else if (typeof window !== "undefined") {
		window.scrollTo({
			top: Math.max(0, nextScrollTop),
		});
		window.dispatchEvent(new Event("scroll"));
	}
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
	flushVirtualScrollMeasurement?: (
		scrollContainerEl: HTMLElement | null,
		targetTop: number,
	) => void;
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
		target.scrollIntoView({ block: "nearest", inline: "nearest" });
		return true;
	};

	const moveFocusToNavigationTarget = async (
		target: VirtualNavigationTarget,
	): Promise<boolean> => {
		const getMountedCellElement = (key: string): HTMLElement | null =>
			findMountedCellElementByKey(options.getContentEl(), key);

		if (focusCellTarget(getMountedCellElement(target.key))) {
			return true;
		}

		const rootEl = options.getRootEl();
		if (!rootEl) {
			return false;
		}
		invalidateNearestScrollContainerCache(rootEl);
		const scrollContainerEl =
			options.getScrollContainerEl() ??
			findNearestScrollContainer(rootEl);

		scrollElementIntoVirtualViewport({
			rootEl,
			scrollContainerEl,
			targetTop: target.rowTop,
			targetHeight: options.getRowHeight(),
		});

		await waitForNextAnimationFrame();
		options.flushVirtualScrollMeasurement?.(
			scrollContainerEl,
			target.rowTop,
		);
		await options.flushMountedState();

		return focusCellTarget(getMountedCellElement(target.key));
	};

	const moveFocusWithinResolvedNavigation = async (
		currentTarget: HTMLElement,
		direction: ResultNavigationDirection,
	): Promise<boolean> => {
		const currentCellElement = currentTarget.closest<HTMLElement>(
			"[data-ccl-logical-key]",
		);
		const currentKey = currentCellElement?.dataset.cclLogicalKey;
		const rowIndex = Number(currentCellElement?.dataset.cclRowIndex);
		const columnIndex = Number(currentCellElement?.dataset.cclColumnIndex);
		if (
			!currentKey ||
			!Number.isInteger(rowIndex) ||
			!Number.isInteger(columnIndex)
		) {
			return false;
		}

		const target = options.resolveNavigationTarget?.(
			currentKey,
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
						findMountedCellElementByKey(
							options.getContentEl(),
							key,
						),
					hasMountedElement: (key) =>
						findMountedCellElementByKey(
							options.getContentEl(),
							key,
						) !== null,
					flushMountedState: options.flushMountedState,
				})) ?? false
			);
		},
		flushMountedState: options.flushMountedState,
	});
};
