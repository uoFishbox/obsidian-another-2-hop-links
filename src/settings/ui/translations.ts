import type { Language } from "settings/model";

export type TranslationKey =
	| "language"
	| "languageDesc"
	| "display"
	| "displayMode"
	| "displayModeDesc"
	| "defaultVisibleLinkCount"
	| "defaultVisibleLinkCountDesc"
	| "loadMoreLinkIncrement"
	| "loadMoreLinkIncrementDesc"
	| "cardWidth"
	| "cardWidthDesc"
	| "cardHeightRatio"
	| "cardHeightRatioDesc"
	| "cardGap"
	| "cardGapDesc"
	| "cardMaxColumns"
	| "cardMaxColumnsDesc"
	| "sectionMarginBottom"
	| "sectionMarginBottomDesc"
	| "mergeBacklinkOutgoing"
	| "mergeBacklinkOutgoingDesc"
	| "twoHopHeaderSortOrder"
	| "twoHopHeaderSortOrderDesc"
	| "quickSortField1"
	| "quickSortField2"
	| "quickSortFieldDesc"
	| "none"
	| "sortRelevance"
	| "sortTitle"
	| "sortBacklinks"
	| "sortCreatedDate"
	| "sortModifiedDate"
	| "sortFileSize"
	| "hideDuplicateNotes"
	| "hideDuplicateNotesDesc"
	| "enableTagFeatures"
	| "enableTagFeaturesDesc"
	| "showTagsSection"
	| "showTagsSectionDesc"
	| "hideAttachments"
	| "hideAttachmentsDesc"
	| "followSelectedCanvasFileNode"
	| "followSelectedCanvasFileNodeDesc"
	| "highlightUnresolvedLinks"
	| "highlightUnresolvedLinksDesc"
	| "preview"
	| "priorityFrontmatterKeyForPreview"
	| "priorityFrontmatterKeyForPreviewDesc"
	| "priorityFrontmatterKeyForTitle"
	| "priorityFrontmatterKeyForTitleDesc"
	| "interaction"
	| "experimentalCosenseTitleEditing"
	| "experimentalCosenseTitleEditingDesc"
	| "experimentalShadowDomCss"
	| "experimentalShadowDomCssDesc"
	| "highlightOnOpen"
	| "highlightOnOpenDesc"
	| "highlightInPopoverOnHover"
	| "highlightInPopoverOnHoverDesc"
	| "longPressActionMobile"
	| "longPressActionMobileDesc"
	| "openTagSearchDedicatedView"
	| "openTagSearchDedicatedViewDesc"
	| "openUnresolvedNoteView"
	| "openUnresolvedNoteViewDesc"
	| "emptyViewAllNotesSection"
	| "showAllNotesNewTab"
	| "showAllNotesNewTabDesc"
	| "pinBookmarkedToTopInAllNotes"
	| "pinBookmarkedToTopInAllNotesDesc"
	| "dateSortingSettings"
	| "frontmatterKeyCreationDate"
	| "frontmatterKeyCreationDateDesc"
	| "frontmatterKeyModificationDate"
	| "frontmatterKeyModificationDateDesc"
	| "enableSearchArrowUpToEditorBottom"
	| "enableSearchArrowUpToEditorBottomDesc"
	| "enableEditorArrowDownToSearchInput"
	| "enableEditorArrowDownToSearchInputDesc"
	| "belowEditor"
	| "sidebar"
	| "hybrid"
	| "appearance"
	| "linkCountAscending"
	| "showPreview"
	| "showMenu"
	| "tags"
	| "canvas"
	| "card";

