import {
	RESULT_FOCUS_SELECTOR,
	type ResultNavigationDirection,
} from "cards/navigation/resultFocus";
import { waitForNextAnimationFrame } from "shared/ui/scheduling/frame";
import type {
	VirtualNavigationTarget,
	VirtualSequentialNavigationDirection,
	VirtualSequentialNavigationTarget,
} from "cards/virtualization/public";
import {
	getScrollMetrics,
	type ProgrammaticScrollSnapshot,
} from "cards/virtualization/public";
import { createCardGridKeyboardHandler } from "./keyboardNavigation";
import { findNearestScrollContainer } from "shared/ui/scroll/scrollContainer";
import type { VirtualCellBindingRegistry } from "./cellBindingRegistry";
import { isHTMLElementLike } from "shared/ui/dom/realmSafeDom";

const SEQUENTIAL_FOCUS_SELECTOR = ".cosense-card-links__box";

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

interface CardSurfaceNavigationOptions {
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
	resolveSequentialNavigationTarget?: (
		currentKey: string,
		direction: VirtualSequentialNavigationDirection,
		currentPosition: {
			rowIndex: number;
			columnIndex: number;
		},
	) => VirtualSequentialNavigationTarget | null;
	flushVirtualScrollMeasurement?: (snapshot: ProgrammaticScrollSnapshot) => void;
}

export interface CardSurfaceNavigationHandlers {
	handleKeyDown(event: KeyboardEvent): Promise<void>;
	handleFocusIn(event: FocusEvent): void;
}

