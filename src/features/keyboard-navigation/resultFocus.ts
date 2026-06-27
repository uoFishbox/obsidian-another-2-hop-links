import {
	findClosestComposed,
	querySelectorAllIncludingShadow,
} from "ui/utils/shadowDom";
import { isElementVisible } from "ui/utils/domUtils";
import {
	getOptionalOwnerWindow,
	isEventLike,
	isHTMLElementLike,
} from "ui/utils/realmSafeDom";
export type ResultFocusDirection = "up" | "down";
export type ResultNavigationDirection = ResultFocusDirection | "left" | "right";

export const CARD_SELECTOR = ".cosense-card-links__box[data-ccl-interaction-id]";
export const LOAD_MORE_SELECTOR =
	"button.cosense-card-links__load-more-button.cosense-card-links__box";
export const RESULT_FOCUS_SELECTOR = `${CARD_SELECTOR}, ${LOAD_MORE_SELECTOR}`;
export const SEARCH_INPUT_SELECTOR = ".twohop-search-input";
const NAVIGATION_CELL_SELECTOR =
	".cosense-card-links__virtual-grid-cell, .view-plan-virtual-list-cell";
const NAVIGATION_EPSILON_PX = 1;

interface NavigationRect {
	top: number;
	left: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

interface NavigationTarget {
	element: HTMLElement;
	rect: NavigationRect;
	centerX: number;
	centerY: number;
	rectSource: "boundingRect" | "positionedCell";
	navigationRoot: HTMLElement | null;
}

const NAVIGATION_ROOT_SELECTOR =
	".cosense-card-links__virtual-grid, .view-plan-virtual-list";

type WindowWithEventConstructor = Window & {
	Event: typeof Event;
};

function createOwnerEvent(target: Node | Window, type: string): Event {
	const ownerWindow = (
		"document" in target ? target : getOptionalOwnerWindow(target)
	) as WindowWithEventConstructor | null;
	return ownerWindow ? new ownerWindow.Event(type) : new Event(type);
}

function collectResultTargets(container: HTMLElement | null): HTMLElement[] {
	return querySelectorAllIncludingShadow<HTMLElement>(
		container,
		RESULT_FOCUS_SELECTOR,
	).filter(
		(element) => !element.hasAttribute("disabled") && isElementVisible(element),
	);
}

function collectResultSections(container: HTMLElement | null): HTMLElement[] {
	if (!container) {
		return [];
	}

	return Array.from(container.children).filter(
		(element): element is HTMLElement =>
			isHTMLElementLike(element) &&
			element.classList.contains("cosense-card-links__section"),
	);
}

function getTargetIdentity(element: HTMLElement): string | null {
	return element.dataset.cclInteractionId ?? null;
}

function parseStyleNumber(value: string | null | undefined): number | null {
	if (!value) {
		return null;
	}

	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function parseTransformTranslate(
	value: string | null | undefined,
): { left: number; top: number } | null {
	if (!value || value === "none") {
		return null;
	}

	const translateMatch =
		value.match(
			/^translate(?:3d)?\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:px)?)\s*(?:,\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:px)?))?(?:,\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:px)?)?\s*\)$/i,
		) ??
		value.match(
			/^translateX\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:px)?)\s*\)\s*translateY\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:px)?)\s*\)$/i,
		);
	if (translateMatch) {
		const left = Number.parseFloat(translateMatch[1]);
		const top = Number.parseFloat(translateMatch[2] ?? "0");
		if (Number.isFinite(left) && Number.isFinite(top)) {
			return { left, top };
		}
	}

	const matrixMatch = value.match(
		/^matrix\(\s*[+-]?(?:\d+\.?\d*|\.\d+)\s*,\s*[+-]?(?:\d+\.?\d*|\.\d+)\s*,\s*[+-]?(?:\d+\.?\d*|\.\d+)\s*,\s*[+-]?(?:\d+\.?\d*|\.\d+)\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:px)?)\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:px)?)\s*\)$/i,
	);
	if (matrixMatch) {
		const left = Number.parseFloat(matrixMatch[1]);
		const top = Number.parseFloat(matrixMatch[2]);
		if (Number.isFinite(left) && Number.isFinite(top)) {
			return { left, top };
		}
	}

	return null;
}

