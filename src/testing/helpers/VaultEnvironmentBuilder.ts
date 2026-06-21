import { vi, type MockedObject } from "vitest";
import { IndexingService } from "../../core/indexing/index-service/IndexingService";
import type { CachedMetadata, ObsidianLinkMap } from "../../types/obsidian";
import { TFile, type LinkCache } from "obsidian";
import type { IVault, IMetadataCache } from "../../types/obsidian";
import type { Pos } from "obsidian";
import { buildDetailedBacklinksArtifactsChunked } from "../../core/indexing/backlink-builder/backlinkIndexer";
import { normalizeLinkToMarkdownPath } from "../../core/indexing/link-resolution/linkResolution";
import type { BacklinksMap } from "../../types/domain";
import { createMockTFile } from "../__mocks__/testHelpers";

function createLinkCache(linkText: string): LinkCache {
	return {
		link: linkText,
		original: `[[${linkText}]]`,
		position: {
			start: { line: 0, col: 0, offset: 0 },
			end: { line: 0, col: 0, offset: 0 },
		},
	};
}

function createTagCache(tag: string): { tag: string; position: Pos } {
	return {
		tag: tag.startsWith("#") ? tag : `#${tag}`,
		position: {
			start: { line: 0, col: 0, offset: 0 },
			end: { line: 0, col: 0, offset: 0 },
		},
	};
}

interface FileDefinition {
	path: string;
	links?: string[];
	tags?: string[];
}

function createCachedMetadata(
	links?: LinkCache[],
	tags?: Array<{ tag: string; position: any }>,
): CachedMetadata {
	return {
		links: links || [],
		tags: tags || [],
		embeds: [],
		headings: [],
		sections: [],
		frontmatter: undefined,
		frontmatterPosition: undefined,
		frontmatterLinks: undefined,
	} as CachedMetadata;
}

export class VaultEnvironmentBuilder {
	private files = new Map<string, TFile>();
	private fileMetadata = new Map<string, CachedMetadata>();
	private mockVault?: MockedObject<IVault>;
	private mockMetadataCache?: MockedObject<IMetadataCache>;

	constructor(definitions: FileDefinition[] = []) {
		definitions.forEach((def) => this.addFile(def));
	}

	public addFile(definition: FileDefinition): this {
		const { path, links = [], tags = [] } = definition;
		const file = createMockTFile(path, getFileExtension(path));
		this.files.set(path, file);

		const metadata = createCachedMetadata(
			links.map(createLinkCache),
			tags.map(createTagCache),
		);
		this.fileMetadata.set(path, metadata);

		if (this.mockVault) {
			this.updateMocks();
		}

		return this;
	}

	public removeFile(path: string): this {
		this.files.delete(path);
		this.fileMetadata.delete(path);

		if (this.mockVault) {
			this.updateMocks();
		}

		return this;
	}

	private updateMocks(): void {
		if (!this.mockVault || !this.mockMetadataCache) return;
		const allFiles = Array.from(this.files.values());
		const markdownFiles = allFiles.filter(isMarkdownFile);

		this.mockVault.getMarkdownFiles.mockReturnValue(markdownFiles);
		this.mockVault.getFiles.mockReturnValue(allFiles);

		this.mockVault.getAbstractFileByPath.mockImplementation(
			(path: string) => this.files.get(path) || null,
		);

		this.mockMetadataCache.getFileCache.mockImplementation(
			(file: TFile) => this.fileMetadata.get(file.path) || null,
		);

		this.mockMetadataCache.getFirstLinkpathDest.mockImplementation(
			(linkText: string) => this.resolveLinkTarget(linkText),
		);

		// addFile 後も resolved/unresolved の整合性を維持する
		const { resolvedLinks, unresolvedLinks } = this.buildObsidianLinkMaps();
		this.mockMetadataCache.resolvedLinks = resolvedLinks;
		this.mockMetadataCache.unresolvedLinks = unresolvedLinks;
	}

	public build() {
		const allFiles = Array.from(this.files.values());
		const markdownFiles = allFiles.filter(isMarkdownFile);

		this.mockVault = {
			getMarkdownFiles: vi.fn().mockReturnValue(markdownFiles),
			getFiles: vi.fn().mockReturnValue(allFiles),
			getAbstractFileByPath: vi.fn(
				(path: string) => this.files.get(path) || null,
			),
			cachedRead: vi.fn(),
			getResourcePath: vi.fn(),
		} as MockedObject<IVault>;

		// resolvedLinks と unresolvedLinks を自動生成
		const { resolvedLinks, unresolvedLinks } = this.buildObsidianLinkMaps();

		this.mockMetadataCache = {
			getFileCache: vi.fn(
				(file: TFile) => this.fileMetadata.get(file.path) || null,
			),
			getFirstLinkpathDest: vi.fn((linkText: string) =>
				this.resolveLinkTarget(linkText),
			),
			fileToLinktext: vi.fn(),
			getBacklinksForFile: vi.fn(() => ({
				data: new Map(),
				keys: () => [],
				get: () => null,
			})),
			resolvedLinks,
			unresolvedLinks,
		} as MockedObject<IMetadataCache>;

		const service = new IndexingService(
			this.mockVault,
			this.mockMetadataCache,
			() => true,
		);

		return {
			service,
			mockVault: this.mockVault,
			mockMetadataCache: this.mockMetadataCache,
			files: Object.fromEntries(this.files.entries()),
			builder: this,
		};
	}

	/**
	 * Obsidian の resolvedLinks/unresolvedLinks を模擬生成
	 */
	private buildObsidianLinkMaps(): {
		resolvedLinks: ObsidianLinkMap;
		unresolvedLinks: ObsidianLinkMap;
	} {
		const resolvedLinks: ObsidianLinkMap = {};
		const unresolvedLinks: ObsidianLinkMap = {};

		for (const [sourcePath, metadata] of this.fileMetadata.entries()) {
			if (!metadata.links || metadata.links.length === 0) continue;

			const sourceResolved: Record<string, number> = {};
			const sourceUnresolved: Record<string, number> = {};

			for (const linkCache of metadata.links) {
				const linkText = linkCache.link;
				const targetPath = normalizeLinkToMarkdownPath(linkText);

				if (this.files.has(targetPath)) {
					// 解決済み
					sourceResolved[targetPath] =
						(sourceResolved[targetPath] || 0) + 1;
				} else {
					// 未解決
					sourceUnresolved[linkText] =
						(sourceUnresolved[linkText] || 0) + 1;
				}
			}

			if (Object.keys(sourceResolved).length > 0) {
				resolvedLinks[sourcePath] = sourceResolved;
			}
			if (Object.keys(sourceUnresolved).length > 0) {
				unresolvedLinks[sourcePath] = sourceUnresolved;
			}
		}

		return { resolvedLinks, unresolvedLinks };
	}

	private resolveLinkTarget(linkText: string): TFile | null {
		const targetPath = normalizeLinkToMarkdownPath(linkText);
		return this.files.get(targetPath) || null;
	}

	public async buildBacklinksMapAsync(): Promise<BacklinksMap> {
		if (!this.mockVault || !this.mockMetadataCache) {
			this.build();
		}
		return (
			await buildDetailedBacklinksArtifactsChunked(
			this.mockVault!,
			this.mockMetadataCache!,
			{},
		)
		).detailedMap;
	}
}

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

function isMarkdownFile(file: TFile): boolean {
	return file.extension.toLowerCase() === "md";
}
