import { afterEach, describe, test, expect, vi, beforeEach, type Mock } from "vitest";
import { MarkdownRenderer } from "obsidian";
import { PreviewService as PreviewServiceClass } from "../core/createPreviewService";
import { generateVideoPreview } from "../renderers/videoPreviewRenderer";
import { generateCanvasPreview } from "../renderers/canvasPreviewRenderer";
import { createCardPreviewSharedCache } from "features/card-preview/ui/cardPreviewSharedCache";
import { DEFAULT_SETTINGS } from "features/settings/model";
import type { IVault, IMetadataCache } from "types/obsidian";
import {
	createMockTFileAsPlainObject,
	createMockVault,
} from "testing/__mocks__/testHelpers";
import type { PreviewResolver } from "../core/previewResolver";

vi.mock("../renderers/videoPreviewRenderer", () => ({
	clearVideoPreviewQueue: vi.fn(),
	generateVideoPreview: vi.fn(),
}));

vi.mock("../renderers/canvasPreviewRenderer", () => ({
	generateCanvasPreview: vi.fn(),
}));

vi.mock("obsidian", () => ({
	renderMath: vi.fn(),
	finishRenderMath: vi.fn(),
	Component: class {
		load() {}
		unload() {}
	},
	TFile: class {},
	MarkdownRenderer: { render: vi.fn().mockResolvedValue(undefined) },
}));

function createMockMetadataCache(): IMetadataCache {
	return {
		getFileCache: vi.fn(),
		getFirstLinkpathDest: vi.fn(),
	} as any;
}

