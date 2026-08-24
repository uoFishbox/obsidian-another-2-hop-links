import { Notice } from "obsidian";
import { LOAD_MORE_SELECTOR } from "cards/navigation/resultFocus";
import { querySelectorAllIncludingShadow } from "shared/ui/dom/shadowDom";
import { isElementVisible } from "shared/ui/dom/domUtils";
import {
	createOwnerMouseEvent,
	getOptionalOwnerWindow,
	isHTMLElementLike,
} from "shared/ui/dom/realmSafeDom";
import {
	collectVisibleKeyboardNavigationRows,
	KEYBOARD_ROW_TOP_TOLERANCE_PX,
	resolveKeyboardNavigationTargetSurface,
	type CardSurfaceHost,
	type KeyboardNavigationApp,
	type KeyboardNavigationRow,
	type KeyboardNavigationTargetSurface,
} from "./keyboardNavigationSurface";
import {
	centerKeyboardNavigationRow,
	estimateKeyboardNavigationScrollStep,
	findLastKeyboardNavigationRowIndex,
	resolveKeyboardNavigationScrollTarget,
	scrollKeyboardNavigationContainerBy,
} from "./keyboardNavigationScroll";

export type {
	CardSurfaceHost,
	KeyboardNavigationApp,
	KeyboardNavigationRow,
	KeyboardNavigationTargetSurface,
} from "./keyboardNavigationSurface";

const SHORT_HINT_KEYS = ["d", "f", "j", "k"] as const;
const LONG_HINT_KEYS = ["a", "s", "d", "f", "j", "k", "l", ";"] as const;
const HANDLED_HINT_KEYS = new Set<string>(LONG_HINT_KEYS);

type WindowWithEventConstructor = Window & {
	Event: typeof Event;
};

export class KeyboardCardNavigator {
	private rootEl: HTMLElement | null = null;
	private host: CardSurfaceHost | null = null;
	private rows: KeyboardNavigationRow[] = [];
	private selectedRowIndex = -1;
	private scrollFrameId: number | null = null;
	private scrollFrameWindow: Window | null = null;
	private keydownDocument: Document | null = null;
	private unregisterWindowMigration: (() => void) | null = null;
	private cachedScrollContainer: HTMLElement | null = null;
	private readonly handleDocumentKeydownBound = this.handleDocumentKeydown.bind(this);

	constructor(
		private readonly app: KeyboardNavigationApp,
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

		this.bindKeydownDocument();
		if (typeof this.rootEl.onWindowMigrated === "function") {
			this.unregisterWindowMigration = this.rootEl.onWindowMigrated(() => {
				this.bindKeydownDocument();
				if (this.scrollFrameId !== null) {
					this.scrollFrameWindow?.cancelAnimationFrame(this.scrollFrameId);
					this.scrollFrameId = null;
					this.scrollFrameWindow = null;
				}
				this.cachedScrollContainer = null;
				this.refreshRows(false);
			});
		}

		this.rootEl.focus({ preventScroll: true });

		if (!this.refreshRows(false)) {
			this.notify("No visible cards to navigate.");
			this.deactivate();
		}
	}

	public deactivate(): void {
		this.unregisterWindowMigration?.();
		this.unregisterWindowMigration = null;
		this.unbindKeydownDocument();

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

	private unbindKeydownDocument(): void {
		this.keydownDocument?.removeEventListener(
			"keydown",
			this.handleDocumentKeydownBound,
			true,
		);
		this.keydownDocument = null;
	}

	private bindKeydownDocument(): void {
		const nextDocument = this.rootEl?.ownerDocument ?? null;
		if (this.keydownDocument === nextDocument) return;
		this.unbindKeydownDocument();
		this.keydownDocument = nextDocument;
		this.keydownDocument?.addEventListener(
			"keydown",
			this.handleDocumentKeydownBound,
			true,
		);
	}

	public resolveTargetSurface(): KeyboardNavigationTargetSurface | null {
		return resolveKeyboardNavigationTargetSurface(this.app);
	}

	public collectVisibleRows(rootEl: HTMLElement): KeyboardNavigationRow[] {
		return collectVisibleKeyboardNavigationRows(rootEl);
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
			this.scrollFrameWindow?.cancelAnimationFrame(this.scrollFrameId);
			this.scrollFrameId = null;
			this.scrollFrameWindow = null;
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
		scrollKeyboardNavigationContainerBy(
			scrollContainer,
			delta * scrollStep,
			this.createOwnerEvent.bind(this),
		);

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
								(row) =>
									row.top >
									anchorTop + KEYBOARD_ROW_TOP_TOLERANCE_PX / 2,
							)
						: this.findLastIndex(
								this.rows,
								(row) =>
									row.top <
									anchorTop - KEYBOARD_ROW_TOP_TOLERANCE_PX / 2,
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
		centerKeyboardNavigationRow(row, target, this.createOwnerEvent.bind(this));
	}

	private resolveScrollTarget(): HTMLElement | Window | null {
		const resolved = resolveKeyboardNavigationScrollTarget(
			this.rootEl,
			this.cachedScrollContainer,
		);
		this.cachedScrollContainer = resolved.cachedContainer;
		return resolved.target;
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
		return estimateKeyboardNavigationScrollStep(
			this.rows,
			this.selectedRowIndex,
			delta,
		);
	}

	private getHintKeysForRow(cardCount: number): string[] {
		const keys =
			cardCount <= SHORT_HINT_KEYS.length ? SHORT_HINT_KEYS : LONG_HINT_KEYS;
		return keys.slice(0, cardCount);
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
		return findLastKeyboardNavigationRowIndex(items, predicate);
	}
}
