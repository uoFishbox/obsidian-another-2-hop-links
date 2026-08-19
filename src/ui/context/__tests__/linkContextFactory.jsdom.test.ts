import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { createLinkContextFactory } from "ui/context/linkContextFactory";
import type { TwoHopIndexedLink } from "types";
import { triggerHoverPopover } from "features/popover/mobilePopover";
import { openFile, openLinkDestination } from "infrastructure/workspace/fileOpener";
import { resolveFileByPath } from "shared/obsidian/resolveFileByPath";

vi.mock("ui/handlers/viewHandlers", () => ({
	handleTagClick: vi.fn(),
}));

vi.mock("features/popover/mobilePopover", () => ({
	triggerHoverPopover: vi.fn(),
}));

vi.mock("infrastructure/workspace/fileOpener", () => ({
	openFile: vi.fn(),
	openLinkDestination: vi.fn(),
}));

vi.mock("shared/obsidian/resolveFileByPath", () => ({
	resolveFileByPath: vi.fn(),
}));

const openFileMock = vi.mocked(openFile);
const openLinkDestinationMock = vi.mocked(openLinkDestination);
const resolveFileByPathMock = vi.mocked(resolveFileByPath);

function createPosition(line: number) {
	return {
		start: { line, col: 0, offset: line * 10 },
		end: { line, col: 4, offset: line * 10 + 4 },
	};
}

function createBaseLink(sourceFile: TFile): TwoHopIndexedLink {
	return {
		rawText: sourceFile.basename,
		path: sourceFile.path,
		displayText: sourceFile.basename,
		isUnresolved: false,
		sourceFile,
		position: createPosition(1),
		key: "prop.key",
	};
}

function createPreviewServiceMock() {
	return {};
}

function createFactory(metadataCache: object, workspace: object = {}) {
	return createLinkContextFactory(
		metadataCache as any,
		{} as any,
		{} as any,
		workspace as any,
		{} as any,
		{ workspace } as any,
		createPreviewServiceMock() as any,
	);
}