function buildRectFromPositionedCell(element: HTMLElement): NavigationRect | null {
	const cell = findClosestComposed(element, NAVIGATION_CELL_SELECTOR);
	if (!cell) {
		return null;
	}

	const width = parseStyleNumber(cell.style.width);
	const height = parseStyleNumber(cell.style.height);
	const position = parseTransformTranslate(cell.style.transform);
	if (!position || width === null || height === null) {
		return null;
	}

	return {
		top: position.top,
		left: position.left,
		right: position.left + width,
		bottom: position.top + height,
		width,
		height,
	};
}

function getNavigationRect(element: HTMLElement): {
	rect: NavigationRect;
	source: "boundingRect" | "positionedCell";
} | null {
	const rect = element.getBoundingClientRect();
	if (rect.width > 0 && rect.height > 0) {
		return {
			rect: {
				top: rect.top,
				left: rect.left,
				right: rect.right,
				bottom: rect.bottom,
				width: rect.width,
				height: rect.height,
			},
			source: "boundingRect",
		};
	}

	const positionedRect = buildRectFromPositionedCell(element);
	if (!positionedRect) {
		return null;
	}

	return {
		rect: positionedRect,
		source: "positionedCell",
	};
}

function buildNavigationTargets(container: HTMLElement | null): NavigationTarget[] {
	const targets: NavigationTarget[] = [];
	for (const element of collectResultTargets(container)) {
		const navigationRect = getNavigationRect(element);
		if (!navigationRect) {
			continue;
		}

		targets.push({
			element,
			rect: navigationRect.rect,
			centerX: navigationRect.rect.left + navigationRect.rect.width / 2,
			centerY: navigationRect.rect.top + navigationRect.rect.height / 2,
			rectSource: navigationRect.source,
			navigationRoot: findClosestComposed(element, NAVIGATION_ROOT_SELECTOR),
		});
	}
	return targets;
}

function focusResultTarget(target: HTMLElement): HTMLElement {
	target.focus({ preventScroll: true });
	target.scrollIntoView({ block: "nearest", inline: "nearest" });
	return target;
}

function scoreNavigationCandidate(
	current: NavigationTarget,
	candidate: NavigationTarget,
	direction: ResultNavigationDirection,
): {
	axisPriority: number;
	primaryDistance: number;
	secondaryDistance: number;
	fallbackDistance: number;
} | null {
	const horizontalOverlap =
		Math.min(current.rect.right, candidate.rect.right) -
		Math.max(current.rect.left, candidate.rect.left);
	const verticalOverlap =
		Math.min(current.rect.bottom, candidate.rect.bottom) -
		Math.max(current.rect.top, candidate.rect.top);
	const deltaX = candidate.centerX - current.centerX;
	const deltaY = candidate.centerY - current.centerY;

	switch (direction) {
		case "up": {
			if (deltaY >= -NAVIGATION_EPSILON_PX) {
				return null;
			}

			return {
				axisPriority: horizontalOverlap > 0 ? 0 : 1,
				primaryDistance: Math.abs(deltaY),
				secondaryDistance: Math.abs(deltaX),
				fallbackDistance: candidate.centerX,
			};
		}
		case "down": {
			if (deltaY <= NAVIGATION_EPSILON_PX) {
				return null;
			}

			return {
				axisPriority: horizontalOverlap > 0 ? 0 : 1,
				primaryDistance: Math.abs(deltaY),
				secondaryDistance: Math.abs(deltaX),
				fallbackDistance: candidate.centerX,
			};
		}
		case "left": {
			if (deltaX >= -NAVIGATION_EPSILON_PX) {
				return null;
			}

			return {
				axisPriority: verticalOverlap > 0 ? 0 : 1,
				primaryDistance: Math.abs(deltaX),
				secondaryDistance: Math.abs(deltaY),
				fallbackDistance: candidate.centerY,
			};
		}
		case "right": {
			if (deltaX <= NAVIGATION_EPSILON_PX) {
				return null;
			}

			return {
				axisPriority: verticalOverlap > 0 ? 0 : 1,
				primaryDistance: Math.abs(deltaX),
				secondaryDistance: Math.abs(deltaY),
				fallbackDistance: candidate.centerY,
			};
		}
	}
}

