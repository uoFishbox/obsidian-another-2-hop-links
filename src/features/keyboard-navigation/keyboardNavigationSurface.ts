import { MarkdownView, type WorkspaceLeaf } from "obsidian";
import { TWO_HOP_LINKS_VIEW_TYPE } from "features/two-hop/ui/TwoHopLinksView";
import { VIEW_TYPE_PRE_CREATE } from "features/pre-creation/ui/PreCreationView";
import { VIEW_TYPE_TAG_NOTES } from "features/tag-notes/ui/TagNotesView";
import { VIEW_TYPE_ALL_NOTES } from "features/all-notes/ui/AllNotesView";
import { CARD_SELECTOR, LOAD_MORE_SELECTOR } from "./resultFocus";
import { querySelectorAllIncludingShadow } from "ui/shared/dom/shadowDom";
import { isElementVisible } from "ui/shared/dom/domUtils";
import { isHTMLElementLike } from "ui/shared/dom/realmSafeDom";

export const KEYBOARD_ROW_TOP_TOLERANCE_PX = 8;

const INLINE_SURFACE_SELECTOR =
	'.cosense-card-links__root[data-ccl-card-surface="inline"]';
const SIDEBAR_SURFACE_SELECTOR =
	'.cosense-card-links__root[data-ccl-card-surface="sidebar"]';
const EMPTY_SURFACE_SELECTOR = '[data-ccl-card-surface="empty"]';
const ROW_ELEMENT_SELECTOR = `${CARD_SELECTOR}, ${LOAD_MORE_SELECTOR}`;

export type CardSurfaceHost = "inline" | "sidebar" | "empty";

export interface KeyboardNavigationTargetSurface {
	rootEl: HTMLElement;
	host: CardSurfaceHost;
}

export interface KeyboardNavigationRow {
	top: number;
	bottom: number;
	elements: HTMLElement[];
	cards: HTMLElement[];
}

interface VisibleRowEntry {
	element: HTMLElement;
	top: number;
	left: number;
	bottom: number;
	isHintTarget: boolean;
}

interface WorkspaceLike {
	activeLeaf?: {
		view?: unknown;
	} | null;
	getActiveViewOfType(type: new (...args: any[]) => unknown): unknown | null;
	getLeavesOfType(type: string): Array<{
		view?: {
			contentEl?: HTMLElement;
			containerEl?: HTMLElement;
		};
	}>;
	iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => void): void;
}

export interface KeyboardNavigationApp {
	workspace: WorkspaceLike;
}

/** Resolves the first visible card surface that can accept keyboard navigation. */
export function resolveKeyboardNavigationTargetSurface(
	app: KeyboardNavigationApp,
): KeyboardNavigationTargetSurface | null {
	const candidates: KeyboardNavigationTargetSurface[] = [];

	const activeMarkdownView = app.workspace.getActiveViewOfType(
		MarkdownView,
	) as MarkdownView | null;

	if (isHTMLElementLike(activeMarkdownView?.containerEl)) {
		const inlineSurface = findVisibleSurfaceRoot(
			activeMarkdownView.containerEl,
			"inline",
		);
		if (inlineSurface) {
			candidates.push({
				rootEl: inlineSurface,
				host: "inline",
			});
		}
	}

	for (const leaf of app.workspace.getLeavesOfType(TWO_HOP_LINKS_VIEW_TYPE)) {
		const container = isHTMLElementLike(leaf.view?.contentEl)
			? leaf.view.contentEl
			: leaf.view?.containerEl;
		if (!isHTMLElementLike(container)) continue;

		const sidebarSurface = findVisibleSurfaceRoot(container, "sidebar");
		if (sidebarSurface) {
			candidates.push({
				rootEl: sidebarSurface,
				host: "sidebar",
			});
		}
	}

	app.workspace.iterateAllLeaves((leaf) => {
		const view = leaf.view as {
			getViewType?: () => string;
			contentEl?: HTMLElement;
			containerEl?: HTMLElement;
		} | null;
		const viewType = view?.getViewType?.();
		if (
			viewType !== "empty" &&
			viewType !== VIEW_TYPE_ALL_NOTES &&
			viewType !== VIEW_TYPE_PRE_CREATE &&
			viewType !== VIEW_TYPE_TAG_NOTES
		) {
			return;
		}

		const container = isHTMLElementLike(view?.contentEl)
			? view.contentEl
			: view?.containerEl;
		if (!isHTMLElementLike(container)) return;

		const host: CardSurfaceHost =
			viewType === "empty" || viewType === VIEW_TYPE_ALL_NOTES
				? "empty"
				: "inline";
		const emptySurface = findVisibleSurfaceRoot(container, host);
		if (emptySurface) {
			candidates.push({
				rootEl: emptySurface,
				host,
			});
		}
	});

	return (
		candidates.find(
			(candidate) =>
				collectVisibleKeyboardNavigationRows(candidate.rootEl).length > 0,
		) ?? null
	);
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
			isHintTarget: element.matches(CARD_SELECTOR),
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
			if (entry.isHintTarget) lastRow.cards.push(entry.element);
			lastRow.top = Math.min(lastRow.top, entry.top);
			lastRow.bottom = Math.max(lastRow.bottom, entry.bottom);
			continue;
		}

		rows.push({
			top: entry.top,
			bottom: entry.bottom,
			elements: [entry.element],
			cards: entry.isHintTarget ? [entry.element] : [],
		});
	}

	return rows.sort((left, right) => left.top - right.top);
}

function findVisibleSurfaceRoot(
	containerEl: HTMLElement,
	host: CardSurfaceHost,
): HTMLElement | null {
	const selectors =
		host === "inline"
			? [
					INLINE_SURFACE_SELECTOR,
					'.cosense-card-links__temp-view[data-ccl-card-surface="inline"]',
				]
			: host === "sidebar"
				? [SIDEBAR_SURFACE_SELECTOR]
				: [EMPTY_SURFACE_SELECTOR];

	for (const selector of selectors) {
		const surfaces = Array.from(
			containerEl.querySelectorAll<HTMLElement>(selector),
		);

		for (const surface of surfaces) {
			if (isElementVisible(surface)) return surface;
		}
	}

	return null;
}