describe("createLinkContextFactory", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("onHop2Click: does not pass property key when search hit position is prioritized", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const workspace = {};
		const factory = createFactory(
			{
				fileToLinktext: vi.fn((f: TFile) => f.basename),
			},
			workspace,
		);
		const context = factory(sourceFile, {
			highlightOnOpen: "always",
		} as any);

		const link = createBaseLink(sourceFile);
		context.onHop2Click(new MouseEvent("click"), link, {
			highlightMode: "force",
			preferredPosition: createPosition(9),
		});

		expect(openFileMock).toHaveBeenCalledWith(
			workspace,
			sourceFile,
			expect.objectContaining({
				start: expect.objectContaining({ line: 9 }),
			}),
			false,
			undefined,
		);
	});

	it("onHop1Click: opens unresolved links with their raw text and source path", () => {
		const sourceFile = createMockTFile("notes/origin-note.md");
		const workspace = { openLinkText: vi.fn() };
		const factory = createFactory(
			{
				fileToLinktext: vi.fn((f: TFile) => f.basename),
			},
			workspace,
		);
		const context = factory(sourceFile, { highlightOnOpen: "always" } as any);
		const link: TwoHopIndexedLink = {
			rawText: "missing-destination",
			path: undefined,
			isUnresolved: true,
			sourceFile: createMockTFile("notes/link-origin.md"),
		};

		context.onHop1Click(new MouseEvent("click"), link);

		expect(workspace.openLinkText).toHaveBeenCalledWith(
			"missing-destination",
			"notes/origin-note.md",
			false,
		);
	});

	it("onHop1Click: does not pass property key when search hit position is prioritized", () => {
		const originFile = createMockTFile("notes/origin.md");
		const targetFile = createMockTFile("notes/target.md");
		const workspace = { openLinkText: vi.fn() };
		resolveFileByPathMock.mockReturnValue(targetFile);

		const factory = createFactory(
			{
				fileToLinktext: vi.fn((f: TFile) => f.basename),
			},
			workspace,
		);
		const context = factory(originFile, {
			highlightOnOpen: "always",
		} as any);

		const link: TwoHopIndexedLink = {
			...createBaseLink(targetFile),
			path: targetFile.path,
		};
		context.onHop1Click(new MouseEvent("click"), link, {
			highlightMode: "force",
			preferredPosition: createPosition(6),
		});

		expect(openFileMock).toHaveBeenCalledWith(
			workspace,
			targetFile,
			expect.objectContaining({
				start: expect.objectContaining({ line: 6 }),
			}),
			false,
			undefined,
		);
		expect(openLinkDestinationMock).not.toHaveBeenCalled();
	});

	it("onHop2Click: runtime-hydrates backlink position and opens", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const workspace = {};
		const factory = createFactory(
			{
				fileToLinktext: vi.fn((f: TFile) => f.basename),
				getFileCache: vi.fn(() => ({
					links: [
						{
							link: sourceFile.basename,
							original: `[[${sourceFile.basename}]]`,
							displayText: sourceFile.basename,
							position: createPosition(4),
						},
					],
					embeds: [],
					frontmatterLinks: undefined,
				})),
			},
			workspace,
		);
		const context = factory(sourceFile, {
			highlightOnOpen: "always",
		} as any);

		const link = {
			...createBaseLink(sourceFile),
			position: undefined,
		};
		context.onHop2Click(new MouseEvent("click"), link);

		expect(openFileMock).toHaveBeenCalledWith(
			workspace,
			sourceFile,
			expect.objectContaining({
				start: expect.objectContaining({ line: 4 }),
			}),
			false,
			undefined,
		);
	});

	it("onHop2Click: focuses the first target property and prefers it over body links", () => {
		const sourceFile = createMockTFile("notes/backlink-origin.md");
		const targetFile = createMockTFile("notes/destination-note.md");
		const otherFile = createMockTFile("notes/unrelated-note.md");
		const workspace = {};
		const metadataCache = {
			fileToLinktext: vi.fn((f: TFile) => f.basename),
			getFileCache: vi.fn(() => ({
				links: [
					{
						link: "destination-link",
						original: "[[destination-link]]",
						position: createPosition(4),
					},
				],
				embeds: [],
				frontmatterLinks: [
					{
						key: "unrelated-property",
						link: "unrelated-link",
						original: "[[unrelated-link]]",
					},
					{
						key: "display-alias-property",
						link: "display-alias",
						original: "[[display-alias]]",
					},
					{
						key: "second-destination-property",
						link: "destination-link",
						original: "[[destination-link]]",
					},
				],
			})),
			getFirstLinkpathDest: vi.fn((linkpath: string) => {
				if (linkpath === "destination-link" || linkpath === "display-alias") {
					return targetFile;
				}
				if (linkpath === "unrelated-link") return otherFile;
				return null;
			}),
		} as any;
		const factory = createFactory(metadataCache, workspace);
		const context = factory(sourceFile, { highlightOnOpen: "always" } as any);
		const link: TwoHopIndexedLink = {
			rawText: "destination-link",
			path: targetFile.path,
			lookupPath: targetFile.path,
			isUnresolved: false,
			sourceFile,
		};

		context.onHop2Click(new MouseEvent("click"), link);

		expect(openFileMock).toHaveBeenCalledWith(
			workspace,
			sourceFile,
			undefined,
			false,
			"display-alias-property",
		);
	});

	it("onHop2Click: foreign-window ctrl click still opens a tab", () => {
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const foreignWindow = frame.contentWindow;
		expect(foreignWindow).toBeTruthy();
		if (!foreignWindow) {
			return;
		}

		const sourceFile = createMockTFile("notes/source.md");
		const workspace = {};
		const factory = createFactory(
			{
				fileToLinktext: vi.fn((f: TFile) => f.basename),
				getFileCache: vi.fn(() => null),
			},
			workspace,
		);
		const context = factory(sourceFile, {
			highlightOnOpen: "always",
		} as any);
		const event = new (foreignWindow as any).MouseEvent("click", {
			ctrlKey: true,
		});
		expect(event).not.toBeInstanceOf(MouseEvent);

		context.onHop2Click(event, createBaseLink(sourceFile));

		expect(openFileMock).toHaveBeenCalledWith(
			workspace,
			sourceFile,
			expect.objectContaining({
				start: expect.objectContaining({ line: 1 }),
			}),
			"tab",
			undefined,
		);
	});

	it("onLinkHover: runtime-hydrates backlink position and passes to hover", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const workspace = {};
		const metadataCache = {
			fileToLinktext: vi.fn((f: TFile) => f.basename),
			getFileCache: vi.fn(() => ({
				links: [
					{
						link: sourceFile.basename,
						original: `[[${sourceFile.basename}]]`,
						displayText: sourceFile.basename,
						position: createPosition(5),
					},
				],
				embeds: [],
				frontmatterLinks: undefined,
			})),
		} as any;

		const factory = createFactory(metadataCache, workspace);
		const context = factory(sourceFile, {} as any);

		context.onLinkHover?.(
			new MouseEvent("mouseover"),
			{
				...createBaseLink(sourceFile),
				position: undefined,
			},
			sourceFile,
			false,
		);

		expect(triggerHoverPopover).toHaveBeenCalledWith(
			workspace,
			expect.anything(),
			expect.any(MouseEvent),
			expect.objectContaining({
				position: expect.objectContaining({
					start: expect.objectContaining({ line: 5 }),
				}),
			}),
			sourceFile,
			expect.anything(),
			false,
			undefined,
		);
	});
});
