import { Notice } from "obsidian";
import {
	getResultTargetIdentity,
	LOAD_MORE_SELECTOR,
} from "cards/navigation/resultTargets";
import { querySelectorAllIncludingShadow } from "shared/ui/dom/shadowDom";
import { isElementVisible } from "shared/ui/dom/domUtils";
import {
	createOwnerMouseEvent,
	getOptionalOwnerWindow,
	isHTMLElementLike,
} from "shared/ui/dom/realmSafeDom";
import {
	scheduleAfterAnimationFrames,
	type ScheduledFrameTask,
} from "shared/ui/scheduling/frame";
import {
	collectVisibleKeyboardNavigationRows,
	KEYBOARD_ROW_TOP_TOLERANCE_PX,
	type KeyboardNavigationSurfaceRegistry,
	type KeyboardNavigationRow,
} from "./keyboardNavigationSurface";
import {
	centerKeyboardNavigationRow,
	estimateKeyboardNavigationScrollStep,
	findLastKeyboardNavigationRowIndex,
	resolveKeyboardNavigationScrollTarget,
	scrollKeyboardNavigationContainerBy,
} from "./keyboardNavigationScroll";

export type {
	KeyboardNavigationSurfaceRegistry,
	KeyboardNavigationRow,
} from "./keyboardNavigationSurface";

const SHORT_HINT_KEYS = ["d", "f", "j", "k"] as const;
const LONG_HINT_KEYS = ["a", "s", "d", "f", "j", "k", "l", ";"] as const;
const HANDLED_HINT_KEYS = new Set<string>(LONG_HINT_KEYS);

// Global keyboard mode owns its shortcuts before CardGrid's local keydown policy.
const GLOBAL_KEYBOARD_MODE_CAPTURE = true;

type WindowWithEventConstructor = Window & {
	Event: typeof Event;
};

export class KeyboardCardNavigator {
	private rootEl: HTMLElement | null = null;
	private rows: KeyboardNavigationRow[] = [];
	private selectedRowIndex = -1;
	private selectedItemIds = new Set<string>();
	private pendingLayoutTask: ScheduledFrameTask | null = null;
	private keydownDocument: Document | null = null;
	private unregisterWindowMigration: (() => void) | null = null;
	private cachedScrollContainer: HTMLElement | null = null;
	private readonly handleDocumentKeydownBound = this.handleDocumentKeydown.bind(this);

	constructor(
		private readonly surfaceRegistry: KeyboardNavigationSurfaceRegistry,
		private readonly notify: (message: string) => void = (message) =>
			new Notice(message),
	) {}

	public toggle(): void {
		if (this.rootEl) {
			this.deactivate();
			return;
		}

		const targetSurface = this.surfaceRegistry.findBestVisibleSurface();
		if (!targetSurface) {
			this.notify("No visible card surface found.");
			return;
		}

		this.activate(targetSurface);
	}

