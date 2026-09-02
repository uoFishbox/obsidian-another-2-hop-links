import {
	findAdjacentResultSection,
	focusResultEdge,
	getFocusableResultTarget,
	moveFocusBetweenResults,
	scrollSectionIntoViewForFocus,
	type ResultNavigationDirection,
} from "cards/navigation/resultFocus";
import type { VirtualSequentialNavigationDirection } from "cards/virtualization/public";
import { waitForNextAnimationFrame } from "shared/ui/scheduling/frame";
import { isHTMLElementLike } from "shared/ui/dom/realmSafeDom";

interface DelegatedKeyboardInteractions {
	handleKeyDown: (event: KeyboardEvent) => void;
}

export const getArrowNavigationDirection = (
	key: string,
): ResultNavigationDirection | null => {
	switch (key.toLowerCase()) {
		case "arrowdown":
			return "down";
		case "arrowup":
			return "up";
		case "arrowleft":
			return "left";
		case "arrowright":
			return "right";
		default:
			return null;
	}
};

export const moveFocusToAdjacentVirtualListSection = async (params: {
	direction: ResultNavigationDirection;
	rootEl: HTMLElement | null;
	scrollContainerEl: HTMLElement | null;
	flushMountedState: () => Promise<void>;
}): Promise<boolean> => {
	if (params.direction !== "up" && params.direction !== "down") {
		return false;
	}

	const resultsContainer =
		params.rootEl?.closest<HTMLElement>(
			".cosense-card-links__search-result-container",
		) ?? null;
	const currentSection =
		params.rootEl?.closest<HTMLElement>(".cosense-card-links__section") ?? null;
	const targetSection = findAdjacentResultSection(
		resultsContainer,
		currentSection,
		params.direction,
	);
	if (!targetSection) {
		return false;
	}

	scrollSectionIntoViewForFocus(
		targetSection,
		params.direction,
		params.scrollContainerEl,
	);
	await waitForNextAnimationFrame();
	await params.flushMountedState();
	await waitForNextAnimationFrame();

	return focusResultEdge(targetSection, params.direction) !== null;
};

export const createCardGridKeyboardHandler = (options: {
	getRootEl: () => HTMLElement | null;
	getScrollContainerEl: () => HTMLElement | null;
	delegatedInteractions: DelegatedKeyboardInteractions;
	moveFocusWithinList: (
		currentTarget: HTMLElement,
		direction: ResultNavigationDirection,
	) => Promise<boolean>;
	prepareSequentialFocusMove: (
		currentTarget: HTMLElement,
		direction: VirtualSequentialNavigationDirection,
	) => (() => Promise<boolean>) | null;
	flushMountedState: () => Promise<void>;
}): ((event: KeyboardEvent) => Promise<void>) => {
	return async (event: KeyboardEvent): Promise<void> => {
		if (event.ctrlKey || event.metaKey || event.altKey) {
			options.delegatedInteractions.handleKeyDown(event);
			return;
		}

		if (event.key === "Tab") {
			const origin = event.composedPath()[0];
			if (isHTMLElementLike(origin)) {
				const runSequentialMove = options.prepareSequentialFocusMove(
					origin,
					event.shiftKey ? "backward" : "forward",
				);
				if (runSequentialMove) {
					event.preventDefault();
					event.stopPropagation();
					await runSequentialMove();
					return;
				}
			}
		}

		const direction = getArrowNavigationDirection(event.key);
		if (direction) {
			const currentTarget = getFocusableResultTarget(event);
			if (currentTarget) {
				const rootEl = options.getRootEl();
				const resultsContainer =
					rootEl?.closest<HTMLElement>(
						".cosense-card-links__search-result-container",
					) ?? rootEl;
				const surfaceRoot = isHTMLElementLike(resultsContainer?.parentElement)
					? resultsContainer.parentElement
					: resultsContainer;
				const searchInputContainer = isHTMLElementLike(
					resultsContainer?.previousElementSibling,
				)
					? resultsContainer.previousElementSibling
					: surfaceRoot;
				event.preventDefault();
				event.stopPropagation();

				const moved = moveFocusBetweenResults(
					surfaceRoot,
					currentTarget,
					direction,
					searchInputContainer,
				);
				if (moved) {
					return;
				}

				if (await options.moveFocusWithinList(currentTarget, direction)) {
					return;
				}

				if (
					await moveFocusToAdjacentVirtualListSection({
						direction,
						rootEl,
						scrollContainerEl: options.getScrollContainerEl(),
						flushMountedState: options.flushMountedState,
					})
				) {
					return;
				}
			}
		}

		options.delegatedInteractions.handleKeyDown(event);
	};
};
