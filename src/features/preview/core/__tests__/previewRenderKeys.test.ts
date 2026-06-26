import type { TFile } from "obsidian";
import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "types/settings";
import { buildCardPreviewActivationIdentity } from "../cardPreviewActivationIdentity";
import { createPreviewOverrideIdentity } from "../previewRenderIdentity";
import {
	CACHE_KEY_SEPARATOR,
	buildRenderCacheKey,
	buildRenderCacheKeyFromNormalizedQuery,
	normalizePreviewQuery,
} from "../previewRenderKeys";

function createFile(path: string, extension = "md"): TFile {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return {
		path,
		name,
		basename: name.replace(/\.\w+$/u, ""),
		extension,
		stat: { ctime: 1, mtime: 2, size: 3 },
		parent: null,
		vault: {} as never,
	} as unknown as TFile;
}

describe("preview render keys", () => {
	test("builds the same render cache key from a pre-normalized query", () => {
		const file = createFile("Folder/Note.md");
		const query = "  Alpha  ";
		const renderVersionIdentity = "4:1:none";

		expect(
			buildRenderCacheKeyFromNormalizedQuery(
				file,
				normalizePreviewQuery(query),
				DEFAULT_SETTINGS,
				renderVersionIdentity,
			),
		).toBe(
			buildRenderCacheKey(file, query, DEFAULT_SETTINGS, renderVersionIdentity),
		);
	});

	test("builds activation identity from scalar inputs without changing key format", () => {
		const file = createFile("Folder/Note.md");
		const renderVersion = "4:1";
		const refreshToken = 2;
		const override = { type: "text", content: "preview text" } as const;
		const normalizedQuery = normalizePreviewQuery(" Alpha ");
		const overrideIdentity = createPreviewOverrideIdentity(override);
		const renderVersionIdentity = `${renderVersion}:${refreshToken}:${overrideIdentity}`;

		expect(
			buildCardPreviewActivationIdentity(
				file,
				DEFAULT_SETTINGS,
				normalizedQuery,
				renderVersion,
				refreshToken,
				override,
			),
		).toBe(
			`${buildRenderCacheKeyFromNormalizedQuery(
				file,
				normalizedQuery,
				DEFAULT_SETTINGS,
				renderVersionIdentity,
			)}${CACHE_KEY_SEPARATOR}${file.extension}`,
		);
	});
});
