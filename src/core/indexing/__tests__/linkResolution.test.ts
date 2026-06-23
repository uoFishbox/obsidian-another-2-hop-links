import { beforeEach, describe, expect, test, vi } from "vitest";

const normalizePathMock = vi.fn((path: string) => path.replace(/\\/g, "/"));
const getLinkpathMock = vi.fn((linkText: string) =>
	linkText.replace(/^\[\[/, "").replace(/\]\]$/, ""),
);

vi.mock("obsidian", () => ({
	getLinkpath: getLinkpathMock,
	normalizePath: normalizePathMock,
}));

function getPathBasename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

function getFileExtension(path: string): string {
	const fileName = getPathBasename(path);
	const dotIndex = fileName.lastIndexOf(".");
	if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
		return "md";
	}
	return fileName.slice(dotIndex + 1);
}

function createMockVault(paths: string[]) {
	return {
		getFiles: () =>
			paths.map((path) => {
				const extension = getFileExtension(path);
				const name = getPathBasename(path);
				return {
					path,
					name,
					basename: name.replace(new RegExp(`\\.${extension}$`), ""),
					extension,
				};
			}),
	} as any;
}

describe("linkResolution", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	test("toCaseInsensitiveLookupKey globally caches the same input", async () => {
		const lowerSpy = vi.spyOn(String.prototype, "toLowerCase");
		const { toCaseInsensitiveLookupKey } =
			await import("../link-resolution/linkResolution");

		expect(toCaseInsensitiveLookupKey("Folder\\Note.MD")).toBe("folder/note.md");
		expect(toCaseInsensitiveLookupKey("Folder\\Note.MD")).toBe("folder/note.md");

		expect(normalizePathMock).toHaveBeenCalledTimes(1);
		expect(lowerSpy).toHaveBeenCalledTimes(1);

		lowerSpy.mockRestore();
	});

	test("normalizeLinkToMarkdownPath reuses normalization for the same link string", async () => {
		const { normalizeLinkToMarkdownPath } =
			await import("../link-resolution/linkResolution");

		expect(normalizeLinkToMarkdownPath("[[Folder\\Note]]")).toBe("Folder/Note.md");
		expect(normalizeLinkToMarkdownPath("[[Folder\\Note]]")).toBe("Folder/Note.md");

		expect(getLinkpathMock).toHaveBeenCalledTimes(1);
		expect(normalizePathMock).toHaveBeenCalledTimes(1);
	});

	test("normalizeRawLinkpathToMarkdownPath reuses normalization for the same rawPath", async () => {
		const { normalizeRawLinkpathToMarkdownPath } =
			await import("../link-resolution/linkResolution");

		expect(normalizeRawLinkpathToMarkdownPath("Folder\\Note")).toBe(
			"Folder/Note.md",
		);
		expect(normalizeRawLinkpathToMarkdownPath("Folder\\Note")).toBe(
			"Folder/Note.md",
		);

		expect(normalizePathMock).toHaveBeenCalledTimes(1);
	});

	test("resolveLinkFromRawLinkPath does not retain ResolvedLinkInfo between independent calls", async () => {
		const { resolveLinkFromRawLinkPath, createLinkResolutionAmbiguityDetector } =
			await import("../link-resolution/linkResolution");
		const metadataCache = {
			getFirstLinkpathDest: vi.fn(() => ({ path: "Dashboard.md" })),
		} as any;
		const ambiguityDetector = createLinkResolutionAmbiguityDetector(
			createMockVault(["Dashboard.md"]),
		);

		const first = resolveLinkFromRawLinkPath(
			metadataCache,
			"Dashboard",
			"daily/2026-03-10.md",
			ambiguityDetector,
		);
		const second = resolveLinkFromRawLinkPath(
			metadataCache,
			"Dashboard",
			"projects/report.md",
			ambiguityDetector,
		);

		expect(first).not.toBe(second);
		expect(first).toMatchObject({
			destinationPath: "Dashboard.md",
			rawLookupKey: "dashboard.md",
			isUnresolved: false,
			isAmbiguous: false,
		});
		expect(metadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(2);
	});

	test("resolveLinkFromRawLinkPath does not confuse per-sourcePath resolution differences for the same rawLinkPath", async () => {
		const { resolveLinkFromRawLinkPath, createLinkResolutionAmbiguityDetector } =
			await import("../link-resolution/linkResolution");
		const metadataCache = {
			getFirstLinkpathDest: vi.fn((_linkPath: string, sourcePath: string) => {
				if (sourcePath.startsWith("team-a/")) {
					return { path: "team-a/Dashboard.md" };
				}
				return { path: "team-b/Dashboard.md" };
			}),
		} as any;
		const ambiguityDetector = createLinkResolutionAmbiguityDetector(
			createMockVault(["team-a/Dashboard.md", "team-b/Dashboard.md"]),
		);

		const teamAFirst = resolveLinkFromRawLinkPath(
			metadataCache,
			"Dashboard",
			"team-a/index.md",
			ambiguityDetector,
		);
		const teamB = resolveLinkFromRawLinkPath(
			metadataCache,
			"Dashboard",
			"team-b/index.md",
			ambiguityDetector,
		);
		const teamASecond = resolveLinkFromRawLinkPath(
			metadataCache,
			"Dashboard",
			"team-a/summary.md",
			ambiguityDetector,
		);

		expect(teamAFirst).not.toBe(teamASecond);
		expect(teamAFirst).toEqual(teamASecond);
		expect(teamAFirst).not.toBe(teamB);
		expect(teamAFirst.destinationPath).toBe("team-a/Dashboard.md");
		expect(teamB.destinationPath).toBe("team-b/Dashboard.md");
		expect(teamAFirst.isAmbiguous).toBe(true);
		expect(teamB.isAmbiguous).toBe(true);
		expect(metadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(3);
	});

	test("resolveLinkFromRawLinkPath treats explicit paths as unambiguous even when multiple files share the same name", async () => {
		const { resolveLinkFromRawLinkPath, createLinkResolutionAmbiguityDetector } =
			await import("../link-resolution/linkResolution");
		const metadataCache = {
			getFirstLinkpathDest: vi.fn(() => ({ path: "team-a/Dashboard.md" })),
		} as any;
		const ambiguityDetector = createLinkResolutionAmbiguityDetector(
			createMockVault(["team-a/Dashboard.md", "team-b/Dashboard.md"]),
		);

		const resolved = resolveLinkFromRawLinkPath(
			metadataCache,
			"team-a/Dashboard",
			"team-b/index.md",
			ambiguityDetector,
		);

		expect(resolved.isAmbiguous).toBe(false);
		expect(resolved.destinationPath).toBe("team-a/Dashboard.md");
	});

	test("LinkResolutionAmbiguityDetector updates counts on create/delete/rename", async () => {
		const { createLinkResolutionAmbiguityDetector } =
			await import("../link-resolution/linkResolution");
		const detector = createLinkResolutionAmbiguityDetector(
			createMockVault(["alpha/Foo.md", "beta/Foo.md", "alpha/Bar.md"]),
		);

		expect(detector.isAmbiguous("Foo")).toBe(true);

		detector.removePath("beta/Foo.md");
		expect(detector.isAmbiguous("Foo")).toBe(false);

		detector.addPath("gamma/Foo.md");
		expect(detector.isAmbiguous("Foo")).toBe(true);

		detector.renamePath("alpha/Bar.md", "gamma/Bar.md");
		expect(detector.isAmbiguous("Bar")).toBe(false);
	});

	test("getLinkNormalizationCacheStats reports per-cache stats with the expected names", async () => {
		const {
			getLinkNormalizationCacheStats,
			toCaseInsensitiveLookupKey,
			normalizeRawLinkpathToMarkdownPath,
			normalizeLinkToMarkdownPath,
		} = await import("../link-resolution/linkResolution");

		toCaseInsensitiveLookupKey("Foo.md");
		toCaseInsensitiveLookupKey("Foo.md");
		normalizeRawLinkpathToMarkdownPath("Folder\\Note");
		normalizeLinkToMarkdownPath("[[Note]]");

		const stats = getLinkNormalizationCacheStats();
		const names = stats.map((entry) => entry.name);

		expect(names).toEqual([
			"caseInsensitiveLookupKey",
			"rawLinkpathToMarkdownPath",
			"linkTextToMarkdownPath",
		]);
		expect(stats[0].hits).toBeGreaterThanOrEqual(1);
		expect(stats[0].maxEntries).toBeGreaterThan(0);
	});

	test("clearLinkNormalizationCaches resets retained entries and counts a clear", async () => {
		const {
			clearLinkNormalizationCaches,
			getLinkNormalizationCacheStats,
			toCaseInsensitiveLookupKey,
		} = await import("../link-resolution/linkResolution");

		toCaseInsensitiveLookupKey("Before.md");
		toCaseInsensitiveLookupKey("Before.md");

		clearLinkNormalizationCaches();

		const stats = getLinkNormalizationCacheStats();
		// All three caches should report a clear and no retained entries.
		for (const entry of stats) {
			expect(entry.clears).toBeGreaterThanOrEqual(1);
			expect(entry.currentSize + entry.previousSize).toBe(0);
		}
	});
});
