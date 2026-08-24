import { Platform } from "obsidian";
import { isImageExtension } from "preview/fileTypes";

export function isFileUrlImage(fileUrl: string): boolean {
	if (!fileUrl.startsWith("file://")) return false;

	let pathname: string;
	try {
		pathname = new URL(fileUrl).pathname;
	} catch {
		pathname = fileUrl;
	}

	const clean = pathname.split(/[?#]/, 1)[0];
	const dotIndex = clean.lastIndexOf(".");
	if (dotIndex < 0 || dotIndex === clean.length - 1) {
		return false;
	}

	const extension = clean.substring(dotIndex + 1);
	return isImageExtension(extension);
}

export function toObsidianResourceUrl(fileUrl: string): string {
	if (!Platform.isDesktopApp) return fileUrl;

	if (fileUrl.startsWith("file:///")) {
		return Platform.resourcePathPrefix + fileUrl.substring("file:///".length);
	}

	if (fileUrl.startsWith("file://")) {
		return (
			Platform.resourcePathPrefix + "%5C%5C" + fileUrl.substring("file://".length)
		);
	}

	return fileUrl;
}

export function toPreviewImageSrc(src: string): string {
	return isFileUrlImage(src) ? toObsidianResourceUrl(src) : src;
}
