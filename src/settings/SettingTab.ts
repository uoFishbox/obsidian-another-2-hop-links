import { App, Platform, PluginSettingTab, Setting } from "obsidian";
import type { PluginHost } from "types/pluginHost";
import type { Language, PluginSettings } from "types/settings";

type TranslationKey =
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
	| "maximumPreviewLines"
	| "maximumPreviewLinesDesc"
	| "maximumPreviewChars"
	| "maximumPreviewCharsDesc"
	| "previewVisualLineSafetyMargin"
	| "previewVisualLineSafetyMarginDesc"
	| "searchPreviewSeekThreshold"
	| "searchPreviewSeekThresholdDesc"
	| "searchPreviewLeadingBuffer"
	| "searchPreviewLeadingBufferDesc"
	| "codeBlocksToRender"
	| "codeBlocksToRenderDesc"
	| "priorityFrontmatterKeyForPreview"
	| "priorityFrontmatterKeyForPreviewDesc"
	| "priorityFrontmatterKeyForTitle"
	| "priorityFrontmatterKeyForTitleDesc"
	| "interaction"
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
	| "integrationAdvancedSettings"
	| "enableLogging"
	| "enableLoggingDesc"
	| "enableSearchArrowUpToEditorBottom"
	| "enableSearchArrowUpToEditorBottomDesc"
	| "enableEditorArrowDownToSearchInput"
	| "enableEditorArrowDownToSearchInputDesc"
	| "enableAdvancedCanvasIntegration"
	| "enableAdvancedCanvasIntegrationDesc"
	| "enableRipgrepContentSearch"
	| "enableRipgrepContentSearchDesc"
	| "ripgrepExecutablePath"
	| "ripgrepExecutablePathDesc"
	| "belowEditor"
	| "sidebar"
	| "hybrid"
	| "appearance"
	| "linkCountAscending"
	| "always"
	| "never"
	| "showPreview"
	| "showMenu"
	| "tags"
	| "canvas"
	| "experimentalFeatures"
	| "card";

