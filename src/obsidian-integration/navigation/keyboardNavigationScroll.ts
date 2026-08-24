import { findNearestScrollContainer } from "shared/ui/scroll/scrollContainer";
import { getOptionalOwnerWindow, isHTMLElementLike } from "shared/ui/dom/realmSafeDom";
import {
	KEYBOARD_ROW_TOP_TOLERANCE_PX,
	type KeyboardNavigationRow,
} from "./keyboardNavigationSurface";

const MIN_SCROLL_STEP_PX = 24;

export type KeyboardNavigationScrollTarget = HTMLElement | Window;

export interface ResolvedKeyboardNavigationScrollTarget {
	readonly target: KeyboardNavigationScrollTarget | null;
	readonly cachedContainer: HTMLElement | null;
}

export function resolveKeyboardNavigationScrollTarget(
	rootEl: HTMLElement | null,
	cachedContainer: HTMLElement | null,
): ResolvedKeyboardNavigationScrollTarget {
	if (!rootEl) {
		return { target: null, cachedContainer: null };
	}

	if (cachedContainer?.isConnected && cachedContainer.contains(rootEl)) {
		return { target: cachedContainer, cachedContainer };
	}

	const nextContainer = findNearestScrollContainer(rootEl);
	return {
		target: nextContainer ?? getOptionalOwnerWindow(rootEl),
		cachedContainer: nextContainer,
	};
}

export function estimateKeyboardNavigationScrollStep(
	rows: readonly KeyboardNavigationRow[],
	selectedRowIndex: number,
	delta: -1 | 1,
): number {
	const currentRow = rows[selectedRowIndex];
	const adjacentRow = rows[selectedRowIndex + delta];
	if (currentRow && adjacentRow) {
		return Math.max(MIN_SCROLL_STEP_PX, Math.abs(adjacentRow.top - currentRow.top));
	}

	if (currentRow) {
		return Math.max(
			MIN_SCROLL_STEP_PX,
			currentRow.bottom - currentRow.top + KEYBOARD_ROW_TOP_TOLERANCE_PX,
		);
	}

	return MIN_SCROLL_STEP_PX;
}

export function findLastKeyboardNavigationRowIndex<T>(
	items: readonly T[],
	predicate: (value: T) => boolean,
): number {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		if (predicate(items[index])) return index;
	}

	return -1;
}

export function scrollKeyboardNavigationContainerBy(
	scrollContainer: HTMLElement,
	delta: number,
	createOwnerEvent: (target: Node | Window, type: string) => Event,
): boolean {
	const nextScrollTop = Math.max(0, scrollContainer.scrollTop + delta);
	const previous = scrollContainer.scrollTop;
	scrollContainer.scrollTop = nextScrollTop;
	if (scrollContainer.scrollTop === previous) return false;

	scrollContainer.dispatchEvent(createOwnerEvent(scrollContainer, "scroll"));
	return true;
}

export function centerKeyboardNavigationRow(
	row: KeyboardNavigationRow,
	target: KeyboardNavigationScrollTarget | null,
	createOwnerEvent: (target: Node | Window, type: string) => Event,
): void {
	if (!target) return;

	const rowCenter = (row.top + row.bottom) / 2;
	if (isHTMLElementLike(target)) {
		const rect = target.getBoundingClientRect();
		const viewportCenter = rect.top + target.clientHeight / 2;
		const delta = rowCenter - viewportCenter;
		if (Math.abs(delta) >= 1) {
			scrollKeyboardNavigationContainerBy(target, delta, createOwnerEvent);
		}
		return;
	}

	const viewportCenter = target.innerHeight / 2;
	const delta = rowCenter - viewportCenter;
	if (Math.abs(delta) < 1) return;

	target.scrollTo({
		top: Math.max(0, target.scrollY + delta),
	});
	target.dispatchEvent(createOwnerEvent(target, "scroll"));
}
