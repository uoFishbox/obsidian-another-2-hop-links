import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { ViewItem } from "application/presenters";
import { DEFAULT_SETTINGS } from "features/settings/model";
import ViewItemCardHarness from "./ViewItemCardHarness.svelte";
import { getLazyLoadManager } from "infrastructure/observers/IntersectionObserverRegistry";
import type { CardRenderModel } from "../cardRenderModel";

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
	return {
		...actual,
		Platform: {
			isMobile: false,
		},
		TFile: class {},
	};
});

vi.mock("features/preview/ui/CardPreview.svelte", async () => {
	const component = await import("./CardPreviewMountProbe.svelte");
	return { default: component.default };
});

describe("ViewItemCard", () => {
	afterEach(() => {
		cleanup();
		getLazyLoadManager().cleanup();
	});

	it("does not render or throw while item is temporarily undefined", () => {
		const file = createMockTFile("notes/source.md");
		const linkContext = {
			getPreview: vi.fn(),
			resolveFile: vi.fn(),
			buildWikiLink: vi.fn(),
			fileToLinktext: vi.fn(),
			sourceFile: file,
			getMetadata: vi.fn(),
			onOpenFile: vi.fn(),
			onHop1Click: vi.fn(),
			onHop2Click: vi.fn(),
			onTagClick: vi.fn(),
		};

		render(ViewItemCardHarness, {
			props: {
				item: undefined,
				settings: DEFAULT_SETTINGS,
				searchQuery: "",
				linkContext: linkContext as any,
				applicationStore: { updateVersion: 0 } as any,
				sourceFile: file,
			},
		});

		expect(document.querySelector(".cosense-card-links__box")).toBeNull();
	});

	it("uses the priority frontmatter title when configured", () => {
		const file = createMockTFile("notes/alpha.md");
		const item = { type: "file", data: file } as ViewItem;
		const fileToLinktext = vi.fn(() => "Alpha Link");
		const linkContext = {
			getPreview: vi.fn(async () => ({
				type: "text",
				content: "preview",
			})),
			resolveFile: vi.fn(),
			buildWikiLink: vi.fn(() => "[[alpha]]"),
			fileToLinktext,
			sourceFile: file,
			getMetadata: vi.fn(
				() =>
					({
						frontmatter: {
							title: "Custom Title",
						},
					}) as never,
			),
			onOpenFile: vi.fn(),
			onHop1Click: vi.fn(),
			onHop2Click: vi.fn(),
			onTagClick: vi.fn(),
		};

		render(ViewItemCardHarness, {
			props: {
				item,
				settings: {
					...DEFAULT_SETTINGS,
					priorityFrontmatterKeyForTitle: "title",
				},
				searchQuery: "",
				linkContext: linkContext as any,
				applicationStore: { updateVersion: 0 } as any,
				sourceFile: file,
			},
		});

		expect(screen.getByText("Custom Title")).toBeInTheDocument();
		expect(fileToLinktext).not.toHaveBeenCalled();
	});

	it("uses a precomputed card model without resolving display metadata", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("attachments/model.pdf");
		const item = { type: "file", data: targetFile } as ViewItem;
		const fileToLinktext = vi.fn(() => "fallback title");
		const getMetadata = vi.fn(() => null);
		const linkContext = {
			getPreview: vi.fn(),
			resolveFile: vi.fn(),
			buildWikiLink: vi.fn(),
			fileToLinktext,
			sourceFile,
			getMetadata,
			onOpenFile: vi.fn(),
			onHop1Click: vi.fn(),
			onHop2Click: vi.fn(),
			onTagClick: vi.fn(),
		};
		const model: CardRenderModel = {
			item,
			targetFile,
			title: "Compiled title",
			ariaLabel: "Compiled aria label",
			className: "compiled-card",
			extension: "pdf",
			directory: "attachments",
			interactionId: "compiled-id",
			interactionKey: "compiled-key",
			presentation: undefined,
			searchQuery: "compiled",
			searchScope: "title-only",
			contentPreview: undefined,
			previewRefreshToken: 0,
			previewActivationIdentity: "compiled-preview",
		};

		render(ViewItemCardHarness, {
			props: {
				item,
				model,
				linkContext: linkContext as never,
				applicationStore: { updateVersion: 0 } as never,
				sourceFile,
			},
		});

		const card = screen.getByLabelText("Compiled aria label");
		expect(card).toHaveTextContent("Compiled title");
		expect(card).toHaveClass("compiled-card");
		expect(card).toHaveAttribute("data-ccl-interaction-id", "compiled-id");
		expect(card).toHaveAttribute("data-directory", "attachments");
		expect(fileToLinktext).not.toHaveBeenCalled();
		expect(getMetadata).not.toHaveBeenCalled();
	});

	it("newLink renders placeholder immediately without preview processing", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const item = {
			type: "newLink",
			data: {
				rawText: "missing-link",
				path: undefined,
				isUnresolved: true,
				sourceFile,
			},
		} as ViewItem;
		const linkContext = {
			getPreview: vi.fn(),
			resolveFile: vi.fn(() => null),
			buildWikiLink: vi.fn(() => "[[missing-link]]"),
			fileToLinktext: vi.fn(() => "missing-link"),
			sourceFile,
			getMetadata: vi.fn(() => null),
			onOpenFile: vi.fn(),
			onHop1Click: vi.fn(),
			onHop2Click: vi.fn(),
			onTagClick: vi.fn(),
		};

		render(ViewItemCardHarness, {
			props: {
				item,
				settings: DEFAULT_SETTINGS,
				searchQuery: "",
				linkContext: linkContext as any,
				applicationStore: { updateVersion: 0 } as any,
				sourceFile,
			},
		});

		expect(screen.queryByTestId("card-preview-probe")).toBeNull();
		expect(document.querySelector(".unresolved-preview-placeholder")).toBeTruthy();
		expect(document.querySelector(".preview-mount-slot")).toBeNull();
		expect(linkContext.getPreview).not.toHaveBeenCalled();
	});

	it("row activation renders preview after the row becomes visible", async () => {
		const file = createMockTFile("notes/alpha.md");
		const item = { type: "file", data: file } as ViewItem;
		const linkContext = {
			getPreview: vi.fn(async () => ({
				type: "text",
				content: "preview",
			})),
			resolveFile: vi.fn(),
			buildWikiLink: vi.fn(() => "[[alpha]]"),
			fileToLinktext: vi.fn((targetFile: TFile) => targetFile.basename),
			sourceFile: file,
			getMetadata: vi.fn(() => null),
			onOpenFile: vi.fn(),
			onHop1Click: vi.fn(),
			onHop2Click: vi.fn(),
			onTagClick: vi.fn(),
		};

		render(ViewItemCardHarness, {
			props: {
				item,
				settings: DEFAULT_SETTINGS,
				searchQuery: "",
				linkContext: linkContext as any,
				applicationStore: { updateVersion: 0 } as any,
				sourceFile: file,
				visibility: "visible",
			},
		});
		await waitFor(() => {
			expect(screen.getByTestId("card-preview-probe")).toBeTruthy();
		});
		expect(document.querySelector(".preview-mount-slot")).toBeNull();
		expect(document.querySelector(".lazy-placeholder")).toBeNull();
	});

	it("mounted row does not execute preview before activation", async () => {
		const file = createMockTFile("notes/alpha.md");
		const item = { type: "file", data: file } as ViewItem;
		const linkContext = {
			getPreview: vi.fn(async () => ({
				type: "text",
				content: "preview",
			})),
			resolveFile: vi.fn(),
			buildWikiLink: vi.fn(() => "[[alpha]]"),
			fileToLinktext: vi.fn((targetFile: TFile) => targetFile.basename),
			sourceFile: file,
			getMetadata: vi.fn(() => null),
			onOpenFile: vi.fn(),
			onHop1Click: vi.fn(),
			onHop2Click: vi.fn(),
			onTagClick: vi.fn(),
		};

		render(ViewItemCardHarness, {
			props: {
				item,
				settings: DEFAULT_SETTINGS,
				searchQuery: "",
				linkContext: linkContext as any,
				applicationStore: { updateVersion: 0 } as any,
				sourceFile: file,
				visibility: "mounted",
			},
		});
		await Promise.resolve();

		expect(screen.queryByTestId("card-preview-probe")).toBeNull();
		expect(document.querySelector(".preview-mount-slot")).toBeNull();
		expect(document.querySelector(".lazy-placeholder")).toBeNull();
		expect(linkContext.getPreview).not.toHaveBeenCalled();
	});

	it("keeps activated preview mounted when the row returns to mounted", async () => {
		const file = createMockTFile("notes/alpha.md");
		const item = { type: "file", data: file } as ViewItem;
		const linkContext = {
			getPreview: vi.fn(async () => ({
				type: "text",
				content: "preview",
			})),
			resolveFile: vi.fn(),
			buildWikiLink: vi.fn(() => "[[alpha]]"),
			fileToLinktext: vi.fn((targetFile: TFile) => targetFile.basename),
			sourceFile: file,
			getMetadata: vi.fn(() => null),
			onOpenFile: vi.fn(),
			onHop1Click: vi.fn(),
			onHop2Click: vi.fn(),
			onTagClick: vi.fn(),
		};

		const { rerender } = render(ViewItemCardHarness, {
			props: {
				item,
				settings: DEFAULT_SETTINGS,
				searchQuery: "",
				linkContext: linkContext as any,
				applicationStore: { updateVersion: 0 } as any,
				sourceFile: file,
				visibility: "visible",
			},
		});
		await waitFor(() => {
			expect(screen.getByTestId("card-preview-probe")).toBeTruthy();
		});

		await rerender({
			item,
			settings: DEFAULT_SETTINGS,
			searchQuery: "",
			linkContext: linkContext as any,
			applicationStore: { updateVersion: 0 } as any,
			sourceFile: file,
			visibility: "mounted",
		});
		await Promise.resolve();

		expect(screen.getByTestId("card-preview-probe")).toBeTruthy();
	});
});
