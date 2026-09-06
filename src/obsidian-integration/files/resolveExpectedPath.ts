import { type App, parseLinktext } from "obsidian";

/**
 * Pre-resolve and return the file path that openLinkText will actually create.
 */
export function resolveExpectedPath(
	app: App,
	linktext: string,
	sourcePath: string,
): string {
	const { path: linkPath } = parseLinktext(linktext);

	const existingFile = app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
	if (existingFile) {
		return existingFile.path;
	}

	let fileName: string;
	let dirPath: string;

	if (linkPath.contains("/")) {
		// Use the directory structure when linktext includes a directory
		const slash = linkPath.lastIndexOf("/");
		fileName = linkPath.slice(slash + 1);
		dirPath = linkPath.slice(0, slash);
	} else {
		// Use getNewFileParent when there is no directory
		fileName = linkPath;
		const parentFolder = app.fileManager.getNewFileParent(sourcePath, linkPath);
		dirPath = parentFolder.isRoot() ? "" : parentFolder.path;
	}

	// Keep .canvas and .base as-is; add .md to other files (.txt or files without an extension)
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