export const createCardSurfaceNavigation = (
	options: CardSurfaceNavigationOptions,
): CardSurfaceNavigationHandlers => {
	const getFocusableCellTarget = (
		cellElement: HTMLElement | null,
	): HTMLElement | null =>
		cellElement?.querySelector<HTMLElement>(RESULT_FOCUS_SELECTOR) ?? null;

	const getSequentialFocusableCellTarget = (
		cellElement: HTMLElement | null,
	): HTMLElement | null => {
		if (!cellElement) return null;
		for (const element of cellElement.querySelectorAll<HTMLElement>(
			SEQUENTIAL_FOCUS_SELECTOR,
		)) {
			if (element.tabIndex >= 0 && !element.hasAttribute("disabled")) {
				return element;
			}
		}
		return null;
	};

	const focusCellTarget = (
		cellElement: HTMLElement | null,
		resolveTarget: (cellElement: HTMLElement | null) => HTMLElement | null,
	): boolean => {
		const target = resolveTarget(cellElement);
		if (!target) {
			return false;
		}

		target.focus({ preventScroll: true });
		return true;
	};

	const moveFocusToNavigationTarget = async (
		target: VirtualNavigationTarget,
		resolveTarget: (cellElement: HTMLElement | null) => HTMLElement | null,
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
			return focusCellTarget(mountedCellElement, resolveTarget);
		}
		const scrollContainerEl =
			options.getScrollContainerEl() ?? findNearestScrollContainer(rootEl);

		const scrollSnapshot = scrollElementIntoVirtualViewport({
			rootEl,
			scrollContainerEl,
			targetTop: target.rowTop,
			targetHeight: options.getRowHeight(),
		});
		if (
			!scrollSnapshot.didScroll &&
			focusCellTarget(mountedCellElement, resolveTarget)
		) {
			return true;
		}

		await waitForNextAnimationFrame(rootEl.ownerDocument.defaultView);
		options.flushVirtualScrollMeasurement?.(scrollSnapshot);
		await options.flushMountedState();

		return focusCellTarget(getMountedCellElement(target.key), resolveTarget);
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

		return moveFocusToNavigationTarget(target, getFocusableCellTarget);
	};

	const collectMountedSequentialTargets = (): Array<{
		element: HTMLElement;
		rowIndex: number;
		columnIndex: number;
	}> => {
		const contentEl = options.getContentEl();
		if (!contentEl) return [];

		const targets: Array<{
			element: HTMLElement;
			rowIndex: number;
			columnIndex: number;
		}> = [];
		for (const element of contentEl.querySelectorAll<HTMLElement>(
			SEQUENTIAL_FOCUS_SELECTOR,
		)) {
			if (element.tabIndex < 0 || element.hasAttribute("disabled")) continue;
			const registeredCell = options.cellBindingRegistry.findClosestCell(element);
			const rowIndex = registeredCell?.metadata.rowIndex;
			const columnIndex = registeredCell?.metadata.columnIndex;
			if (rowIndex === undefined || columnIndex === undefined) continue;
			targets.push({ element, rowIndex, columnIndex });
		}

		targets.sort((a, b) =>
			a.rowIndex !== b.rowIndex
				? a.rowIndex - b.rowIndex
				: a.columnIndex - b.columnIndex,
		);
		return targets;
	};

	const temporarilyDisableSurfaceTabStops = (currentTarget: HTMLElement): void => {
		const contentEl = options.getContentEl();
		if (!contentEl) return;

		const tabStops = Array.from(
			contentEl.querySelectorAll<HTMLElement>(SEQUENTIAL_FOCUS_SELECTOR),
		).filter(
			(element) =>
				element.tabIndex >= 0 &&
				element !== currentTarget &&
				!element.contains(currentTarget),
		);
		if (tabStops.length === 0) return;

		const previousTabIndexAttributes = tabStops.map((element) =>
			element.getAttribute("tabindex"),
		);
		for (const element of tabStops) {
			element.tabIndex = -1;
		}

		const ownerWindow = contentEl.ownerDocument.defaultView;
		const restore = (): void => {
			for (let index = 0; index < tabStops.length; index += 1) {
				const element = tabStops[index];
				if (!element) continue;
				const previous = previousTabIndexAttributes[index];
				if (previous === null) {
					element.removeAttribute("tabindex");
				} else {
					element.setAttribute("tabindex", previous);
				}
			}
		};
		if (ownerWindow) {
			ownerWindow.setTimeout(restore, 0);
		} else {
			setTimeout(restore, 0);
		}
	};

	const prepareSequentialFocusMove = (
		currentTarget: HTMLElement,
		direction: VirtualSequentialNavigationDirection,
	): (() => Promise<boolean>) | null => {
		const resolver = options.resolveSequentialNavigationTarget;
		if (!resolver) return null;

		const registeredCell =
			options.cellBindingRegistry.findClosestCell(currentTarget);
		if (!registeredCell) return null;
		const { rowIndex, columnIndex } = registeredCell.metadata;
		if (rowIndex === undefined || columnIndex === undefined) return null;

		const initialTarget = resolver(registeredCell.metadata.logicalKey, direction, {
			rowIndex,
			columnIndex,
		});
		if (!initialTarget) {
			// Keep the resident DOM in physical-slot order, but let native Tab leave
			// this surface instead of wrapping into another recycled physical slot.
			temporarilyDisableSurfaceTabStops(currentTarget);
			return null;
		}

		return async (): Promise<boolean> => {
			let target: VirtualSequentialNavigationTarget | null = initialTarget;
			while (target) {
				if (
					await moveFocusToNavigationTarget(
						target,
						getSequentialFocusableCellTarget,
					)
				) {
					return true;
				}
				target = resolver(target.key, direction, {
					rowIndex: target.rowIndex,
					columnIndex: target.columnIndex,
				});
			}
			return false;
		};
	};

	const handleKeyDown = createCardGridKeyboardHandler({
		getRootEl: options.getRootEl,
		getScrollContainerEl: options.getScrollContainerEl,
		delegatedInteractions: options.delegatedInteractions,
		moveFocusWithinList: async (currentTarget, direction) =>
			options.resolveNavigationTarget
				? moveFocusWithinResolvedNavigation(currentTarget, direction)
				: false,
		prepareSequentialFocusMove,
		flushMountedState: options.flushMountedState,
	});

	const handleFocusIn = (event: FocusEvent): void => {
		if (!options.resolveSequentialNavigationTarget) return;
		const origin = event.composedPath()[0];
		if (!isHTMLElementLike(origin)) return;
		const currentCell = options.cellBindingRegistry.findClosestCell(origin);
		if (!currentCell) return;

		const relatedTarget = isHTMLElementLike(event.relatedTarget)
			? event.relatedTarget
			: null;
		if (!relatedTarget) return;
		if (options.cellBindingRegistry.findClosestCell(relatedTarget)) return;

		const rootEl = options.getRootEl();
		if (!rootEl) return;
		if (
			rootEl.contains(relatedTarget) ||
			relatedTarget.getRootNode() === rootEl.shadowRoot
		) {
			return;
		}

		const relation = relatedTarget.compareDocumentPosition(rootEl);
		const direction =
			relation & Node.DOCUMENT_POSITION_FOLLOWING
				? "forward"
				: relation & Node.DOCUMENT_POSITION_PRECEDING
					? "backward"
					: null;
		if (!direction) return;

		const targets = collectMountedSequentialTargets();
		const edge = direction === "forward" ? targets[0] : targets[targets.length - 1];
		if (!edge || edge.element === origin || edge.element.contains(origin)) return;
		edge.element.focus({ preventScroll: true });
	};

	return { handleKeyDown, handleFocusIn };
};
