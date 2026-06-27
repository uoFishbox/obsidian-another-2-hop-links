import { MarkdownView, Notice, type WorkspaceLeaf } from "obsidian";
import { findNearestScrollContainer } from "ui/components/common/virtualGridLinkListScroll";
import { TWO_HOP_LINKS_VIEW_TYPE } from "ui/views/TwoHopLinksView";
import { VIEW_TYPE_PRE_CREATE } from "ui/views/PreCreationView";
import { VIEW_TYPE_TAG_NOTES } from "ui/views/TagNotesView";
import { CARD_SELECTOR, LOAD_MORE_SELECTOR } from "./resultFocus";
import { querySelectorAllIncludingShadow } from "ui/utils/shadowDom";
import { isElementVisible } from "ui/utils/domUtils";
import {
	createOwnerMouseEvent,
	getOptionalOwnerWindow,
	isHTMLElementLike,
} from "ui/utils/realmSafeDom";

const INLINE_SURFACE_SELECTOR =
	'.cosense-card-links__root[data-ccl-card-surface="inline"]';
const SIDEBAR_SURFACE_SELECTOR =
	'.cosense-card-links__root[data-ccl-card-surface="sidebar"]';
const EMPTY_SURFACE_SELECTOR = '[data-ccl-card-surface="empty"]';
const ROW_ELEMENT_SELECTOR = `${CARD_SELECTOR}, ${LOAD_MORE_SELECTOR}`;
const ROW_TOP_TOLERANCE_PX = 8;
const MIN_SCROLL_STEP_PX = 24;
const SHORT_HINT_KEYS = ["d", "f", "j", "k"] as const;
const LONG_HINT_KEYS = ["a", "s", "d", "f", "j", "k", "l", ";"] as const;
const HANDLED_HINT_KEYS = new Set<string>(LONG_HINT_KEYS);

type WindowWithEventConstructor = Window & {
	Event: typeof Event;
};

type CardSurfaceHost = "inline" | "sidebar" | "empty";

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

interface AppLike {
	workspace: WorkspaceLike;
}

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

export class KeyboardCardNavigator {
	private rootEl: HTMLElement | null = null;
	private host: CardSurfaceHost | null = null;
	private rows: KeyboardNavigationRow[] = [];
	private selectedRowIndex = -1;
	private scrollFrameId: number | null = null;
	private scrollFrameWindow: Window | null = null;
	private keydownDocument: Document | null = null;
	private cachedScrollContainer: HTMLElement | null = null;
	private readonly handleDocumentKeydownBound = this.handleDocumentKeydown.bind(this);

	constructor(
		private readonly app: AppLike,
		private readonly notify: (message: string) => void = (message) =>
			new Notice(message),
	) {}

	public toggle(): void {
		if (this.rootEl) {
			this.deactivate();
			return;
		}

		const targetSurface = this.resolveTargetSurface();
		if (!targetSurface) {
			this.notify("No visible card surface found.");
			return;
		}

		this.activate(targetSurface.rootEl, targetSurface.host);
	}

	public activate(rootEl: HTMLElement, host: CardSurfaceHost): void {
		this.deactivate();

		this.rootEl = rootEl;
		this.host = host;
		this.rootEl.classList.add("ccl-kb-nav-active");
		this.rootEl.dataset.cclKbNavHost = host;

		this.keydownDocument = this.rootEl.ownerDocument;
		this.keydownDocument.addEventListener(
			"keydown",
			this.handleDocumentKeydownBound,
			true,
		);

		this.rootEl.focus({ preventScroll: true });

		if (!this.refreshRows(false)) {
			this.notify("No visible cards to navigate.");
			this.deactivate();
		}
	}

	public deactivate(): void {
		this.keydownDocument?.removeEventListener(
			"keydown",
			this.handleDocumentKeydownBound,
			true,
		);
		this.keydownDocument = null;

		if (this.scrollFrameId !== null) {
			this.scrollFrameWindow?.cancelAnimationFrame(this.scrollFrameId);
			this.scrollFrameId = null;
		}
		this.scrollFrameWindow = null;

		this.clearSelectionState();

		if (this.rootEl) {
			this.rootEl.classList.remove("ccl-kb-nav-active");
			delete this.rootEl.dataset.cclKbNavHost;
		}

		this.rootEl = null;
		this.host = null;
		this.rows = [];
		this.selectedRowIndex = -1;
		this.cachedScrollContainer = null;
	}