describe("PreviewService.getPreview", () => {
	let vault: IVault;
	let metadataCache: IMetadataCache;
	let previewService: PreviewServiceClass;
	const previewSharedCache = createCardPreviewSharedCache();

	beforeEach(() => {
		vault = createMockVault();
		metadataCache = createMockMetadataCache();
		previewService = new PreviewServiceClass();
		previewSharedCache.clear();
		vi.clearAllMocks();
	});

	afterEach(() => {
		previewService.dispose();
	});

	describe("image file processing", () => {
		test.each(["png", "jpg", "jpeg", "webp"])(
			"%s files return an image preview",
			async (ext) => {
				const file = createMockTFileAsPlainObject(`image.${ext}`, ext);
				const result = await previewService.getPreview(
					file,
					vault,
					metadataCache,
				);
				expect(result.type).toBe("image");
				expect(result.content).toBe(`app://local/${file.path}`);
			},
		);
	});

	describe("video file processing", () => {
		beforeEach(() => {
			(generateVideoPreview as Mock).mockResolvedValue(undefined);
		});

		test.each(["mp4", "webm"])(
			"%s files attempt video preview generation",
			async (ext) => {
				const file = createMockTFileAsPlainObject(`video.${ext}`, ext);
				const result = await previewService.getPreview(
					file,
					vault,
					metadataCache,
				);
				expect(result.type).toBe("empty");
			},
		);
	});

	describe("Canvas file processing", () => {
		beforeEach(() => {
			(generateCanvasPreview as Mock).mockResolvedValue(undefined);
		});

		test("attempts Canvas preview generation for Canvas files", async () => {
			const file = createMockTFileAsPlainObject("canvas.canvas", "canvas");
			const mockRenderer = {
				renderEmbed: vi.fn().mockResolvedValue(undefined),
			};
			const result = await previewService.getPreview(
				file,
				vault,
				metadataCache,
				mockRenderer as any,
			);
			expect(result.type).toBe("empty");
		});
	});

	describe("image retrieval from frontmatter", () => {
		test("returns image preview when frontmatter has an image URL", async () => {
			const file = createMockTFileAsPlainObject("note.md");
			const imageUrl = "https://example.com/image.jpg";
			(metadataCache.getFileCache as Mock).mockReturnValue({
				frontmatter: { image: imageUrl },
			});
			(vault.cachedRead as Mock).mockResolvedValue("");

			const result = await previewService.getPreview(file, vault, metadataCache);
			expect(result.type).toBe("image");
			expect(result.content).toBe(imageUrl);
		});

		test("resolves and returns image preview when frontmatter has an internal link image", async () => {
			const file = createMockTFileAsPlainObject("note.md");
			const imageFile = createMockTFileAsPlainObject("image.png", "png");
			(metadataCache.getFileCache as Mock).mockReturnValue({
				frontmatter: { image: "[[image.png]]" },
			});
			(metadataCache.getFirstLinkpathDest as Mock).mockReturnValue(imageFile);
			(vault.cachedRead as Mock).mockResolvedValue("");

			const result = await previewService.getPreview(file, vault, metadataCache);
			expect(result.type).toBe("image");
			expect(result.content).toBe(`app://local/${imageFile.path}`);
		});
	});

	describe("image retrieval from Markdown embeds", () => {
		test("returns image preview without MarkdownRenderer for extensionless http(s) Markdown image URLs", async () => {
			const file = createMockTFileAsPlainObject("note.md");
			const imageUrl = "https://example.com/api/image?id=123";
			(metadataCache.getFileCache as Mock).mockReturnValue({});
			(metadataCache.getFirstLinkpathDest as Mock).mockReturnValue(undefined);
			(vault.cachedRead as Mock).mockResolvedValue(`![](${imageUrl})`);

			const result = await previewService.getPreview(file, vault, metadataCache);
			expect(result).toEqual({ type: "image", content: imageUrl });
			expect(MarkdownRenderer.render).not.toHaveBeenCalled();
		});
	});

	test("shares cachedRead during a single preview generation", async () => {
		const file = createMockTFileAsPlainObject("note.md");
		(vault.cachedRead as Mock).mockResolvedValue("plain text only");
		(metadataCache.getFileCache as Mock).mockReturnValue({});

		const result = await previewService.getPreview(
			file,
			vault,
			metadataCache,
			undefined,
			{ renderCodeBlockTypes: ["javascript"] } as any,
		);
		expect(vault.cachedRead).toHaveBeenCalledTimes(1);
		expect(result.type).toBe("text");
	});

	test("reads raw content separately for preview generation and search context", async () => {
		const file = createMockTFileAsPlainObject("note.md");
		(vault.cachedRead as Mock).mockResolvedValue("before alpha after");
		(metadataCache.getFileCache as Mock).mockReturnValue({});

		const result = await previewService.getPreview(
			file,
			vault,
			metadataCache,
			undefined,
			DEFAULT_SETTINGS,
		);

		expect(result.type).toBe("text");

		await expect(
			previewSharedCache.applySharedSearchContextToTextPreview({
				previewContent: "<p>fallback preview</p>",
				cacheKey: "preview-id:shared-raw",
				targetFile: file,
				normalizedQuery: "alpha",
				settings: DEFAULT_SETTINGS,
				vault: vault as any,
			}),
		).resolves.toContain("alpha");

		expect(vault.cachedRead).toHaveBeenCalledTimes(2);
	});

	test("first embed extraction is memoized within one generation", async () => {
		const file = createMockTFileAsPlainObject("note.md");
		(vault.cachedRead as Mock).mockResolvedValue(
			"```md\n![[ignored.png]]\n```\n![[shared.png]]",
		);
		(metadataCache.getFileCache as Mock).mockReturnValue({});

		const observedTargets: Array<string | undefined> = [];
		const resolvePreview: PreviewResolver = async (_file, context) => {
			const first = await context.getFirstEmbeddedMedia?.();
			const second = await context.getFirstEmbeddedMedia?.();
			observedTargets.push(first?.target, second?.target);
			return { type: "text", content: second?.target ?? "" };
		};
		const service = new PreviewServiceClass(resolvePreview);

		const result = await service.getPreview(file, vault, metadataCache);
		expect(vault.cachedRead).toHaveBeenCalledTimes(1);
		expect(observedTargets).toEqual(["shared.png", "shared.png"]);
		expect(result).toEqual({ type: "text", content: "shared.png" });
	});

	test("preview generation cache is separated by settings affecting generation", async () => {
		const resolvePreview = vi.fn<PreviewResolver>(async (_file, context) => ({
			type: "text" as const,
			content: String(context.settings?.previewMaxChars ?? ""),
		}));
		const service = new PreviewServiceClass(resolvePreview);
		const file = createMockTFileAsPlainObject("note.md");

		const first = await service.getPreview(file, vault, metadataCache, undefined, {
			previewMaxChars: 100,
		} as any);
		const second = await service.getPreview(file, vault, metadataCache, undefined, {
			previewMaxChars: 200,
		} as any);
		const third = await service.getPreview(file, vault, metadataCache, undefined, {
			previewMaxChars: 200,
		} as any);

		expect(first).toEqual({ type: "text", content: "100" });
		expect(second).toEqual({ type: "text", content: "200" });
		expect(third).toEqual({ type: "text", content: "200" });
		expect(resolvePreview).toHaveBeenCalledTimes(2);
	});

	test("Blob URL image previews are evicted from cache by byteSize and count-limit-equivalent size", async () => {
		const revokeObjectURL = vi.fn();
		const originalRevokeObjectURL = URL.revokeObjectURL;
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: revokeObjectURL,
		});

		const resolvePreview = vi.fn<PreviewResolver>(async (file) => ({
			type: "image" as const,
			content: `blob:${file.path}`,
			byteSize: 1,
		}));
		const service = new PreviewServiceClass(resolvePreview);

		try {
			for (let index = 0; index < 81; index++) {
				const file = createMockTFileAsPlainObject(`video-${index}.mp4`, "mp4");
				await service.getPreview(file, vault, metadataCache);
			}

			expect(revokeObjectURL).toHaveBeenCalledWith("blob:video-0.mp4");
			expect(revokeObjectURL).toHaveBeenCalledTimes(1);
		} finally {
			service.shutdown();
			Object.defineProperty(URL, "revokeObjectURL", {
				configurable: true,
				value: originalRevokeObjectURL,
			});
		}
	});
});
