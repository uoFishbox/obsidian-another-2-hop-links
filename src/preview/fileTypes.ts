const IMAGE_EXTENSIONS = new Set([
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

const VIDEO_EXTENSIONS = new Set([
	"mp4",
	"webm",
	"ogv",
	"mov",
	"mkv",
	"avi",
	"flv",
	"m4v",
]);

const SOURCE_EXTENSIONS = new Set([
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

/** Returns whether an extension is rendered as an image preview. */
export function isImageExtension(extension: string): boolean {
	return IMAGE_EXTENSIONS.has(extension.toLowerCase());
}

/** Returns whether an extension is rendered as a video preview. */
export function isVideoExtension(extension: string): boolean {
	return VIDEO_EXTENSIONS.has(extension.toLowerCase());
}

/** Returns whether an extension is read as source text. */
export function isSourceExtension(extension: string): boolean {
	return SOURCE_EXTENSIONS.has(extension.toLowerCase());
}

/** Returns whether an extension identifies an Obsidian canvas. */
export function isCanvasExtension(extension: string): boolean {
	return extension.toLowerCase() === "canvas";
}
