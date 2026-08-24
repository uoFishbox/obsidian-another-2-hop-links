import type { Pos } from "obsidian";

const ATTACHMENT_EXCLUDED_EXTENSIONS = new Set(["md", "canvas", "base"]);

export function isAttachment(extension: string | undefined): boolean {
	if (!extension) {
		return false;
	}
	const result = !ATTACHMENT_EXCLUDED_EXTENSIONS.has(extension.toLowerCase());
	return result;
}

export function isAdvancedCanvasPosition(position: Pos): boolean {
	return (
		position.start.offset === 0 &&
		position.end.col === 1 &&
		typeof position.end.offset === "number"
	);
}
