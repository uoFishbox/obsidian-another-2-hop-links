export const PLUGIN_NAME = "Cosense card links";
export const IS_PROD = process.env.NODE_ENV === "production";

export const INDEXING_DEBOUNCE_DELAY = 300;
export const INDEXING_REBUILD_YIELD_INTERVAL_MS = 24;
// 通常時は24ms、入力待ち検出後はtimeSlicing側で一時的に8msへ短縮する。
// ファイル数ではなく経過時間でyieldすることで、速度と応答性の両立を図る。
export const INDEXING_YIELD_INTERVAL_MS = 24;
// リンク正規化キャッシュの1世代あたりの最大エントリ数。
// 2世代キャッシュのため、保持エントリは概ね maxEntries * 2 に上限制御される。
// 正規化自体が安価なため、LRUの per-call delete/set ではなく
// 世代交代による一括切り替えで古いエントリを追い出す。
export const LINK_NORMALIZATION_CACHE_MAX_ENTRIES = 8192;
export const INDEX_LINK_CAPABLE_EXTENSIONS = new Set(["md", "canvas"]);
export const ATTACHMENT_EXCLUDED_EXTENSIONS = new Set(["md", "canvas", "base"]);
export const CONTAINER_CLASS = "cosense-card-links__container";

// ドラッグ&ドロップでCanvasにノートを追加するためのデータ形式
export const CANVAS_NOTE_DRAG_FORMAT = "cosense-card-links/note-path";

export const AUDIO_EXTENSIONS = new Set([
	"mp3",
	"wav",
	"m4a",
	"ogg",
	"oga",
	"opus",
	"3gp",
	"flac",
	"aac",
]);

export const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"bmp",
	"svg",
	"webp",
	"tiff",
	"ico",
	"heic",
	"avif",
	"jfif",
]);

export const VIDEO_EXTENSIONS = new Set([
	"mp4",
	"webm",
	"ogv",
	"mov",
	"mkv",
	"avi",
	"flv",
	"m4v",
]);

export const SOURCE_EXTENSIONS = new Set([
	"txt",
	"js",
	"ts",
	"py",
	"java",
	"cpp",
	"c",
	"cs",
	"php",
	"rb",
	"go",
	"rs",
	"swift",
	"kt",
	"scala",
	"html",
	"css",
	"scss",
	"sass",
	"less",
	"json",
	"xml",
	"yaml",
	"yml",
	"toml",
	"ini",
	"cfg",
	"conf",
	"sh",
	"bash",
	"zsh",
	"ps1",
	"bat",
	"cmd",
]);

export const CANVAS_EXTENSION = "canvas";

export const DEBUG_DISABLE_CARD_DOM_PREVIEW = false;
export const DEBUG_DISABLE_RENDERED_PREVIEW_CACHE = false;
export const UNRESOLVED_LINK_ATTRIBUTE = {
	NAME: "data-twohop-link-state",
	VALUE_SPECIAL: "special-unresolved",
} as const;

export const SORT_OPTIONS = {
	alphabetical: "タイトル (A-Z)",
	"alphabetical-reverse": "タイトル (Z-A)",
	"backlink-count-reverse": "被リンク数 (多い順)",
	"backlink-count": "被リンク数 (少ない順)",
	"created-date-reverse": "作成日時 (新しい順)",
	"created-date": "作成日時 (古い順)",
	"modified-date-reverse": "更新日時 (新しい順)",
	"modified-date": "更新日時 (古い順)",
	"file-size-reverse": "ファイルサイズ (大きい順)",
	"file-size": "ファイルサイズ (小さい順)",
} as const;

export const ARIA_LABELS = {
	OPEN_LINK: (text: string) => `"${text}" を開く`,
	LOAD_MORE: "さらに読み込む",
	SORT_SELECT: "ソート方法を選択",
	UNRESOLVED_LINK: "未解決のリンク",
} as const;