	public resolveTargetSurface(): KeyboardNavigationTargetSurface | null {
		const candidates: KeyboardNavigationTargetSurface[] = [];

		const activeMarkdownView = this.app.workspace.getActiveViewOfType(
			MarkdownView,
		) as MarkdownView | null;

		if (isHTMLElementLike(activeMarkdownView?.containerEl)) {
			const inlineSurface = this.findVisibleSurfaceRoot(
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

		for (const leaf of this.app.workspace.getLeavesOfType(
			TWO_HOP_LINKS_VIEW_TYPE,
		)) {
			const container = isHTMLElementLike(leaf.view?.contentEl)
				? leaf.view.contentEl
				: leaf.view?.containerEl;
			if (!isHTMLElementLike(container)) {
				continue;
			}

			const sidebarSurface = this.findVisibleSurfaceRoot(container, "sidebar");
			if (sidebarSurface) {
				candidates.push({
					rootEl: sidebarSurface,
					host: "sidebar",
				});
			}
		}

		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view as {
				getViewType?: () => string;
				contentEl?: HTMLElement;
				containerEl?: HTMLElement;
			} | null;
			const viewType = view?.getViewType?.();
			if (
				viewType !== "empty" &&
				viewType !== VIEW_TYPE_PRE_CREATE &&
				viewType !== VIEW_TYPE_TAG_NOTES
			) {
				return;
			}

			const container = isHTMLElementLike(view?.contentEl)
				? view.contentEl
				: view?.containerEl;
			if (!isHTMLElementLike(container)) {
				return;
			}

			const host: CardSurfaceHost = viewType === "empty" ? "empty" : "inline";
			const emptySurface = this.findVisibleSurfaceRoot(container, host);
			if (emptySurface) {
				candidates.push({
					rootEl: emptySurface,
					host,
				});
			}
		});

		return (
			candidates.find(
				(candidate) => this.collectVisibleRows(candidate.rootEl).length > 0,
			) ?? null
		);
	}

