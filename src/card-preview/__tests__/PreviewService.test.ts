import { afterEach, describe, test, expect, vi, beforeEach, type Mock } from "vitest";
import { MarkdownRenderer } from "obsidian";
import {
	createPreviewService,
	type DisposablePreviewService,
	type PreviewResolver,
} from "../pipeline/createPreviewService";
import { generateVideoPreview } from "../renderers/videoPreviewRenderer";
import { generateCanvasPreview } from "../renderers/canvasPreviewRenderer";
import { createCardPreviewSharedCache } from "card-preview/ui/cardPreviewSharedCache";
import { createPreviewRenderSettings } from "card-preview/pipeline/previewRenderSettings";
import { DEFAULT_SETTINGS, type PluginSettings } from "settings/model";
import type { IVault, IMetadataCache } from "obsidian-integration/hostContracts";
import {
	createMockTFileAsPlainObject,
	createMockVault,
} from "testing/__mocks__/testHelpers";

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
	let previewService: DisposablePreviewService;
	let settings: PluginSettings;
	const previewSharedCache = createCardPreviewSharedCache();

	function createService(resolvePreview?: PreviewResolver): DisposablePreviewService {
		return createPreviewService(
			{
				vault,
				metadataCache,
				app: { workspace: {} } as any,
				getSettings: () => settings,
			},
			resolvePreview,
		);
	}

	beforeEach(() => {
		vault = createMockVault();
		metadataCache = createMockMetadataCache();
		settings = DEFAULT_SETTINGS;
		previewService = createService();
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
				const result = await previewService.getPreview(file);
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
				const result = await previewService.getPreview(file);
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
			const result = await previewService.getPreview(file);
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

			const result = await previewService.getPreview(file);
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

			const result = await previewService.getPreview(file);
			expect(result.type).toBe("image");
			expect(result.content).toBe(`app://local/${imageFile.path}`);
		});
	});

	describe("image retrieval from Markdown embeds", () => {
		test("returns image preview from metadata cache without MarkdownRenderer", async () => {
			const file = createMockTFileAsPlainObject("note.md");
			const imageUrl = "https://example.com/api/image?id=123";
			(metadataCache.getFileCache as Mock).mockReturnValue({
				embeds: [{ original: `![](${imageUrl})`, link: imageUrl }],
			});
			(metadataCache.getFirstLinkpathDest as Mock).mockReturnValue(undefined);

			const result = await previewService.getPreview(file);
			expect(result).toEqual({ type: "image", content: imageUrl });
			expect(vault.cachedRead).not.toHaveBeenCalled();
			expect(MarkdownRenderer.render).not.toHaveBeenCalled();
		});
	});

	test("shares cachedRead during a single preview generation", async () => {
		const file = createMockTFileAsPlainObject("note.md");
		(vault.cachedRead as Mock).mockResolvedValue("plain text only");
		(metadataCache.getFileCache as Mock).mockReturnValue({});

		const result = await previewService.getPreview(file);
		expect(vault.cachedRead).toHaveBeenCalledTimes(1);
		expect(result.type).toBe("text");
	});

	test("shares raw content between preview generation and search context", async () => {
		const file = createMockTFileAsPlainObject("note.md");
		(vault.cachedRead as Mock).mockResolvedValue("before alpha after");
		(metadataCache.getFileCache as Mock).mockReturnValue({});

		const result = await previewService.getPreview(file);

		expect(result.type).toBe("text");

		await expect(
			previewSharedCache.applySharedSearchContextToTextPreview({
				previewContent: "<p>fallback preview</p>",
				cacheKey: "preview-id:shared-raw",
				targetFile: file,
				normalizedQuery: "alpha",
				settings: createPreviewRenderSettings(DEFAULT_SETTINGS),
				vault: vault as any,
				getRawContent: previewService.getRawContent,
			}),
		).resolves.toContain("alpha");

		expect(vault.cachedRead).toHaveBeenCalledTimes(1);
	});

	test("shares in-flight raw content reads and invalidates them by mtime", async () => {
		const file = createMockTFileAsPlainObject("shared-note.md");
		let resolveContent!: (content: string) => void;
		(vault.cachedRead as Mock).mockReturnValueOnce(
			new Promise<string>((resolve) => {
				resolveContent = resolve;
			}),
		);

		const first = previewService.getRawContent(file);
		const second = previewService.getRawContent(file);
		resolveContent("first revision");

		await expect(Promise.all([first, second])).resolves.toEqual([
			"first revision",
			"first revision",
		]);
		expect(vault.cachedRead).toHaveBeenCalledTimes(1);

		file.stat.mtime += 1;
		(vault.cachedRead as Mock).mockResolvedValueOnce("second revision");
		await expect(previewService.getRawContent(file)).resolves.toBe(
			"second revision",
		);
		expect(vault.cachedRead).toHaveBeenCalledTimes(2);
	});

	test("preview generation cache is separated by settings affecting generation", async () => {
		const resolvePreview = vi.fn<PreviewResolver>(async (_file, context) => ({
			type: "text" as const,
			content: String(context.settings.previewMaxChars),
		}));
		const service = createService(resolvePreview);
		const file = createMockTFileAsPlainObject("note.md");

		settings = { ...DEFAULT_SETTINGS, previewMaxChars: 100 };
		const first = await service.getPreview(file);
		settings = { ...DEFAULT_SETTINGS, previewMaxChars: 200 };
		const second = await service.getPreview(file);
		const third = await service.getPreview(file);

		expect(first).toEqual({ type: "text", content: "100" });
		expect(second).toEqual({ type: "text", content: "200" });
		expect(third).toEqual({ type: "text", content: "200" });
		expect(resolvePreview).toHaveBeenCalledTimes(2);
	});

	test("uses requested card dimensions for generation and cache identity", async () => {
		const resolvePreview = vi.fn<PreviewResolver>(async (_file, context) => ({
			type: "text" as const,
			content: `${context.settings.cardWidthPx}:${context.settings.cardHeightRatio}`,
		}));
		const service = createService(resolvePreview);
		const file = createMockTFileAsPlainObject("dimensioned-note.md");
		const firstSettings = createPreviewRenderSettings({
			...DEFAULT_SETTINGS,
			cardWidthPx: 170,
			cardHeightRatio: 1.2,
		});
		const secondSettings = createPreviewRenderSettings({
			...DEFAULT_SETTINGS,
			cardWidthPx: 200,
			cardHeightRatio: 1.2,
		});

		const first = await service.getPreview(file, undefined, {
			renderSettings: firstSettings,
		});
		const firstCached = await service.getPreview(file, undefined, {
			renderSettings: firstSettings,
		});
		const second = await service.getPreview(file, undefined, {
			renderSettings: secondSettings,
		});

		expect(first).toEqual({ type: "text", content: "170:1.2" });
		expect(firstCached).toBe(first);
		expect(second).toEqual({ type: "text", content: "200:1.2" });
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
		const service = createService(resolvePreview);

		try {
			for (let index = 0; index < 81; index++) {
				const file = createMockTFileAsPlainObject(`video-${index}.mp4`, "mp4");
				await service.getPreview(file);
			}

			expect(revokeObjectURL).toHaveBeenCalledWith("blob:video-0.mp4");
			expect(revokeObjectURL).toHaveBeenCalledTimes(1);
		} finally {
			service.dispose();
			Object.defineProperty(URL, "revokeObjectURL", {
				configurable: true,
				value: originalRevokeObjectURL,
			});
		}
	});
});