	public activate(rootEl: HTMLElement): void {
		this.deactivate();

		this.rootEl = rootEl;
		this.rootEl.classList.add("ccl-kb-nav-active");

		this.bindKeydownDocument();
		if (typeof this.rootEl.onWindowMigrated === "function") {
			this.unregisterWindowMigration = this.rootEl.onWindowMigrated(() => {
				this.bindKeydownDocument();
				this.cancelPendingLayoutTask();
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

		this.cancelPendingLayoutTask();

		this.clearSelectionState();

		if (this.rootEl) {
			this.rootEl.classList.remove("ccl-kb-nav-active");
		}

		this.rootEl = null;
		this.rows = [];
		this.selectedRowIndex = -1;
		this.selectedItemIds.clear();
		this.cachedScrollContainer = null;
	}

	private unbindKeydownDocument(): void {
		this.keydownDocument?.removeEventListener(
			"keydown",
			this.handleDocumentKeydownBound,
			GLOBAL_KEYBOARD_MODE_CAPTURE,
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
			GLOBAL_KEYBOARD_MODE_CAPTURE,
		);
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

		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (this.isEditableTarget(event.target)) return;

		const key = event.key.toLowerCase();
		if (
			key !== "arrowup" &&
			key !== "arrowdown" &&
			key !== "escape" &&
			!HANDLED_HINT_KEYS.has(key)
		) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation?.();

		if (key === "arrowup") this.moveRow(-1);
		else if (key === "arrowdown") this.moveRow(1);
		else if (key === "escape") this.deactivate();
		else this.activateCardByHint(key);
	}

	private refreshRows(preserveSelection: boolean): boolean {
		if (!this.rootEl) {
			return false;
		}

		const previousSelectedItemIds =
			preserveSelection && this.selectedRowIndex >= 0
				? new Set(this.selectedItemIds)
				: new Set<string>();

		this.rows = collectVisibleKeyboardNavigationRows(this.rootEl);
		if (this.rows.length === 0) {
			this.selectedRowIndex = -1;
			this.selectedItemIds.clear();
			this.clearSelectionState();
			return false;
		}

		if (!preserveSelection) {
			this.selectRow(0);
			return true;
		}

		if (previousSelectedItemIds.size === 0) {
			const fallbackIndex =
				this.selectedRowIndex >= 0
					? Math.min(this.selectedRowIndex, this.rows.length - 1)
					: 0;
			this.selectRow(Math.max(0, fallbackIndex));
			return true;
		}

		const preservedIndex = this.rows.findIndex((row) =>
			row.elements.some((element) => {
				const itemId = getResultTargetIdentity(element);
				return itemId !== null && previousSelectedItemIds.has(itemId);
			}),
		);
		const nextIndex =
			preservedIndex >= 0
				? preservedIndex
				: Math.min(this.selectedRowIndex, this.rows.length - 1);
		this.selectRow(Math.max(0, nextIndex));
		return true;
	}

	private collectRowItemIds(row: KeyboardNavigationRow | undefined): Set<string> {
		const itemIds = new Set<string>();
		for (const element of row?.elements ?? []) {
			const itemId = getResultTargetIdentity(element);
			if (itemId !== null) itemIds.add(itemId);
		}
		return itemIds;
	}

	private selectRow(index: number): void {
		if (!this.rootEl || this.rows.length === 0) {
			this.selectedRowIndex = -1;
			this.selectedItemIds.clear();
			return;
		}

		const clampedIndex = Math.max(0, Math.min(index, this.rows.length - 1));
		this.selectedRowIndex = clampedIndex;
		this.clearSelectionState();

		const row = this.rows[clampedIndex];
		this.selectedItemIds = this.collectRowItemIds(row);
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

		this.cancelPendingLayoutTask();

		const currentRow = this.rows[this.selectedRowIndex];
		if (!currentRow) {
			return;
		}

		const scrollContainer = this.resolveScrollTarget();
		if (!isHTMLElementLike(scrollContainer)) {
			return;
		}

		const scrollStep = estimateKeyboardNavigationScrollStep(
			this.rows,
			this.selectedRowIndex,
			delta,
		);
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

		this.pendingLayoutTask = scheduleAfterAnimationFrames(ownerWindow, 2, () => {
			this.pendingLayoutTask = null;

			if (!this.rootEl) {
				return;
			}

			this.rows = collectVisibleKeyboardNavigationRows(this.rootEl);
			if (this.rows.length === 0) {
				this.deactivate();
				return;
			}

			const nextIndex =
				delta > 0
					? this.rows.findIndex(
							(row) =>
								row.top > anchorTop + KEYBOARD_ROW_TOP_TOLERANCE_PX / 2,
						)
					: this.findLastIndex(
							this.rows,
							(row) =>
								row.top < anchorTop - KEYBOARD_ROW_TOP_TOLERANCE_PX / 2,
						);

			if (nextIndex >= 0) {
				this.selectRow(nextIndex);
				return;
			}

			this.selectRow(delta > 0 ? this.rows.length - 1 : 0);
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
		this.cancelPendingLayoutTask();

		loadMoreButton.click();

		const ownerWindow = getOptionalOwnerWindow(loadMoreButton);
		if (!ownerWindow) {
			return;
		}

		this.pendingLayoutTask = scheduleAfterAnimationFrames(ownerWindow, 1, () => {
			this.pendingLayoutTask = null;

			if (!this.rootEl) {
				return;
			}

			this.rows = collectVisibleKeyboardNavigationRows(this.rootEl);
			if (this.rows.length === 0) {
				this.deactivate();
				return;
			}

			this.selectRow(Math.min(rowIndex, this.rows.length - 1));
		});
	}

	private cancelPendingLayoutTask(): void {
		this.pendingLayoutTask?.cancel();
		this.pendingLayoutTask = null;
	}

	private getHintKeysForRow(targetCount: number): string[] {
		const keys =
			targetCount <= SHORT_HINT_KEYS.length ? SHORT_HINT_KEYS : LONG_HINT_KEYS;
		return keys.slice(0, targetCount);
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