function resolveNavigationTarget(
	targets: readonly NavigationTarget[],
	currentTarget: HTMLElement | null,
	direction: ResultNavigationDirection,
): NavigationTarget | null {
	const currentIdentity = currentTarget ? getTargetIdentity(currentTarget) : null;
	const current =
		currentIdentity !== null
			? targets.find(
					(target) => getTargetIdentity(target.element) === currentIdentity,
				)
			: currentTarget
				? targets.find((target) => target.element === currentTarget)
				: undefined;
	if (!current) {
		return null;
	}

	let bestCandidate: NavigationTarget | null = null;
	let bestScore: {
		axisPriority: number;
		primaryDistance: number;
		secondaryDistance: number;
		fallbackDistance: number;
	} | null = null;

	for (const candidate of targets) {
		if (candidate.element === current.element) {
			continue;
		}

		const score = scoreNavigationCandidate(current, candidate, direction);
		if (!score) {
			continue;
		}

		if (
			!bestScore ||
			score.axisPriority < bestScore.axisPriority ||
			(score.axisPriority === bestScore.axisPriority &&
				score.primaryDistance < bestScore.primaryDistance) ||
			(score.axisPriority === bestScore.axisPriority &&
				score.primaryDistance === bestScore.primaryDistance &&
				score.secondaryDistance < bestScore.secondaryDistance) ||
			(score.axisPriority === bestScore.axisPriority &&
				score.primaryDistance === bestScore.primaryDistance &&
				score.secondaryDistance === bestScore.secondaryDistance &&
				score.fallbackDistance < bestScore.fallbackDistance)
		) {
			bestCandidate = candidate;
			bestScore = score;
		}
	}

	return bestCandidate;
}

function shouldUseLinearNavigationFallback(
	targets: readonly NavigationTarget[],
	currentTarget: HTMLElement | null,
): boolean {
	if (!currentTarget) {
		return false;
	}

	const currentIdentity = getTargetIdentity(currentTarget);
	const current =
		currentIdentity !== null
			? targets.find(
					(target) => getTargetIdentity(target.element) === currentIdentity,
				)
			: targets.find((target) => target.element === currentTarget);
	if (!current || current.rectSource !== "positionedCell") {
		return false;
	}

	const currentRoot = current.navigationRoot;
	if (!currentRoot) {
		return false;
	}

	return targets.some(
		(target) =>
			target !== current &&
			target.rectSource === "positionedCell" &&
			target.navigationRoot !== null &&
			target.navigationRoot !== currentRoot,
	);
}

function moveFocusLinearly(
	targets: readonly HTMLElement[],
	currentIndex: number,
	direction: ResultNavigationDirection,
	searchInputContainer: HTMLElement | null,
): HTMLElement | HTMLInputElement | null {
	switch (direction) {
		case "up":
			if (currentIndex === 0) {
				return focusSearchInput(searchInputContainer);
			}
			if (currentIndex > 0) {
				return focusResultTarget(targets[currentIndex - 1]);
			}
			return null;
		case "down":
		case "right":
			if (currentIndex >= 0 && currentIndex < targets.length - 1) {
				return focusResultTarget(targets[currentIndex + 1]);
			}
			return null;
		case "left":
			if (currentIndex > 0) {
				return focusResultTarget(targets[currentIndex - 1]);
			}
			return null;
	}
}

export function getFocusableResultTarget(
	target: EventTarget | Event | null,
): HTMLElement | null {
	if (isEventLike(target)) {
		return findClosestComposed(
			target.composedPath()[0] ?? target.target,
			RESULT_FOCUS_SELECTOR,
		);
	}

	return findClosestComposed(target, RESULT_FOCUS_SELECTOR);
}

function focusSearchInput(container: HTMLElement | null): HTMLInputElement | null {
	const input = container?.querySelector<HTMLInputElement>(SEARCH_INPUT_SELECTOR);
	if (!input) {
		return null;
	}

	input.focus({ preventScroll: true });
	return input;
}

export function focusResultEdge(
	container: HTMLElement | null,
	direction: ResultFocusDirection,
): HTMLElement | null {
	const targets = collectResultTargets(container);

	if (targets.length === 0) {
		return null;
	}

	const target = direction === "down" ? targets[0] : targets[targets.length - 1];
	return focusResultTarget(target);
}