const translations: Record<Language, Record<TranslationKey, string>> = {
	en: {
		language: "Language",
		languageDesc: "Select the display language for settings.",
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
		cardGapDesc: "Set the spacing between cards in the responsive grid layout.",
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
		maximumPreviewLines: "Maximum preview lines",
		maximumPreviewLinesDesc:
			"The maximum number of lines to display in the card preview. Set to 0 to disable.",
		maximumPreviewChars: "Maximum preview characters",
		maximumPreviewCharsDesc:
			"This is a fallback for very long lines. Set to 0 to disable.",
		previewVisualLineSafetyMargin: "Preview extra lines",
		previewVisualLineSafetyMarginDesc:
			"Add this many estimated visual lines to the card preview. Set to 0 to disable.",
		searchPreviewSeekThreshold: "Search preview seek threshold (chars)",
		searchPreviewSeekThresholdDesc:
			"When the first search hit is after this position, shift the preview start to bring the hit into view.",
		searchPreviewLeadingBuffer: "Search preview leading buffer (chars)",
		searchPreviewLeadingBufferDesc:
			"The number of characters to keep before the first search hit when seeking.",
		codeBlocksToRender: "Code blocks to render in preview",
		codeBlocksToRenderDesc:
			"Specify the languages of code blocks to render in the preview card, separated by commas (e.g., dataview, mermaid). Heavy processing may impact performance.",
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
		integrationAdvancedSettings: "Integration and Advanced Settings",
		enableLogging: "Enable logging",
		enableLoggingDesc: "Output debug logs to the console. May affect performance.",
		enableSearchArrowUpToEditorBottom: "ArrowUp from search moves to editor bottom",
		enableSearchArrowUpToEditorBottomDesc:
			"When enabled, pressing ArrowUp in the search bar focuses the bottom of the inline editor. If that is not available, nothing happens.",
		enableEditorArrowDownToSearchInput:
			"ArrowDown from editor bottom moves to search",
		enableEditorArrowDownToSearchInputDesc:
			"When enabled, pressing ArrowDown at the bottom of the inline editor focuses the search bar instead of moving the cursor down.",
		enableAdvancedCanvasIntegration: "Advanced Canvas integration",
		enableAdvancedCanvasIntegrationDesc:
			"Opt in to the experimental Advanced Canvas internal-link integration. If unavailable, Obsidian behavior is left unchanged.",
		enableRipgrepContentSearch: "Use ripgrep for full-text search",
		enableRipgrepContentSearchDesc:
			"Use ripgrep for content search on the desktop app. Falls back to the built-in search when unavailable.",
		ripgrepExecutablePath: "ripgrep executable path",
		ripgrepExecutablePathDesc: "Optional. Leave empty to use rg from PATH.",
		belowEditor: "Below editor",
		sidebar: "Sidebar",
		hybrid: "Hybrid",
		appearance: "Appearance",
		linkCountAscending: "Link count (ascending)",
		always: "Always",

		never: "Never",
		showPreview: "Show preview",
		showMenu: "Show menu",
		tags: "Tags",
		canvas: "Canvas",
		card: "Card",
		experimentalFeatures: "Experimental Features",
	},
	ja: {
		language: "言語",
		languageDesc: "設定画面の表示言語を選択します。",
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
		cardGapDesc: "レスポンシブグリッドでカード間の間隔を設定します。",
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
		maximumPreviewLines: "プレビューの最大行数",
		maximumPreviewLinesDesc:
			"カードプレビューに表示する最大行数を設定します。0に設定すると無効になります。",
		maximumPreviewChars: "プレビューの最大文字数",
		maximumPreviewCharsDesc:
			"非常に長い行の場合のフォールバック設定です。0に設定すると無効になります。",
		previewVisualLineSafetyMargin: "プレビュー追加行数",
		previewVisualLineSafetyMarginDesc:
			"プレビューに追加する推定表示行数を設定します。0に設定すると無効になります。",
		searchPreviewSeekThreshold: "検索プレビューシーク閾値（文字数）",
		searchPreviewSeekThresholdDesc:
			"最初の検索ヒットがこの位置より後にある場合、プレビューの開始位置をシフトしてヒットを表示範囲内に含めます。",
		searchPreviewLeadingBuffer: "検索プレビュー先行バッファ（文字数）",
		searchPreviewLeadingBufferDesc:
			"シーク時に最初の検索ヒットの前に保持する文字数を設定します。",
		codeBlocksToRender: "プレビューでレンダリングするコードブロック",
		codeBlocksToRenderDesc:
			"プレビューカードでレンダリングするコードブロックの言語をカンマ区切りで指定します（例: dataview, mermaid）。重い処理はパフォーマンスに影響する可能性があります。",
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
		integrationAdvancedSettings: "統合と詳細設定",
		enableLogging: "ログを有効化",
		enableLoggingDesc:
			"デバッグログをコンソールに出力します。パフォーマンスに影響する可能性があります。",
		enableSearchArrowUpToEditorBottom: "検索欄のArrowUpでエディタ最下行へ移動",
		enableSearchArrowUpToEditorBottomDesc:
			"有効にすると、検索欄でArrowUpを押したときにインラインエディタの最下行へフォーカスします。利用可能なエディタがない場合は何もしません。",
		enableEditorArrowDownToSearchInput: "エディタ最下行のArrowDownで検索欄へ移動",
		enableEditorArrowDownToSearchInputDesc:
			"有効にすると、インラインエディタの最下行でArrowDownを押したときにカーソルを下げる代わりに検索欄へフォーカスします。",
		enableAdvancedCanvasIntegration: "Advanced Canvas 連携",
		enableAdvancedCanvasIntegrationDesc:
			"実験的な Advanced Canvas 内部リンク連携を有効化します。利用できない場合は Obsidian 標準挙動のままです。",
		enableRipgrepContentSearch: "全文検索に ripgrep を使用",
		enableRipgrepContentSearchDesc:
			"デスクトップ版で content 検索に ripgrep を使用します。利用できない場合は内蔵検索にフォールバックします。",
		ripgrepExecutablePath: "ripgrep 実行ファイルのパス",
		ripgrepExecutablePathDesc: "任意です。空の場合は PATH 上の rg を使用します。",
		belowEditor: "エディタの下",
		sidebar: "サイドバー",
		hybrid: "ハイブリッド",
		appearance: "出現順",
		linkCountAscending: "リンク数（昇順）",
		always: "常に",

		never: "なし",
		showPreview: "プレビューを表示",
		showMenu: "メニューを表示",
		tags: "タグ",
		canvas: "Canvas",
		card: "カード",
		experimentalFeatures: "実験的機能",
	},
};

