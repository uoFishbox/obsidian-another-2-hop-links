export type MainUiLanguage = "en" | "ja";

export interface MainUiTranslations {
	readonly allNotes: string;
	readonly backlinks: string;
	readonly clearSearch: string;
	readonly copyTwoHopLinks: string;
	readonly createFile: string;
	readonly disableFullTextSearch: string;
	readonly enableFullTextSearch: string;
	readonly exportTwoHopLinks: string;
	readonly fileSize: string;
	readonly findCards: string;
	readonly links: string;
	readonly loadMore: string;
	readonly loadingTwoHopLinks: string;
	readonly modifiedDate: string;
	readonly newLinks: string;
	readonly noMatchesFound: string;
	readonly noNotesFound: string;
	readonly noNotesFoundWithTag: string;
	readonly noTargetPath: string;
	readonly noTagSet: string;
	readonly openInNewTab: string;
	readonly openNonMarkdownFile: string;
	readonly outgoingLinks: string;
	readonly preparingTagNotes: string;
	readonly relevance: string;
	readonly search: string;
	readonly searchNoteContents: string;
	readonly searchNoteTitles: string;
	readonly searching: string;
	readonly selectSortMethod: string;
	readonly sortByModifiedDate: string;
	readonly tagFeaturesDisabled: string;
	readonly tagFeaturesDisabledMessage: string;
	readonly tagNotes: string;
	readonly title: string;
	readonly createdDate: string;
	readonly untitled: string;
	readonly unresolvedLink: string;
	readonly useMergedLinksSection: string;
	readonly waitingForInitialIndex: string;
	readonly waitingForTagIndex: string;
	readonly exportClipboardSuccess: string;
	readonly exportClipboardFailure: string;
	readonly exportDownloadFailure: string;
	readonly createFileFailure: string;
	readonly createNoteFailure: string;
	readonly noVisibleCardSurface: string;
	readonly noVisibleCards: string;
	readonly scrollToTwoHopLinks: string;
	readonly activateKeyboardNavigation: string;
	readonly openLink: (title: string) => string;
	readonly noteCount: (count: number) => string;
	readonly linksTo: (linktext: string) => string;
	readonly notesWithTag: (tag: string) => string;
	readonly loadingNotesWithTag: (tag: string) => string;
	readonly showingNotesWithTag: (count: number, tag: string) => string;
	readonly noUnresolvedBacklinks: string;
	readonly relevanceDescending: string;
	readonly relevanceAscending: string;
	readonly descending: string;
	readonly ascending: string;
}