	public collectVisibleRows(rootEl: HTMLElement): KeyboardNavigationRow[] {
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
				isHintTarget: this.isHintTarget(element),
			});
		}
		rowElements.sort((left, right) => {
			if (Math.abs(left.top - right.top) > ROW_TOP_TOLERANCE_PX) {
				return left.top - right.top;
			}
			return left.left - right.left;
		});

		const rows: KeyboardNavigationRow[] = [];
		for (const entry of rowElements) {
			const lastRow = rows.at(-1);
			if (lastRow && Math.abs(lastRow.top - entry.top) <= ROW_TOP_TOLERANCE_PX) {
				lastRow.elements.push(entry.element);
				if (entry.isHintTarget) {
					lastRow.cards.push(entry.element);
				}
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

	public moveRow(delta: -1 | 1): void {
		if (!this.rootEl) {
			return;
		}

		if (!this.refreshRows(true)) {
			this.deactivate();
			return;
		}

		const targetIndex = this.selectedRowIndex + delta;
		if (targetIndex >= 0 && targetIndex < this.rows.length) {
			this.selectRow(targetIndex);
			return;
		}

		this.scrollToAdjacentRow(delta);
	}

	public activateCardByHint(key: string): void {
		if (!this.rootEl || this.selectedRowIndex < 0) {
			return;
		}

		const normalizedKey = key.toLowerCase();
		const selectedRow = this.rows[this.selectedRowIndex];
		if (!selectedRow) {
			return;
		}

		const hintKeys = this.getHintKeysForRow(selectedRow.elements.length);
		const elementIndex = hintKeys.indexOf(normalizedKey);
		if (elementIndex < 0) {
			return;
		}

		const targetElement = selectedRow.elements[elementIndex];
		if (!targetElement) {
			return;
		}

		if (this.isLoadMoreButton(targetElement)) {
			this.activateLoadMoreByHint(targetElement, this.selectedRowIndex);
			return;
		}

		this.deactivate();
		targetElement.dispatchEvent(
			createOwnerMouseEvent(targetElement, "click", {
				bubbles: true,
				cancelable: true,
				composed: true,
			}),
		);
	}

	private handleDocumentKeydown(event: KeyboardEvent): void {
		if (!this.rootEl) {
			return;
		}

		if (!this.rootEl.isConnected || !isElementVisible(this.rootEl)) {
			this.deactivate();
			return;
		}

		if (event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}

		if (this.isEditableTarget(event.target)) {
			return;
		}

		const key = event.key.toLowerCase();
		const isHandledKey =
			key === "arrowup" ||
			key === "arrowdown" ||
			key === "escape" ||
			HANDLED_HINT_KEYS.has(key);

		if (!isHandledKey) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation?.();

		if (key === "escape") {
			this.deactivate();
			return;
		}

		if (key === "arrowup") {
			this.moveRow(-1);
			return;
		}

		if (key === "arrowdown") {
			this.moveRow(1);
			return;
		}

		this.activateCardByHint(key);
	}

	private refreshRows(preserveSelection: boolean): boolean {
		if (!this.rootEl) {
			return false;
		}

		const previousSelectedElements =
			preserveSelection && this.selectedRowIndex >= 0
				? new Set(this.rows[this.selectedRowIndex]?.elements ?? [])
				: new Set<HTMLElement>();

		this.rows = this.collectVisibleRows(this.rootEl);
		if (this.rows.length === 0) {
			this.selectedRowIndex = -1;
			this.clearSelectionState();
			return false;
		}

		if (!preserveSelection) {
			this.selectRow(0);
			return true;
		}

		if (previousSelectedElements.size === 0) {
			const fallbackIndex =
				this.selectedRowIndex >= 0
					? Math.min(this.selectedRowIndex, this.rows.length - 1)
					: 0;
			this.selectRow(Math.max(0, fallbackIndex));
			return true;
		}

		const preservedIndex = this.rows.findIndex((row) =>
			row.elements.some((element) => previousSelectedElements.has(element)),
		);
		const nextIndex =
			preservedIndex >= 0
				? preservedIndex
				: Math.min(this.selectedRowIndex, this.rows.length - 1);
		this.selectRow(Math.max(0, nextIndex));
		return true;
	}

	private selectRow(index: number): void {
		if (!this.rootEl || this.rows.length === 0) {
			this.selectedRowIndex = -1;
			return;
		}

		const clampedIndex = Math.max(0, Math.min(index, this.rows.length - 1));
		this.selectedRowIndex = clampedIndex;
		this.clearSelectionState();

		const row = this.rows[clampedIndex];
		this.centerRow(row);
		for (const element of row.elements) {
			element.dataset.cclKbRowSelected = "1";
		}
		const hintKeys = this.getHintKeysForRow(row.elements.length);
		for (const [elementIndex, element] of row.elements.entries()) {
			const hintKey = hintKeys[elementIndex];
			if (hintKey) {
				element.dataset.cclKbHint = hintKey;
			}
		}
	}

	private clearSelectionState(): void {
		if (!this.rootEl) {
			return;
		}

		for (const card of querySelectorAllIncludingShadow<HTMLElement>(
			this.rootEl,
			"[data-ccl-kb-row-selected], [data-ccl-kb-hint]",
		)) {
			delete card.dataset.cclKbRowSelected;
			delete card.dataset.cclKbHint;
		}
	}

	private scrollToAdjacentRow(delta: -1 | 1): void {
		if (!this.rootEl || this.selectedRowIndex < 0) {
			return;
		}

		if (this.scrollFrameId !== null) {
			cancelAnimationFrame(this.scrollFrameId);
			this.scrollFrameId = null;
		}

		const currentRow = this.rows[this.selectedRowIndex];
		if (!currentRow) {
			return;
		}

		const scrollContainer = this.resolveScrollTarget();
		if (!isHTMLElementLike(scrollContainer)) {
			return;
		}

		const scrollStep = this.estimateScrollStep(delta);
		const anchorTop = currentRow.top;
		this.scrollBy(scrollContainer, delta * scrollStep);

		const ownerWindow = getOptionalOwnerWindow(this.rootEl);
		if (!ownerWindow) {
			return;
		}

		this.scrollFrameWindow = ownerWindow;
		this.scrollFrameId = ownerWindow.requestAnimationFrame(() => {
			this.scrollFrameId = ownerWindow.requestAnimationFrame(() => {
				this.scrollFrameId = null;
				this.scrollFrameWindow = null;

				if (!this.rootEl) {
					return;
				}

				this.rows = this.collectVisibleRows(this.rootEl);
				if (this.rows.length === 0) {
					this.deactivate();
					return;
				}

				const nextIndex =
					delta > 0
						? this.rows.findIndex(
								(row) => row.top > anchorTop + ROW_TOP_TOLERANCE_PX / 2,
							)
						: this.findLastIndex(
								this.rows,
								(row) => row.top < anchorTop - ROW_TOP_TOLERANCE_PX / 2,
							);

				if (nextIndex >= 0) {
					this.selectRow(nextIndex);
					return;
				}

				this.selectRow(delta > 0 ? this.rows.length - 1 : 0);
			});
		});
	}

	private centerRow(row: KeyboardNavigationRow): void {
		const target = this.resolveScrollTarget();
		if (!target) {
			return;
		}

		const rowCenter = (row.top + row.bottom) / 2;

		if (isHTMLElementLike(target)) {
			const rect = target.getBoundingClientRect();
			const viewportCenter = rect.top + target.clientHeight / 2;
			const delta = rowCenter - viewportCenter;

			if (Math.abs(delta) >= 1) {
				this.scrollBy(target, delta);
			}
			return;
		}

		const viewportCenter = target.innerHeight / 2;
		const delta = rowCenter - viewportCenter;

		if (Math.abs(delta) >= 1) {
			target.scrollTo({
				top: Math.max(0, target.scrollY + delta),
			});
			target.dispatchEvent(this.createOwnerEvent(target, "scroll"));
		}
	}

	private resolveScrollTarget(): HTMLElement | Window | null {
		const rootEl = this.rootEl;
		if (!rootEl) {
			this.cachedScrollContainer = null;
			return null;
		}

		if (
			this.cachedScrollContainer?.isConnected &&
			this.cachedScrollContainer.contains(rootEl)
		) {
			return this.cachedScrollContainer;
		}

		this.cachedScrollContainer = findNearestScrollContainer(rootEl);
		return this.cachedScrollContainer ?? getOptionalOwnerWindow(rootEl);
	}

	private setScrollTop(scrollContainer: HTMLElement, nextScrollTop: number): boolean {
		const clamped = Math.max(0, nextScrollTop);
		const previous = scrollContainer.scrollTop;

		scrollContainer.scrollTop = clamped;

		if (scrollContainer.scrollTop !== previous) {
			scrollContainer.dispatchEvent(
				this.createOwnerEvent(scrollContainer, "scroll"),
			);
			return true;
		}

		return false;
	}

	private scrollBy(scrollContainer: HTMLElement, delta: number): boolean {
		return this.setScrollTop(scrollContainer, scrollContainer.scrollTop + delta);
	}

	private activateLoadMoreByHint(
		loadMoreButton: HTMLButtonElement,
		rowIndex: number,
	): void {
		if (this.scrollFrameId !== null) {
			this.scrollFrameWindow?.cancelAnimationFrame(this.scrollFrameId);
			this.scrollFrameId = null;
		}
		this.scrollFrameWindow = null;

		loadMoreButton.click();

		const ownerWindow = getOptionalOwnerWindow(loadMoreButton);
		if (!ownerWindow) {
			return;
		}

		this.scrollFrameWindow = ownerWindow;
		this.scrollFrameId = ownerWindow.requestAnimationFrame(() => {
			this.scrollFrameId = null;
			this.scrollFrameWindow = null;

			if (!this.rootEl) {
				return;
			}

			this.rows = this.collectVisibleRows(this.rootEl);
			if (this.rows.length === 0) {
				this.deactivate();
				return;
			}

			this.selectRow(Math.min(rowIndex, this.rows.length - 1));
		});
	}

	private estimateScrollStep(delta: -1 | 1): number {
		const currentRow = this.rows[this.selectedRowIndex];
		const adjacentRow = this.rows[this.selectedRowIndex + delta];
		if (currentRow && adjacentRow) {
			return Math.max(
				MIN_SCROLL_STEP_PX,
				Math.abs(adjacentRow.top - currentRow.top),
			);
		}

		if (currentRow) {
			return Math.max(
				MIN_SCROLL_STEP_PX,
				currentRow.bottom - currentRow.top + ROW_TOP_TOLERANCE_PX,
			);
		}

		return MIN_SCROLL_STEP_PX;
	}

	private getHintKeysForRow(cardCount: number): string[] {
		const keys =
			cardCount <= SHORT_HINT_KEYS.length ? SHORT_HINT_KEYS : LONG_HINT_KEYS;
		return keys.slice(0, cardCount);
	}

	private findVisibleSurfaceRoot(
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
				if (isElementVisible(surface)) {
					return surface;
				}
			}
		}

		return null;
	}

	private isHintTarget(element: HTMLElement): boolean {
		return element.matches(CARD_SELECTOR);
	}

	private isLoadMoreButton(element: HTMLElement): element is HTMLButtonElement {
		return element.matches(LOAD_MORE_SELECTOR);
	}

	private isEditableTarget(target: EventTarget | null): boolean {
		if (!isHTMLElementLike(target)) {
			return false;
		}

		const tagName = target.tagName.toUpperCase();
		return (
			tagName === "INPUT" ||
			tagName === "TEXTAREA" ||
			tagName === "SELECT" ||
			target.isContentEditable
		);
	}

	private createOwnerEvent(target: Node | Window, type: string): Event {
		const ownerWindow = (
			"document" in target ? target : getOptionalOwnerWindow(target)
		) as WindowWithEventConstructor | null;
		return ownerWindow ? new ownerWindow.Event(type) : new Event(type);
	}

	private findLastIndex<T>(items: T[], predicate: (value: T) => boolean): number {
		for (let index = items.length - 1; index >= 0; index -= 1) {
			if (predicate(items[index])) {
				return index;
			}
		}

		return -1;
	}
}