function t(key: TranslationKey, lang: Language): string {
	return translations[lang][key];
}

type SectionId =
	| "language"
	| "display"
	| "preview"
	| "tags"
	| "canvas"
	| "interaction"
	| "emptyViewAllNotes"
	| "dateSortingSettings"
	| "integrationAdvancedSettings"
	| "experimental";

type SettingOption = {
	value: string;
	label: string;
	isTranslationKey?: false;
};

type TranslatedSettingOption = {
	value: string;
	label: TranslationKey;
	isTranslationKey: true;
};

type SelectOption = SettingOption | TranslatedSettingOption;

interface BaseSettingDefinition<K extends keyof PluginSettings> {
	section: SectionId;
	settingKey: K;
	controlType: "toggle" | "dropdown" | "text" | "textarea";
	translationKey: TranslationKey;
	descriptionKey: TranslationKey;
	immediate?: boolean;
	desktopOnly?: boolean;
}

interface ToggleSettingDefinition<
	K extends keyof PluginSettings,
> extends BaseSettingDefinition<K> {
	controlType: "toggle";
}

interface DropdownSettingDefinition<
	K extends keyof PluginSettings,
> extends BaseSettingDefinition<K> {
	controlType: "dropdown";
	options: ReadonlyArray<SelectOption>;
}

interface TextSettingDefinition<
	K extends keyof PluginSettings,
> extends BaseSettingDefinition<K> {
	controlType: "text" | "textarea";
	placeholder?: string;
	parse: (value: string, settings: PluginSettings) => PluginSettings[K] | undefined;
	format?: (value: PluginSettings[K]) => string;
}

type SettingDefinition<K extends keyof PluginSettings = keyof PluginSettings> =
	| ToggleSettingDefinition<K>
	| DropdownSettingDefinition<K>
	| TextSettingDefinition<K>;

const SECTION_ORDER: ReadonlyArray<{
	id: SectionId;
	titleKey?: TranslationKey;
}> = [
	{ id: "language" },
	{ id: "display", titleKey: "display" },
	{ id: "tags", titleKey: "tags" },
	{ id: "canvas", titleKey: "canvas" },
	{ id: "preview", titleKey: "card" },
	{ id: "interaction", titleKey: "interaction" },
	{ id: "emptyViewAllNotes", titleKey: "emptyViewAllNotesSection" },
	{ id: "dateSortingSettings", titleKey: "dateSortingSettings" },
	{
		id: "integrationAdvancedSettings",
		titleKey: "integrationAdvancedSettings",
	},
	{ id: "experimental", titleKey: "experimentalFeatures" },
];

const parsePositiveInteger = (value: string): number | undefined => {
	const num = Number.parseInt(value, 10);
	if (Number.isNaN(num) || num <= 0) {
		return undefined;
	}
	return num;
};

const parseNonNegativeInteger = (value: string): number | undefined => {
	const num = Number.parseInt(value, 10);
	if (Number.isNaN(num) || num < 0) {
		return undefined;
	}
	return num;
};

const parsePositiveNumber = (value: string): number | undefined => {
	const num = Number.parseFloat(value);
	if (!Number.isFinite(num) || num <= 0) {
		return undefined;
	}
	return num;
};

const parseTrimmedString = (value: string): string => value.trim();

const parseCommaSeparatedList = (value: string): string[] =>
	value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

