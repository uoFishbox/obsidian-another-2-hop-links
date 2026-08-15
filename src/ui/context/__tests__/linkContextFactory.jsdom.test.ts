import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { createLinkContextFactory } from "ui/context/linkContextFactory";
import type { TwoHopIndexedLink } from "types";
import { triggerHoverPopover } from "features/popover/mobilePopover";

vi.mock("ui/handlers/viewHandlers", () => ({
	handleTagClick: vi.fn(),
}));

vi.mock("features/popover/mobilePopover", () => ({
	triggerHoverPopover: vi.fn(),
}));

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

describe("createLinkContextFactory", () => {
	it("onHop2Click: does not pass property key when search hit position is prioritized", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const handleOpenFile = vi.fn();
		const eventHandlers = {
			handleResolveFile: vi.fn(),
			handleOpenFile,
			handleOpenLinkDestination: vi.fn(),
			handleGetMetadata: vi.fn(),
			handleShowFileMenu: vi.fn(),
		} as any;

		const factory = createLinkContextFactory(
			{
				fileToLinktext: vi.fn((f: TFile) => f.basename),
			} as any,
			eventHandlers,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			createPreviewServiceMock() as any,
		);
		const context = factory(sourceFile, {
			highlightOnOpen: "always",
		} as any);

		const link = createBaseLink(sourceFile);
		context.onHop2Click(new MouseEvent("click"), link, {
			highlightMode: "force",
			preferredPosition: createPosition(9),
		});

		expect(handleOpenFile).toHaveBeenCalledWith(
			sourceFile,
			expect.objectContaining({
				start: expect.objectContaining({ line: 9 }),
			}),
			false,
			undefined,
		);
	});

	it("onHop1Click: does not pass property key when search hit position is prioritized", () => {
		const originFile = createMockTFile("notes/origin.md");
		const targetFile = createMockTFile("notes/target.md");
		const handleOpenFile = vi.fn();
		const handleOpenLinkDestination = vi.fn();
		const eventHandlers = {
			handleResolveFile: vi.fn(() => targetFile),
			handleOpenFile,
			handleOpenLinkDestination,
			handleGetMetadata: vi.fn(),
			handleShowFileMenu: vi.fn(),
		} as any;

		const factory = createLinkContextFactory(
			{
				fileToLinktext: vi.fn((f: TFile) => f.basename),
			} as any,
			eventHandlers,
			{} as any,
			{} as any,
			{} as any,
			{
				app: {
					workspace: {
						openLinkText: vi.fn(),
					},
				},
			} as any,
			{} as any,
			createPreviewServiceMock() as any,
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

		expect(handleOpenFile).toHaveBeenCalledWith(
			targetFile,
			expect.objectContaining({
				start: expect.objectContaining({ line: 6 }),
			}),
			false,
			undefined,
		);
		expect(handleOpenLinkDestination).not.toHaveBeenCalled();
	});

	it("onHop2Click: runtime-hydrates backlink position and opens", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const handleOpenFile = vi.fn();
		const eventHandlers = {
			handleResolveFile: vi.fn(),
			handleOpenFile,
			handleOpenLinkDestination: vi.fn(),
			handleGetMetadata: vi.fn(),
			handleShowFileMenu: vi.fn(),
		} as any;

		const factory = createLinkContextFactory(
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
			} as any,
			eventHandlers,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			createPreviewServiceMock() as any,
		);
		const context = factory(sourceFile, {
			highlightOnOpen: "always",
		} as any);

		const link = {
			...createBaseLink(sourceFile),
			position: undefined,
		};
		context.onHop2Click(new MouseEvent("click"), link);

		expect(handleOpenFile).toHaveBeenCalledWith(
			sourceFile,
			expect.objectContaining({
				start: expect.objectContaining({ line: 4 }),
			}),
			false,
			undefined,
		);
	});

	it("onHop2Click: focuses the first target property and prefers it over body links", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("notes/target.md");
		const otherFile = createMockTFile("notes/other.md");
		const handleOpenFile = vi.fn();
		const metadataCache = {
			fileToLinktext: vi.fn((f: TFile) => f.basename),
			getFileCache: vi.fn(() => ({
				links: [
					{
						link: "target",
						original: "[[target]]",
						position: createPosition(4),
					},
				],
				embeds: [],
				frontmatterLinks: [
					{ key: "other", link: "other", original: "[[other]]" },
					{
						key: "first",
						link: "alias-to-target",
						original: "[[alias-to-target]]",
					},
					{ key: "second", link: "target", original: "[[target]]" },
				],
			})),
			getFirstLinkpathDest: vi.fn((linkpath: string) => {
				if (linkpath === "target" || linkpath === "alias-to-target") {
					return targetFile;
				}
				if (linkpath === "other") return otherFile;
				return null;
			}),
		} as any;
		const factory = createLinkContextFactory(
			metadataCache,
			{
				handleResolveFile: vi.fn(),
				handleOpenFile,
				handleOpenLinkDestination: vi.fn(),
				handleGetMetadata: vi.fn(),
				handleShowFileMenu: vi.fn(),
			} as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			createPreviewServiceMock() as any,
		);
		const context = factory(sourceFile, { highlightOnOpen: "always" } as any);
		const link: TwoHopIndexedLink = {
			rawText: "target",
			path: targetFile.path,
			lookupPath: targetFile.path,
			isUnresolved: false,
			sourceFile,
		};

		context.onHop2Click(new MouseEvent("click"), link);

		expect(handleOpenFile).toHaveBeenCalledWith(
			sourceFile,
			undefined,
			false,
			"first",
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
		const handleOpenFile = vi.fn();
		const factory = createLinkContextFactory(
			{
				fileToLinktext: vi.fn((f: TFile) => f.basename),
				getFileCache: vi.fn(() => null),
			} as any,
			{
				handleResolveFile: vi.fn(),
				handleOpenFile,
				handleOpenLinkDestination: vi.fn(),
				handleGetMetadata: vi.fn(),
				handleShowFileMenu: vi.fn(),
			} as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			createPreviewServiceMock() as any,
		);
		const context = factory(sourceFile, {
			highlightOnOpen: "always",
		} as any);
		const event = new (foreignWindow as any).MouseEvent("click", {
			ctrlKey: true,
		});
		expect(event).not.toBeInstanceOf(MouseEvent);

		context.onHop2Click(event, createBaseLink(sourceFile));

		expect(handleOpenFile).toHaveBeenCalledWith(
			sourceFile,
			expect.anything(),
			"tab",
			expect.anything(),
		);
	});

	it("onLinkHover: runtime-hydrates backlink position and passes to hover", () => {
		const sourceFile = createMockTFile("notes/source.md");
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

		const factory = createLinkContextFactory(
			metadataCache,
			{
				handleResolveFile: vi.fn(),
				handleOpenFile: vi.fn(),
				handleOpenLinkDestination: vi.fn(),
				handleGetMetadata: vi.fn(),
				handleShowFileMenu: vi.fn(),
			} as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			createPreviewServiceMock() as any,
		);
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
			expect.anything(),
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