const translations: Record<Language, Record<TranslationKey, string>> = {
	en: {
		experimentalCosenseTitleEditing: "Experimental: Cosense-style title editing",
		experimentalCosenseTitleEditingDesc:
			"In edit mode, seamlessly move the caret and edit text between the title and body.",
		experimentalShadowDomCss: "Experimental: Shadow DOM custom CSS",
		experimentalShadowDomCssDesc:
			"Append CSS to card-rendering Shadow DOM surfaces. Changes apply immediately. Invalid CSS may break card display.",
		language: "Language",
		languageDesc: "Select the display language for the UI.",
		display: "Display",
		displayMode: "Display mode",
		displayModeDesc:
			"Where to display 2-hop links. Hybrid mode displays them below the editor in Markdown view and in the sidebar otherwise.",
		defaultVisibleLinkCount: "Default visible link count",
		defaultVisibleLinkCountDesc:
			"The default number of links to display in each section.",
		loadMoreLinkIncrement: "Increment when loading more links",
		loadMoreLinkIncrementDesc:
			"The number of additional links to load when clicking 'Load more'.",
		cardWidth: "Card width (px)",
		cardWidthDesc: "Set the card width used by the responsive grid layout.",
		cardHeightRatio: "Card height ratio",
		cardHeightRatioDesc:
			"Set card height as a ratio of the actual rendered card width. Example: 1.1 means height = width x 1.1.",
		cardGap: "Card gap (px)",
		cardGapDesc:
			"Set the spacing between cards in the responsive grid layout. Set to 0 for no gap.",
		cardMaxColumns: "Maximum card columns",
		cardMaxColumnsDesc:
			"Set the upper limit for the number of columns in the responsive grid layout.",
		sectionMarginBottom: "Section bottom margin (px)",
		sectionMarginBottomDesc: "Set the bottom spacing between sections.",
		mergeBacklinkOutgoing: "Merge Backlink and Outgoing link sections",
		mergeBacklinkOutgoingDesc:
			'Merge Backlink and Outgoing link into a single "Links" section.',
		twoHopHeaderSortOrder: "2-hop link header sort order",
		twoHopHeaderSortOrderDesc:
			"The display order of headers within the '2-hop link' section.",
		quickSortField1: "Pinned sort 1",
		quickSortField2: "Pinned sort 2",
		quickSortFieldDesc:
			"Show this sort field beside the sort menu. Select None to leave the slot empty; duplicate fields are shown only once.",
		none: "None",
		sortRelevance: "Related",
		sortTitle: "Title",
		sortBacklinks: "Backlinks",
		sortCreatedDate: "Created",
		sortModifiedDate: "Modified",
		sortFileSize: "File size",
		hideDuplicateNotes: "Hide duplicate notes",
		hideDuplicateNotesDesc:
			"Hide notes that are already displayed in higher sections.",
		enableTagFeatures: "Enable tag features",
		enableTagFeaturesDesc:
			"Enable tag pages, tag search interception, and tag index building.",
		showTagsSection: "Show tags section",
		showTagsSectionDesc:
			"Display notes that have the same tags as the current note.",
		hideAttachments: "Hide attachments",
		hideAttachmentsDesc:
			"Exclude attachment files from results such as Backlinks and related links.",
		followSelectedCanvasFileNode: "Show 2-hop links for the selected file node",
		followSelectedCanvasFileNodeDesc:
			"When a file node is selected on Canvas, show its 2-hop links.",
		highlightUnresolvedLinks: "Highlight unresolved links with single Backlink",
		highlightUnresolvedLinksDesc:
			"Change the appearance of unresolved links that have only one Backlink.",
		preview: "Preview",
		priorityFrontmatterKeyForPreview: "Priority frontmatter key for preview",
		priorityFrontmatterKeyForPreviewDesc:
			"If specified, the value of this property will be displayed as plain text in the preview instead of the file content.",
		priorityFrontmatterKeyForTitle: "Priority frontmatter key for card title",
		priorityFrontmatterKeyForTitleDesc:
			"If specified, the value of this property will be displayed as the card title when it exists.",
		interaction: "Interaction",
		highlightOnOpen: "Highlight on open",
		highlightOnOpenDesc:
			"Scroll to and highlight the position when opening a Backlink or an Outgoing link with location information.",
		highlightInPopoverOnHover: "Highlight in popover on hover",
		highlightInPopoverOnHoverDesc:
			"Highlight the link location in the popover displayed when hovering over a card.",
		longPressActionMobile: "Long press action on cards in mobile",
		longPressActionMobileDesc:
			"Action when long pressing a card on a mobile device.",
		openTagSearchDedicatedView: "Open tag search results in a dedicated view",
		openTagSearchDedicatedViewDesc: "Open the tag list in a dedicated tag view.",
		openUnresolvedNoteView: "Check Backlinks when creating unresolved links",
		openUnresolvedNoteViewDesc:
			"When clicking on an unresolved link with two or more Backlinks, open a temporary pre-creation view before creating a new file.",
		emptyViewAllNotesSection: "New Tab",
		showAllNotesNewTab: "Show all notes in New Tab (Empty View)",
		showAllNotesNewTabDesc:
			"When enabled, opening a New Tab with Empty View shows all markdown notes as cards with infinite scroll.",
		pinBookmarkedToTopInAllNotes: "Pin bookmarked notes to top",
		pinBookmarkedToTopInAllNotesDesc:
			"Pin bookmarked notes to the top of the All Notes view.",
		dateSortingSettings: "Date Sorting Settings",
		frontmatterKeyCreationDate: "Frontmatter key to use for creation date",
		frontmatterKeyCreationDateDesc:
			"If specified, use the value of this key instead of the file's creation date (e.g., created). If empty, use the file's creation date.",
		frontmatterKeyModificationDate: "Frontmatter key to use for modification date",
		frontmatterKeyModificationDateDesc:
			"If specified, use the value of this key instead of the file's modification date (e.g., updated). If empty, use the file's modification date.",
		enableSearchArrowUpToEditorBottom: "ArrowUp from search moves to editor bottom",
		enableSearchArrowUpToEditorBottomDesc:
			"When enabled, pressing ArrowUp in the search bar focuses the bottom of the inline editor. If that is not available, nothing happens.",
		enableEditorArrowDownToSearchInput:
			"ArrowDown from editor bottom moves to search",
		enableEditorArrowDownToSearchInputDesc:
			"When enabled, pressing ArrowDown at the bottom of the inline editor focuses the search bar instead of moving the cursor down.",
		belowEditor: "Below editor",
		sidebar: "Sidebar",
		hybrid: "Hybrid",
		appearance: "Appearance",
		linkCountAscending: "Link count (ascending)",
		showPreview: "Show preview",
		showMenu: "Show menu",
		tags: "Tags",
		canvas: "Canvas",
		card: "Card",
	},
	ja: {
		experimentalCosenseTitleEditing: "Experimental: Cosenseスタイルのタイトル編集",
		experimentalCosenseTitleEditingDesc:
			"編集モードで、タイトルと本文の間のキャレット移動・テキスト編集をシームレスにします。",
		experimentalShadowDomCss: "Experimental: Shadow DOM カスタム CSS",
		experimentalShadowDomCssDesc:
			"カード描画用 Shadow DOM に CSS を追加します。変更はすぐに反映されます。不正な CSS によりカード表示が崩れる場合があります。",
		language: "言語",
		languageDesc: "UIの表示言語を選択します。",
		display: "表示",
		displayMode: "表示モード",
		displayModeDesc:
			"2ホップリンクを表示する場所を設定します。ハイブリッドモードでは、Markdownビューではエディタの下に、それ以外ではサイドバーに表示されます。",
		defaultVisibleLinkCount: "デフォルトの表示リンク数",
		defaultVisibleLinkCountDesc:
			"各セクションにデフォルトで表示するリンク数を設定します。",
		loadMoreLinkIncrement: "追加読み込み時の増分数",
		loadMoreLinkIncrementDesc:
			"「もっと読み込む」をクリックした際に追加で読み込むリンク数を設定します。",
		cardWidth: "カード幅（px）",
		cardWidthDesc: "レスポンシブグリッドで使用するカード幅を設定します。",
		cardHeightRatio: "カード高さ比率",
		cardHeightRatioDesc:
			"実際に描画されるカード幅に対する高さの比率を設定します。例: 1.1 は 高さ = 幅 x 1.1 です。",
		cardGap: "カード間隔（px）",
		cardGapDesc:
			"レスポンシブグリッドでカード間の間隔を設定します。0にすると間隔をなくします。",
		cardMaxColumns: "カードの最大列数",
		cardMaxColumnsDesc: "レスポンシブグリッドで使用する列数の上限を設定します。",
		sectionMarginBottom: "セクション下余白（px）",
		sectionMarginBottomDesc: "セクション間の下余白を設定します。",
		mergeBacklinkOutgoing: "バックリンクとアウトゴーイングリンクのセクションを統合",
		mergeBacklinkOutgoingDesc:
			"バックリンクとアウトゴーイングリンクを単一の「リンク」セクションに統合します。",
		twoHopHeaderSortOrder: "2ホップリンクヘッダーの並び順",
		twoHopHeaderSortOrderDesc:
			"「2ホップリンク」セクション内のヘッダーの表示順序を設定します。",
		quickSortField1: "固定ソート 1",
		quickSortField2: "固定ソート 2",
		quickSortFieldDesc:
			"ソートメニューの横に表示する項目を選びます。「なし」で空欄になり、同じ項目を2つ選んだ場合は1つだけ表示されます。",
		none: "なし",
		sortRelevance: "関連度",
		sortTitle: "タイトル",
		sortBacklinks: "バックリンク",
		sortCreatedDate: "作成日時",
		sortModifiedDate: "更新日時",
		sortFileSize: "ファイルサイズ",
		hideDuplicateNotes: "重複ノートを非表示",
		hideDuplicateNotesDesc:
			"既に上位セクションに表示されているノートを非表示にします。",
		enableTagFeatures: "タグ機能を有効化",
		enableTagFeaturesDesc:
			"タグ専用ページ、タグ検索の専用表示、タグインデックス作成を有効にします。",
		showTagsSection: "タグセクションを表示",
		showTagsSectionDesc: "現在のノートと同じタグを持つノートを表示します。",
		hideAttachments: "添付ファイルを非表示",
		hideAttachmentsDesc:
			"バックリンクや関連リンクなどの結果から添付ファイルを除外します。",
		followSelectedCanvasFileNode: "選択したファイルノードの 2 hop link を表示する",
		followSelectedCanvasFileNodeDesc:
			"Canvas上でファイルノードが選択されたとき、その2ホップリンクを表示します。",
		highlightUnresolvedLinks: "バックリンクが1つのみの未解決リンクをハイライト",
		highlightUnresolvedLinksDesc:
			"バックリンクが1つのみの未解決リンクの外観を変更します。",
		preview: "プレビュー",
		priorityFrontmatterKeyForPreview: "プレビュー優先フロントマターキー",
		priorityFrontmatterKeyForPreviewDesc:
			"指定した場合、このプロパティの値がファイルコンテンツの代わりにプレビューにプレーンテキストとして表示されます。",
		priorityFrontmatterKeyForTitle:
			"カードタイトルに優先表示するフロントマターキー",
		priorityFrontmatterKeyForTitleDesc:
			"指定すると、そのプロパティが存在するノートでは、その値をカードのタイトルとして優先表示します。",
		interaction: "操作",
		highlightOnOpen: "開く際にハイライト",
		highlightOnOpenDesc:
			"位置情報付きのバックリンクまたは送信リンクを開く際、その位置までスクロールしてハイライトします。",
		highlightInPopoverOnHover: "ホバー時にポップオーバーでハイライト",
		highlightInPopoverOnHoverDesc:
			"カードにホバーした際に表示されるポップオーバー内でリンク位置をハイライトします。",
		longPressActionMobile: "モバイルでのカード長押しアクション",
		longPressActionMobileDesc:
			"モバイルデバイスでカードを長押しした際のアクションを設定します。",
		openTagSearchDedicatedView: "タグの検索結果を専用ビューで開く",
		openTagSearchDedicatedViewDesc: "タグの一覧をタグ専用ビューで開きます。",
		openUnresolvedNoteView: "未解決リンク作成時にバックリンクを確認",
		openUnresolvedNoteViewDesc:
			"2つ以上のバックリンクを持つ未解決リンクをクリックした際、新しいファイルを作成する前に一時的な作成前ビューを開きます。",
		emptyViewAllNotesSection: "新規タブ",
		showAllNotesNewTab: "新しいタブ（空のビュー）ですべてのノートを表示",
		showAllNotesNewTabDesc:
			"有効にすると、空のビューで新しいタブを開く際、すべてのマークダウンノートを無限スクロール付きのカードとして表示します。",
		pinBookmarkedToTopInAllNotes: "ブックマークしたノートを先頭に固定",
		pinBookmarkedToTopInAllNotesDesc:
			"すべてのノートビューで、ブックマークしたノートをリストの先頭に固定します。",
		dateSortingSettings: "日付ソート設定",
		frontmatterKeyCreationDate: "作成日に使用するフロントマターキー",
		frontmatterKeyCreationDateDesc:
			"指定した場合、ファイルの作成日の代わりにこのキーの値を使用します（例: created）。空の場合、ファイルの作成日を使用します。",
		frontmatterKeyModificationDate: "更新日に使用するフロントマターキー",
		frontmatterKeyModificationDateDesc:
			"指定した場合、ファイルの更新日の代わりにこのキーの値を使用します（例: updated）。空の場合、ファイルの更新日を使用します。",
		enableSearchArrowUpToEditorBottom: "検索欄のArrowUpでエディタ最下行へ移動",
		enableSearchArrowUpToEditorBottomDesc:
			"有効にすると、検索欄でArrowUpを押したときにインラインエディタの最下行へフォーカスします。利用可能なエディタがない場合は何もしません。",
		enableEditorArrowDownToSearchInput: "エディタ最下行のArrowDownで検索欄へ移動",
		enableEditorArrowDownToSearchInputDesc:
			"有効にすると、インラインエディタの最下行でArrowDownを押したときにカーソルを下げる代わりに検索欄へフォーカスします。",
		belowEditor: "エディタの下",
		sidebar: "サイドバー",
		hybrid: "ハイブリッド",
		appearance: "出現順",
		linkCountAscending: "リンク数（昇順）",
		showPreview: "プレビューを表示",
		showMenu: "メニューを表示",
		tags: "タグ",
		canvas: "Canvas",
		card: "カード",
	},
};

export function t(key: TranslationKey, lang: Language): string {
	return translations[lang][key];
}