const parseCommaOrLineSeparatedList = (value: string): string[] =>
	value
		.split(/[,\n]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);

const formatStringArray = (value: PluginSettings[keyof PluginSettings]): string =>
	Array.isArray(value) ? value.join(", ") : "";

const SETTING_DEFINITIONS: ReadonlyArray<SettingDefinition> = [
	{
		section: "language",
		settingKey: "language",
		controlType: "dropdown",
		translationKey: "language",
		descriptionKey: "languageDesc",
		immediate: true,
		options: [
			{ value: "en", label: "English" },
			{ value: "ja", label: "日本語" },
		],
	},
	{
		section: "display",
		settingKey: "displayMode",
		controlType: "dropdown",
		translationKey: "displayMode",
		descriptionKey: "displayModeDesc",
		options: [
			{
				value: "editor-inline",
				label: "belowEditor",
				isTranslationKey: true,
			},
			{ value: "sidebar-view", label: "sidebar", isTranslationKey: true },
			{ value: "hybrid", label: "hybrid", isTranslationKey: true },
		],
	},
	{
		section: "display",
		settingKey: "defaultVisibleLinkCount",
		controlType: "text",
		translationKey: "defaultVisibleLinkCount",
		descriptionKey: "defaultVisibleLinkCountDesc",
		parse: (value) => parsePositiveInteger(value),
		format: (value) => String(value ?? ""),
	},
	{
		section: "display",
		settingKey: "loadMoreLinkIncrement",
		controlType: "text",
		translationKey: "loadMoreLinkIncrement",
		descriptionKey: "loadMoreLinkIncrementDesc",
		parse: (value) => parsePositiveInteger(value),
		format: (value) => String(value ?? ""),
	},
	{
		section: "preview",
		settingKey: "cardWidthPx",
		controlType: "text",
		translationKey: "cardWidth",
		descriptionKey: "cardWidthDesc",
		placeholder: "140",
		parse: (value) => parsePositiveInteger(value),
		format: (value) => String(value ?? ""),
	},
	{
		section: "preview",
		settingKey: "cardHeightRatio",
		controlType: "text",
		translationKey: "cardHeightRatio",
		descriptionKey: "cardHeightRatioDesc",
		placeholder: "1.1",
		parse: (value) => parsePositiveNumber(value),
		format: (value) => String(value ?? ""),
	},
	{
		section: "preview",
		settingKey: "previewMaxLines",
		controlType: "text",
		translationKey: "maximumPreviewLines",
		descriptionKey: "maximumPreviewLinesDesc",
		placeholder: "15",
		parse: (value) => parseNonNegativeInteger(value),
		format: (value) => String(value ?? ""),
	},
	{
		section: "preview",
		settingKey: "previewMaxChars",
		controlType: "text",
		translationKey: "maximumPreviewChars",
		descriptionKey: "maximumPreviewCharsDesc",
		placeholder: "500",
		parse: (value) => parseNonNegativeInteger(value),
		format: (value) => String(value ?? ""),
	},
	{
		section: "preview",
		settingKey: "previewVisualLineSafetyMargin",
		controlType: "text",
		translationKey: "previewVisualLineSafetyMargin",
		descriptionKey: "previewVisualLineSafetyMarginDesc",
		placeholder: "0",
		parse: (value) => parseNonNegativeInteger(value),
		format: (value) => String(value ?? ""),
	},
	{
		section: "preview",
		settingKey: "cardGapPx",
		controlType: "text",
		translationKey: "cardGap",
		descriptionKey: "cardGapDesc",
		placeholder: "12",
		parse: (value) => parsePositiveInteger(value),
		format: (value) => String(value ?? ""),
	},
	{
		section: "preview",
		settingKey: "cardMaxColumns",
		controlType: "text",
		translationKey: "cardMaxColumns",
		descriptionKey: "cardMaxColumnsDesc",
		placeholder: "6",
		parse: (value) => parsePositiveInteger(value),
		format: (value) => String(value ?? ""),
	},
	{
		section: "display",
		settingKey: "sectionMarginBottomPx",
		controlType: "text",
		translationKey: "sectionMarginBottom",
		descriptionKey: "sectionMarginBottomDesc",
		placeholder: "45",
		parse: (value) => parsePositiveInteger(value),
		format: (value) => String(value ?? ""),
	},
	{
		section: "display",
		settingKey: "useMergedLinksSection",
		controlType: "toggle",
		translationKey: "mergeBacklinkOutgoing",
		descriptionKey: "mergeBacklinkOutgoingDesc",
		immediate: true,
	},
	{
		section: "display",
		settingKey: "twoHopHeaderSortOrder",
		controlType: "dropdown",
		translationKey: "twoHopHeaderSortOrder",
		descriptionKey: "twoHopHeaderSortOrderDesc",
		options: [
			{ value: "appearance", label: "appearance", isTranslationKey: true },
			{
				value: "hop2-count-asc",
				label: "linkCountAscending",
				isTranslationKey: true,
			},
		],
	},
	{
		section: "display",
		settingKey: "dedupeCards",
		controlType: "toggle",
		translationKey: "hideDuplicateNotes",
		descriptionKey: "hideDuplicateNotesDesc",
	},
	{
		section: "tags",
		settingKey: "enableTagFeatures",
		controlType: "toggle",
		translationKey: "enableTagFeatures",
		descriptionKey: "enableTagFeaturesDesc",
	},
	{
		section: "tags",
		settingKey: "showTagsSection",
		controlType: "toggle",
		translationKey: "showTagsSection",
		descriptionKey: "showTagsSectionDesc",
	},
	{
		section: "display",
		settingKey: "excludeAttachments",
		controlType: "toggle",
		translationKey: "hideAttachments",
		descriptionKey: "hideAttachmentsDesc",
	},
	{
		section: "canvas",
		settingKey: "showTwoHopForSelectedCanvasFileNode",
		controlType: "toggle",
		translationKey: "followSelectedCanvasFileNode",
		descriptionKey: "followSelectedCanvasFileNodeDesc",
	},
	{
		section: "display",
		settingKey: "enableUnresolvedLinkDecoration",
		controlType: "toggle",
		translationKey: "highlightUnresolvedLinks",
		descriptionKey: "highlightUnresolvedLinksDesc",
	},
	{
		section: "experimental",
		settingKey: "renderCodeBlockTypes",
		controlType: "textarea",
		translationKey: "codeBlocksToRender",
		descriptionKey: "codeBlocksToRenderDesc",
		placeholder: "dataview, mermaid",
		parse: (value) => parseCommaOrLineSeparatedList(value),
		format: formatStringArray,
	},
	{
		section: "preview",
		settingKey: "priorityFrontmatterKeyForPreview",
		controlType: "text",
		translationKey: "priorityFrontmatterKeyForPreview",
		descriptionKey: "priorityFrontmatterKeyForPreviewDesc",
		placeholder: "description, summary",
		parse: (value) => parseTrimmedString(value),
		format: (value) => (typeof value === "string" ? value : ""),
	},
	{
		section: "preview",
		settingKey: "priorityFrontmatterKeyForTitle",
		controlType: "text",
		translationKey: "priorityFrontmatterKeyForTitle",
		descriptionKey: "priorityFrontmatterKeyForTitleDesc",
		placeholder: "title, name",
		parse: (value) => parseTrimmedString(value),
		format: (value) => (typeof value === "string" ? value : ""),
	},
	{
		section: "interaction",
		settingKey: "highlightOnOpen",
		controlType: "dropdown",
		translationKey: "highlightOnOpen",
		descriptionKey: "highlightOnOpenDesc",
		options: [
			{ value: "always", label: "always", isTranslationKey: true },
			{ value: "never", label: "never", isTranslationKey: true },
		],
	},
	{
		section: "interaction",
		settingKey: "enableSearchArrowUpToEditorBottom",
		controlType: "toggle",
		translationKey: "enableSearchArrowUpToEditorBottom",
		descriptionKey: "enableSearchArrowUpToEditorBottomDesc",
	},
	{
		section: "interaction",
		settingKey: "enableEditorArrowDownToSearchInput",
		controlType: "toggle",
		translationKey: "enableEditorArrowDownToSearchInput",
		descriptionKey: "enableEditorArrowDownToSearchInputDesc",
	},
	{
		section: "interaction",
		settingKey: "highlightInPreviewOnHover",
		controlType: "toggle",
		translationKey: "highlightInPopoverOnHover",
		descriptionKey: "highlightInPopoverOnHoverDesc",
	},
	{
		section: "interaction",
		settingKey: "mobileLongPressAction",
		controlType: "dropdown",
		translationKey: "longPressActionMobile",
		descriptionKey: "longPressActionMobileDesc",
		options: [
			{ value: "preview", label: "showPreview", isTranslationKey: true },
			{ value: "menu", label: "showMenu", isTranslationKey: true },
		],
	},
	{
		section: "tags",
		settingKey: "enableGlobalSearchTagModal",
		controlType: "toggle",
		translationKey: "openTagSearchDedicatedView",
		descriptionKey: "openTagSearchDedicatedViewDesc",
	},
	{
		section: "interaction",
		settingKey: "enableUnresolvedLinkModal",
		controlType: "toggle",
		translationKey: "openUnresolvedNoteView",
		descriptionKey: "openUnresolvedNoteViewDesc",
	},
	{
		section: "emptyViewAllNotes",
		settingKey: "enableEmptyViewAllNotesInNewTab",
		controlType: "toggle",
		translationKey: "showAllNotesNewTab",
		descriptionKey: "showAllNotesNewTabDesc",
	},
	{
		section: "emptyViewAllNotes",
		settingKey: "pinBookmarkedToTopInAllNotes",
		controlType: "toggle",
		translationKey: "pinBookmarkedToTopInAllNotes",
		descriptionKey: "pinBookmarkedToTopInAllNotesDesc",
	},
	{
		section: "dateSortingSettings",
		settingKey: "frontmatterKeyCreatedDate",
		controlType: "text",
		translationKey: "frontmatterKeyCreationDate",
		descriptionKey: "frontmatterKeyCreationDateDesc",
		placeholder: "created",
		parse: (value) => parseTrimmedString(value),
		format: (value) => (typeof value === "string" ? value : ""),
	},
	{
		section: "dateSortingSettings",
		settingKey: "frontmatterKeyModifiedDate",
		controlType: "text",
		translationKey: "frontmatterKeyModificationDate",
		descriptionKey: "frontmatterKeyModificationDateDesc",
		placeholder: "updated",
		parse: (value) => parseTrimmedString(value),
		format: (value) => (typeof value === "string" ? value : ""),
	},
	{
		section: "integrationAdvancedSettings",
		settingKey: "enableLogging",
		controlType: "toggle",
		translationKey: "enableLogging",
		descriptionKey: "enableLoggingDesc",
	},
	{
		section: "experimental",
		settingKey: "enableAdvancedCanvasIntegration",
		controlType: "toggle",
		translationKey: "enableAdvancedCanvasIntegration",
		descriptionKey: "enableAdvancedCanvasIntegrationDesc",
	},
	{
		section: "experimental",
		settingKey: "enableRipgrepContentSearch",
		controlType: "toggle",
		translationKey: "enableRipgrepContentSearch",
		descriptionKey: "enableRipgrepContentSearchDesc",
		desktopOnly: true,
	},
	{
		section: "experimental",
		settingKey: "ripgrepExecutablePath",
		controlType: "text",
		translationKey: "ripgrepExecutablePath",
		descriptionKey: "ripgrepExecutablePathDesc",
		placeholder: "rg",
		parse: (value) => parseTrimmedString(value),
		format: (value) => (typeof value === "string" ? value : ""),
		desktopOnly: true,
	},
];