const TRANSLATIONS: Readonly<Record<MainUiLanguage, MainUiTranslations>> = {
	en: {
		allNotes: "All notes",
		backlinks: "Backlinks",
		clearSearch: "Clear search",
		copyTwoHopLinks: "Copy 2-hop links to clipboard",
		createFile: "Create file",
		disableFullTextSearch: "Disable full-text search",
		enableFullTextSearch: "Enable full-text search",
		exportTwoHopLinks: "Export 2-hop links to file",
		fileSize: "File size",
		findCards: "Find cards",
		links: "Links",
		loadMore: "Load more",
		loadingTwoHopLinks: "Loading two-hop links...",
		modifiedDate: "Modified date",
		newLinks: "New links",
		noMatchesFound: "No matches found.",
		noNotesFound: "No notes found.",
		noNotesFoundWithTag: "No notes found with this tag.",
		noTargetPath: "No target path is set for this temporary view.",
		noTagSet: "No tag is set for this temporary view.",
		openInNewTab: "Open in new tab",
		openNonMarkdownFile: "Open a non-Markdown file to see links.",
		outgoingLinks: "Outgoing links",
		preparingTagNotes: "Preparing tag notes.",
		relevance: "Relevance",
		search: "Search...",
		searchNoteContents: "Search note contents...",
		searchNoteTitles: "Search note titles...",
		searching: "Searching…",
		selectSortMethod: "Select sort method",
		sortByModifiedDate: "Sort by modified date",
		tagFeaturesDisabled: "Tag features disabled",
		tagFeaturesDisabledMessage: "Tag features are disabled.",
		tagNotes: "Tag notes",
		title: "Title",
		createdDate: "Created date",
		untitled: "Untitled",
		unresolvedLink: "Unresolved link",
		useMergedLinksSection: "Use merged links section",
		waitingForInitialIndex: "Waiting for the initial index to finish building.",
		waitingForTagIndex: "Waiting for the tag index to finish building.",
		exportClipboardSuccess: "2-hop links exported to clipboard!",
		exportClipboardFailure: "Failed to export 2-hop links. Check console for details.",
		exportDownloadFailure: "Failed to download file. Check console for details.",
		createFileFailure: "Failed to create file.",
		createNoteFailure: "Failed to create note.",
		noVisibleCardSurface: "No visible card surface found.",
		noVisibleCards: "No visible cards to navigate.",
		scrollToTwoHopLinks: "Scroll to Two Hop Links and focus search",
		activateKeyboardNavigation: "Activate keyboard card navigation",
		openLink: (title) => `Open "${title}"`,
		noteCount: (count) => `${count} notes`,
		linksTo: (linktext) => `Links to: ${linktext}`,
		notesWithTag: (tag) => `Notes with #${tag}`,
		loadingNotesWithTag: (tag) => `Loading notes tagged with #${tag}.`,
		showingNotesWithTag: (count, tag) =>
			`Showing ${count} notes tagged with #${tag}.`,
		noUnresolvedBacklinks: "No unresolved backlinks from other notes were found.",
		relevanceDescending: "Highest relevance first (click for lowest first)",
		relevanceAscending: "Lowest relevance first (click for highest first)",
		descending: "Descending (click for ascending)",
		ascending: "Ascending (click for descending)",
	},
	ja: {
		allNotes: "すべてのノート",
		backlinks: "バックリンク",
		clearSearch: "検索をクリア",
		copyTwoHopLinks: "2ホップリンクをクリップボードにコピー",
		createFile: "ファイルを作成",
		disableFullTextSearch: "全文検索を無効化",
		enableFullTextSearch: "全文検索を有効化",
		exportTwoHopLinks: "2ホップリンクをファイルに書き出す",
		fileSize: "ファイルサイズ",
		findCards: "カードを検索",
		links: "リンク",
		loadMore: "さらに読み込む",
		loadingTwoHopLinks: "2ホップリンクを読み込み中...",
		modifiedDate: "更新日時",
		newLinks: "新しいリンク",
		noMatchesFound: "一致する項目が見つかりません。",
		noNotesFound: "ノートが見つかりません。",
		noNotesFoundWithTag: "このタグを持つノートが見つかりません。",
		noTargetPath: "この一時ビューには作成先のパスが設定されていません。",
		noTagSet: "この一時ビューにはタグが設定されていません。",
		openInNewTab: "新しいタブで開く",
		openNonMarkdownFile: "リンクを表示するにはMarkdown以外のファイルを開いてください。",
		outgoingLinks: "発リンク",
		preparingTagNotes: "タグ付きノートを準備しています。",
		relevance: "関連度",
		search: "検索...",
		searchNoteContents: "ノート本文を検索...",
		searchNoteTitles: "ノートのタイトルを検索...",
		searching: "検索中…",
		selectSortMethod: "ソート方法を選択",
		sortByModifiedDate: "更新日時で並べ替え",
		tagFeaturesDisabled: "タグ機能は無効です",
		tagFeaturesDisabledMessage: "タグ機能が無効になっています。",
		tagNotes: "タグ付きノート",
		title: "タイトル",
		createdDate: "作成日時",
		untitled: "無題",
		unresolvedLink: "未解決のリンク",
		useMergedLinksSection: "リンクセクションを統合",
		waitingForInitialIndex: "初回インデックスの構築完了を待っています。",
		waitingForTagIndex: "タグインデックスの構築完了を待っています。",
		exportClipboardSuccess: "2ホップリンクをクリップボードにコピーしました。",
		exportClipboardFailure: "2ホップリンクを書き出せませんでした。詳細はコンソールを確認してください。",
		exportDownloadFailure: "ファイルをダウンロードできませんでした。詳細はコンソールを確認してください。",
		createFileFailure: "ファイルを作成できませんでした。",
		createNoteFailure: "ノートを作成できませんでした。",
		noVisibleCardSurface: "表示中のカード領域が見つかりません。",
		noVisibleCards: "操作できるカードが表示されていません。",
		scrollToTwoHopLinks: "2ホップリンクへスクロールして検索欄にフォーカス",
		activateKeyboardNavigation: "カードのキーボード操作を開始",
		openLink: (title) => `「${title}」を開く`,
		noteCount: (count) => `${count}件のノート`,
		linksTo: (linktext) => `${linktext}へのリンク`,
		notesWithTag: (tag) => `#${tag} のノート`,
		loadingNotesWithTag: (tag) => `#${tag} のノートを読み込んでいます。`,
		showingNotesWithTag: (count, tag) => `#${tag} のノートを${count}件表示しています。`,
		noUnresolvedBacklinks: "他のノートからの未解決バックリンクは見つかりませんでした。",
		relevanceDescending: "関連度の高い順（クリックで低い順に切り替え）",
		relevanceAscending: "関連度の低い順（クリックで高い順に切り替え）",
		descending: "降順（クリックで昇順に切り替え）",
		ascending: "昇順（クリックで降順に切り替え）",
	},
};

/** Returns the complete translation table for the selected main-UI language. */
export function getMainUiTranslations(
	language: MainUiLanguage,
): MainUiTranslations {
	return TRANSLATIONS[language];
}