export function findAdjacentResultSection(
	resultsContainer: HTMLElement | null,
	currentSection: HTMLElement | null,
	direction: ResultFocusDirection,
): HTMLElement | null {
	const sections = collectResultSections(resultsContainer);
	if (sections.length === 0 || !currentSection) {
		return null;
	}

	const currentIndex = sections.findIndex((section) => section === currentSection);
	if (currentIndex < 0) {
		return null;
	}

	const nextIndex = direction === "down" ? currentIndex + 1 : currentIndex - 1;
	return sections[nextIndex] ?? null;
}

export function scrollSectionIntoViewForFocus(
	section: HTMLElement,
	direction: ResultFocusDirection,
	scrollContainer: HTMLElement | null,
): void {
	const sectionRect = section.getBoundingClientRect();
	const sectionHeight = Math.max(
		sectionRect.height,
		section.scrollHeight,
		section.clientHeight,
		1,
	);

	if (scrollContainer) {
		const rootRect = scrollContainer.getBoundingClientRect();
		const viewportHeight = scrollContainer.clientHeight;
		const currentScrollTop = scrollContainer.scrollTop;
		const sectionTop = sectionRect.top - rootRect.top + currentScrollTop;
		const sectionBottom = sectionTop + sectionHeight;
		const viewportTop = currentScrollTop;
		const viewportBottom = viewportTop + viewportHeight;
		const nextScrollTop =
			direction === "down"
				? sectionTop >= viewportBottom
					? Math.max(0, sectionTop - viewportHeight + 1)
					: currentScrollTop
				: sectionBottom <= viewportTop
					? Math.max(0, sectionBottom - 1)
					: currentScrollTop;

		scrollContainer.scrollTop = Math.max(0, nextScrollTop);
		scrollContainer.dispatchEvent(createOwnerEvent(scrollContainer, "scroll"));
		return;
	}

	const ownerWindow = getOptionalOwnerWindow(section);
	if (!ownerWindow) {
		return;
	}

	const currentScrollTop = ownerWindow.scrollY || ownerWindow.pageYOffset || 0;
	const viewportHeight = ownerWindow.innerHeight;
	const sectionTop = sectionRect.top + currentScrollTop;
	const sectionBottom = sectionTop + sectionHeight;
	const viewportTop = currentScrollTop;
	const viewportBottom = viewportTop + viewportHeight;
	const nextScrollTop =
		direction === "down"
			? sectionTop >= viewportBottom
				? Math.max(0, sectionTop - viewportHeight + 1)
				: currentScrollTop
			: sectionBottom <= viewportTop
				? Math.max(0, sectionBottom - 1)
				: currentScrollTop;

	ownerWindow.scrollTo({
		top: Math.max(0, nextScrollTop),
	});
	ownerWindow.dispatchEvent(createOwnerEvent(ownerWindow, "scroll"));
}

export function moveFocusBetweenResults(
	container: HTMLElement | null,
	currentTarget: HTMLElement | null,
	direction: ResultNavigationDirection,
	searchInputContainer: HTMLElement | null = container,
): HTMLElement | HTMLInputElement | null {
	const targets = collectResultTargets(container);
	if (targets.length === 0) {
		return null;
	}

	const navigationTargets = buildNavigationTargets(container);
	const nextTarget = resolveNavigationTarget(
		navigationTargets,
		currentTarget,
		direction,
	);
	if (nextTarget) {
		return focusResultTarget(nextTarget.element);
	}

	const currentIdentity = currentTarget ? getTargetIdentity(currentTarget) : null;
	const currentIndex =
		currentIdentity !== null
			? targets.findIndex(
					(target) => getTargetIdentity(target) === currentIdentity,
				)
			: currentTarget
				? targets.indexOf(currentTarget)
				: -1;
	if (currentIndex < 0) {
		if (direction === "down") {
			return focusResultEdge(container, "down");
		}
		if (direction === "up") {
			return focusResultEdge(container, "up");
		}
		return null;
	}

	if (shouldUseLinearNavigationFallback(navigationTargets, currentTarget)) {
		return moveFocusLinearly(
			targets,
			currentIndex,
			direction,
			searchInputContainer,
		);
	}

	if (direction === "up" && currentIndex === 0) {
		return focusSearchInput(searchInputContainer);
	}

	return null;
}
