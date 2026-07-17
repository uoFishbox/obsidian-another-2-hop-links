import { describe, expect, it, vi } from "vitest";
import type { ViewItem } from "application/presenters";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { LinkUtilitiesContext } from "types/linkContext";
import { DEFAULT_SETTINGS } from "types/settings";
import { createCardRenderModel } from "../cardRenderModel";
import type { CachedMetadata } from "obsidian";

describe("createCardRenderModel", () => {
	it("compiles card display values and preview activation identity", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("attachments/report.pdf", "pdf");
		const fileToLinktext = vi.fn(() => "Report link");
		const getPreviewRenderVersion = vi.fn(() => "4:2");
		const context: LinkUtilitiesContext = {
			getPreview: vi.fn(async () => ({
				type: "text" as const,
				content: "preview",
			})),
			resolveFile: vi.fn(() => null),
			buildWikiLink: vi.fn(() => "[[report]]"),
			fileToLinktext,
			sourceFile,
			getMetadata: vi.fn(
				() =>
					({
						frontmatter: { title: "Quarterly report" },
					}) as unknown as CachedMetadata,
			),
		};
		const item: ViewItem = { type: "file", data: targetFile };

		const model = createCardRenderModel({
			item,
			settings: {
				...DEFAULT_SETTINGS,
				priorityFrontmatterKeyForTitle: "title",
			},
			context,
			getPreviewRenderVersion,
			searchQuery: "needle",
			searchScope: "title-only",
			contentPreview: "matched content",
			interactionId: "i0",
			interactionKey: "item:file:report",
		});

		expect(model).toMatchObject({
			item,
			targetFile,
			title: "Quarterly report",
			className: null,
			extension: "pdf",
			directory: null,
			interactionId: "i0",
			interactionKey: "item:file:report",
			searchQuery: "needle",
			searchScope: "title-only",
			contentPreview: "matched content",
		});
		expect(model.previewActivationIdentity).toBeTruthy();
		expect(model.previewCacheRevision).toBe("4:2:0");
		expect(getPreviewRenderVersion).toHaveBeenCalledWith(targetFile.path);
		expect(fileToLinktext).not.toHaveBeenCalled();
	});
});
