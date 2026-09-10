import { describe, expect, it, vi } from "vitest";
import type { CardItem } from "cards/CardItem";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { LinkUtilitiesContext } from "cards/context/linkUtilities";
import { DEFAULT_SETTINGS } from "settings/model";
import { createCardRenderModel, resolveCardTitleSnapshot } from "../cardRenderModel";
import type { CachedMetadata } from "obsidian";

describe("createCardRenderModel", () => {
	it("localizes the card action label from settings", () => {
		const file = createMockTFile("notes/example.md");
		const context: LinkUtilitiesContext = {
			getPreview: vi.fn(),
			resolveFile: vi.fn(() => null),
			buildWikiLink: vi.fn(() => "[[example]]"),
			fileToLinktext: vi.fn(() => "例"),
			sourceFile: createMockTFile("notes/source.md"),
			getMetadata: vi.fn(() => null),
		};

		const model = createCardRenderModel({
			item: { type: "file", data: file },
			settings: { ...DEFAULT_SETTINGS, language: "ja" },
			context,
			getPreviewRenderVersion: () => "0",
		});

		expect(model.ariaLabel).toBe("「例」を開く");
	});

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
		const item: CardItem = { type: "file", data: targetFile };

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
		});

		expect(model).toMatchObject({
			item,
			targetFile,
			title: "Quarterly report",
			className: null,
			extension: "pdf",
			interactionId: "i0",
			searchQuery: "needle",
		});
		expect(getPreviewRenderVersion).not.toHaveBeenCalled();
		expect(model.previewRequest?.previewCacheRevision).toBe("4:2");
		expect(model.previewRequest).toMatchObject({
			file: targetFile,
			searchQuery: "",
			previewCacheRevision: "4:2",
			previewOverride: { type: "text", content: "matched content" },
		});
		expect(model.previewRequest?.renderKey).toBeTruthy();
		expect(getPreviewRenderVersion).toHaveBeenCalledWith(targetFile.path);
		expect(fileToLinktext).not.toHaveBeenCalled();

		const titleSnapshot = resolveCardTitleSnapshot(
			item,
			{ priorityFrontmatterKeyForTitle: "title" },
			context,
		);
		expect(titleSnapshot).toEqual({
			targetFile,
			title: model.title,
		});
	});
});
