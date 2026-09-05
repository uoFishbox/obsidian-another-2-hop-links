import { CARD_SELECTOR, LOAD_MORE_SELECTOR } from "cards/navigation/resultTargets";
import { isElementVisible } from "shared/ui/dom/domUtils";
import { querySelectorAllIncludingShadow } from "shared/ui/dom/shadowDom";

export const KEYBOARD_ROW_TOP_TOLERANCE_PX = 8;

const ROW_ELEMENT_SELECTOR = `${CARD_SELECTOR}, ${LOAD_MORE_SELECTOR}`;
const SURFACE_PLACEMENT_PRIORITY: Readonly<Record<string, number>> = {
	editor: 3,
	sidebar: 2,
	workspace: 1,
};

export interface KeyboardNavigationSurfaceRegistry {
	/** Registers a mounted card surface and returns its idempotent cleanup function. */
	register(rootEl: HTMLElement): () => void;
	/** Returns the best mounted surface that currently contains navigable rows. */
	findBestVisibleSurface(): HTMLElement | null;
	/** Removes every registration owned by this registry. */
	clear(): void;
}

export interface KeyboardNavigationRow {
	top: number;
	bottom: number;
	elements: HTMLElement[];
}

interface VisibleRowEntry {
	element: HTMLElement;
	top: number;
	left: number;
	bottom: number;
}

interface RegisteredSurface {
	rootEl: HTMLElement;
	order: number;
}

/** Creates a registry whose lifetime is owned by one plugin runtime. */
export function createKeyboardNavigationSurfaceRegistry(): KeyboardNavigationSurfaceRegistry {
	const registrations = new Map<symbol, RegisteredSurface>();
	let nextOrder = 0;

	function register(rootEl: HTMLElement): () => void {
		const registrationId = Symbol("keyboard-navigation-surface");
		registrations.set(registrationId, {
			rootEl,
			order: nextOrder++,
		});

		let isRegistered = true;
		return () => {
			if (!isRegistered) return;
			isRegistered = false;
			registrations.delete(registrationId);
		};
	}

	function findBestVisibleSurface(): HTMLElement | null {
		const candidates = Array.from(registrations.values()).filter(({ rootEl }) => {
			return (
				rootEl.isConnected &&
				isElementVisible(rootEl) &&
				collectVisibleKeyboardNavigationRows(rootEl).length > 0
			);
		});

		candidates.sort((left, right) => {
			const preferredDifference =
				Number(isPreferred(right.rootEl)) - Number(isPreferred(left.rootEl));
			if (preferredDifference !== 0) return preferredDifference;

			const placementDifference =
				getPlacementPriority(right.rootEl) - getPlacementPriority(left.rootEl);
			if (placementDifference !== 0) return placementDifference;

			return right.order - left.order;
		});

		return candidates[0]?.rootEl ?? null;
	}

	return {
		register,
		findBestVisibleSurface,
		clear: () => registrations.clear(),
	};
}

/** Collects visible card/load-more rows from a surface, including shadow roots. */
export function collectVisibleKeyboardNavigationRows(
	rootEl: HTMLElement,
): KeyboardNavigationRow[] {
	const elements = querySelectorAllIncludingShadow<HTMLElement>(
		rootEl,
		ROW_ELEMENT_SELECTOR,
	);
	const rowElements: VisibleRowEntry[] = [];
	for (const element of elements) {
		const rect = element.getBoundingClientRect();
		if (!isElementVisible(element) || rect.width <= 0 || rect.height <= 0) {
			continue;
		}

		rowElements.push({
			element,
			top: rect.top,
			left: rect.left,
			bottom: rect.bottom,
		});
	}
	rowElements.sort((left, right) => {
		if (Math.abs(left.top - right.top) > KEYBOARD_ROW_TOP_TOLERANCE_PX) {
			return left.top - right.top;
		}
		return left.left - right.left;
	});

	const rows: KeyboardNavigationRow[] = [];
	for (const entry of rowElements) {
		const lastRow = rows.at(-1);
		if (
			lastRow &&
			Math.abs(lastRow.top - entry.top) <= KEYBOARD_ROW_TOP_TOLERANCE_PX
		) {
			lastRow.elements.push(entry.element);
			lastRow.top = Math.min(lastRow.top, entry.top);
			lastRow.bottom = Math.max(lastRow.bottom, entry.bottom);
			continue;
		}

		rows.push({
			top: entry.top,
			bottom: entry.bottom,
			elements: [entry.element],
		});
	}

	return rows.sort((left, right) => left.top - right.top);
}

function isPreferred(rootEl: HTMLElement): boolean {
	return rootEl.closest(".workspace-leaf.mod-active") !== null;
}

function getPlacementPriority(rootEl: HTMLElement): number {
	return SURFACE_PLACEMENT_PRIORITY[rootEl.dataset.cclCardSurface ?? ""] ?? 0;
}
