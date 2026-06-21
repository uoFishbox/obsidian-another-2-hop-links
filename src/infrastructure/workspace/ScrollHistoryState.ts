// --- START OF FILE core/managers/ScrollManager.ts ---
import { MarkdownView, type EditorPosition } from "obsidian";
import { CONTAINER_CLASS } from "../../appConstants";

interface ScrollState {
	scrollTop: number;
	cursor?: EditorPosition;
}

export class ScrollManager {
	// Leaf IDごとのスクロール状態を保持
	private history = new Map<string, ScrollState>();

	/**
	 * 指定されたLeafの履歴をクリアする
	 * ファイル切り替え時などに呼び出す
	 */
	public clearHistory(leafId: string): void {
		this.history.delete(leafId);
	}

	/**
	 * スクロール位置をトグルする
	 * 1. Two Hop Linksコンテナへスクロール
	 * 2. 元の位置へスクロール
	 */
	public toggleScroll(view: MarkdownView): void {
		const leafId = view.leaf.id;
		const container = view.containerEl.querySelector(`.${CONTAINER_CLASS}`);

		// コンテナが存在しない（設定で非表示など）場合は何もしない
		if (!container) return;

		if (this.history.has(leafId)) {
			// --- 履歴がある場合: 元の位置に戻る ---
			this.restorePosition(view, leafId);
		} else {
			// --- 履歴がない場合: 現在位置を保存して下にスクロール ---
			this.saveAndScrollToContainer(view, leafId, container);
		}
	}

	private saveAndScrollToContainer(
		view: MarkdownView,
		leafId: string,
		container: Element,
	): void {
		const mode = view.getMode();
		let scrollTop = 0;
		let cursor: EditorPosition | undefined;

		// 現在の位置を取得
		if (mode === "source") {
			scrollTop = view.editor.getScrollInfo().top;
			cursor = view.editor.getCursor();
		} else {
			scrollTop = view.previewMode.getScroll();
		}

		// 履歴に保存
		this.history.set(leafId, { scrollTop, cursor });

		// コンテナまでスクロール
		container.scrollIntoView({ block: "start" });

		// 検索バーにフォーカスを当てる
		const searchInput = container.querySelector(
			".twohop-search-input",
		) as HTMLInputElement | null;
		if (searchInput) {
			searchInput.focus();
		}
	}

	private restorePosition(view: MarkdownView, leafId: string): void {
		const state = this.history.get(leafId);
		if (!state) return;

		const mode = view.getMode();

		if (mode === "source") {
			this.restoreSourceModePosition(view, state);
		} else {
			// プレビューモードの復元
			view.previewMode.applyScroll(state.scrollTop);
		}

		// 履歴を消費して削除
		this.history.delete(leafId);
	}

	private restoreSourceModePosition(
		view: MarkdownView,
		state: ScrollState,
	): void {
		// setCursor/focusでスクロールが再調整されるため、最後にscrollTopを適用する
		view.editor.focus();
		if (state.cursor) {
			view.editor.setCursor(state.cursor);
		}

		const applySavedScrollTop = () => {
			view.editor.scrollTo(0, state.scrollTop);
		};

		// 同期で一度適用し、次フレームでも再適用して自動スクロールの上書きを防ぐ
		applySavedScrollTop();
		if (typeof window.requestAnimationFrame === "function") {
			window.requestAnimationFrame(() => applySavedScrollTop());
			return;
		}

		window.setTimeout(() => applySavedScrollTop(), 0);
	}
}