function getOptionLabel(option: SelectOption, lang: Language): string {
	if (option.isTranslationKey) {
		return t(option.label, lang);
	}
	return option.label;
}

function updatePluginSetting<K extends keyof PluginSettings>(
	plugin: PluginHost,
	key: K,
	value: PluginSettings[K],
	immediate?: boolean,
): Promise<void> {
	if (Object.is(plugin.settings[key], value)) {
		return Promise.resolve();
	}

	return plugin.updateSetting(key, value, immediate ? { immediate: true } : {});
}

function reportSettingUpdateError(error: unknown): void {
	console.error("設定の更新に失敗しました:", error);
}

export class CosenseCardLinksSettingTab extends PluginSettingTab {
	private readonly pluginInstance: PluginHost;

	constructor(app: App, plugin: PluginHost) {
		super(app, plugin);
		this.pluginInstance = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const lang = this.pluginInstance.settings.language;

		for (const section of SECTION_ORDER) {
			const sectionSettings = SETTING_DEFINITIONS.filter(
				(definition) =>
					definition.section === section.id &&
					(!definition.desktopOnly || Platform.isDesktopApp),
			);
			if (sectionSettings.length === 0) {
				continue;
			}

			if (section.titleKey) {
				containerEl.createEl("h2", { text: t(section.titleKey, lang) });
			}

			for (const definition of sectionSettings) {
				this.renderSetting(containerEl, definition, lang);
			}
		}
	}

