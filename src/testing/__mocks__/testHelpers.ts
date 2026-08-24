import { TFile } from "obsidian";
import type { IVault } from "../../obsidian-integration/hostContracts";
import { vi } from "vitest";

let __mockFileCounter = 0;

function getPathBasename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

export function createMockTFile(
	path: string,
	extension: string = "md",
	vault?: IVault,
): TFile {
	const file = new TFile();
	file.path = path;
	file.name = getPathBasename(path);
	file.basename = file.name.replace(new RegExp(`\\.${extension}$`), "");
	file.extension = extension;
	// Ensure mtime is unique per created mock file to avoid caching collisions
	const now = Date.now();
	file.stat = { ctime: now, mtime: now + __mockFileCounter++, size: 0 };
	file.vault = vault || ({} as any);
	file.parent = null;
	return file as any;
}

export function createMockTFileAsPlainObject(
	path: string,
	extension: string = "md",
	vault?: IVault,
): TFile {
	const mockVault = vault || createMockVault();
	const name = getPathBasename(path);
	return {
		path,
		name,
		basename: name.replace(/\.\w+$/, ""),
		extension,
		stat: ((): any => {
			const now = Date.now();
			return { ctime: now, mtime: now + __mockFileCounter++, size: 0 };
		})(),
		vault: mockVault,
		parent: null,
	} as TFile;
}

export function createMockVault(): IVault {
	return {
		cachedRead: vi.fn(),
		getResourcePath: vi.fn((file: TFile) => `app://local/${file.path}`),
	} as any;
}
