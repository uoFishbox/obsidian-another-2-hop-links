import { type App, parseLinktext } from "obsidian";

/**
 * openLinkText が実際に作成するファイルパスを先読みして返す。
 */
export function resolveExpectedPath(
	app: App,
	linktext: string,
	sourcePath: string,
): string {
	const { path: linkPath } = parseLinktext(linktext);

	const existingFile = app.metadataCache.getFirstLinkpathDest(
		linkPath,
		sourcePath,
	);
	if (existingFile) {
		return existingFile.path;
	}

	let fileName: string;
	let dirPath: string;

	if (linkPath.contains("/")) {
		// linktextにディレクトリが含まれる場合、その構造を使用
		const slash = linkPath.lastIndexOf("/");
		fileName = linkPath.slice(slash + 1);
		dirPath = linkPath.slice(0, slash);
	} else {
		// ディレクトリがない場合、getNewFileParentを使用
		fileName = linkPath;
		const parentFolder = app.fileManager.getNewFileParent(
			sourcePath,
			linkPath,
		);
		dirPath = parentFolder.isRoot() ? "" : parentFolder.path;
	}

	// .canvas か .base はそのまま。それ以外（.txtや拡張子なし）は .md になる
	const specialExtensions = [".canvas", ".base"];
	const hasSpecialExt = specialExtensions.some((ext) =>
		fileName.toLowerCase().endsWith(ext),
	);
	const hasMdExt = fileName.toLowerCase().endsWith(".md");

	if (!hasSpecialExt && !hasMdExt) {
		fileName += ".md";
	}

	return dirPath ? `${dirPath}/${fileName}` : fileName;
}