	private renderSetting(
		containerEl: HTMLElement,
		definition: SettingDefinition,
		lang: Language,
	): void {
		const setting = new Setting(containerEl)
			.setName(t(definition.translationKey, lang))
			.setDesc(t(definition.descriptionKey, lang));
		const currentSettings = this.pluginInstance.settings;
		const currentValue = currentSettings[definition.settingKey];

		switch (definition.controlType) {
			case "toggle":
				setting.addToggle((toggle) =>
					toggle.setValue(Boolean(currentValue)).onChange((value) => {
						void updatePluginSetting(
							this.pluginInstance,
							definition.settingKey,
							value as PluginSettings[typeof definition.settingKey],
							definition.immediate,
						)
							.then(() => {
								if (definition.settingKey === "language") {
									this.display();
								}
							})
							.catch(reportSettingUpdateError);
					}),
				);
				return;
			case "dropdown":
				setting.addDropdown((dropdown) => {
					for (const option of definition.options) {
						dropdown.addOption(option.value, getOptionLabel(option, lang));
					}
					dropdown.setValue(String(currentValue)).onChange((value) => {
						void updatePluginSetting(
							this.pluginInstance,
							definition.settingKey,
							value as PluginSettings[typeof definition.settingKey],
							definition.immediate,
						)
							.then(() => {
								if (definition.settingKey === "language") {
									this.display();
								}
							})
							.catch(reportSettingUpdateError);
					});
				});
				return;
			case "text":
				setting.addText((text) =>
					text
						.setPlaceholder(definition.placeholder ?? "")
						.setValue(
							definition.format
								? definition.format(
										currentValue as PluginSettings[typeof definition.settingKey],
									)
								: String(currentValue ?? ""),
						)
						.onChange((value) => {
							const parsed = definition.parse(value, currentSettings);
							if (parsed === undefined) {
								return;
							}
							void updatePluginSetting(
								this.pluginInstance,
								definition.settingKey,
								parsed,
								definition.immediate,
							).catch(reportSettingUpdateError);
						}),
				);
				return;
			case "textarea":
				setting.addTextArea((text) =>
					text
						.setPlaceholder(definition.placeholder ?? "")
						.setValue(
							definition.format
								? definition.format(
										currentValue as PluginSettings[typeof definition.settingKey],
									)
								: String(currentValue ?? ""),
						)
						.onChange((value) => {
							const parsed = definition.parse(value, currentSettings);
							if (parsed === undefined) {
								return;
							}
							void updatePluginSetting(
								this.pluginInstance,
								definition.settingKey,
								parsed,
								definition.immediate,
							).catch(reportSettingUpdateError);
						}),
				);
				return;
		}
	}
}
