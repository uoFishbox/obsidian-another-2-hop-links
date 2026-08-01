import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { ViewItem } from "application/presenters";
import { DEFAULT_SETTINGS } from "features/settings/model";
import ViewItemCardHarness from "./ViewItemCardHarness.svelte";
import { getLazyLoadManager } from "infrastructure/observers/IntersectionObserverRegistry";
import type { CardRenderModel } from "../cardRenderModel";
import { compileCardPreviewRequest } from "features/preview/core/cardPreviewRequest";

vi.mock("features/preview/ui/CardPreview.svelte", async () => {
	const component = await import("./CardPreviewMountProbe.svelte");
	return { default: component.default };
});

function createLinkContext(sourceFile: TFile) {
	return {
		getPreview: vi.fn(),
		resolveFile: vi.fn(),
		buildWikiLink: vi.fn(),
		fileToLinktext: vi.fn((file: TFile) => file.basename),
		sourceFile,
		getMetadata: vi.fn(() => null),
		onOpenFile: vi.fn(),
		onHop1Click: vi.fn(),
		onHop2Click: vi.fn(),
		onTagClick: vi.fn(),
	};
}

describe("ViewItemCard", () => {
	afterEach(() => {
		cleanup();
		getLazyLoadManager().cleanup();
	});

	it("does not render while item is temporarily undefined", () => {
		const sourceFile = createMockTFile("notes/source.md");
		render(ViewItemCardHarness, {
			props: {
				item: undefined,
				linkContext: createLinkContext(sourceFile) as never,
				applicationStore: { updateVersion: 0 } as never,
				sourceFile,
			},
		});

		expect(document.querySelector(".cosense-card-links__box")).toBeNull();
	});

	it("uses a precomputed card model without resolving display metadata", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("attachments/model.pdf");
		const item = { type: "file", data: targetFile } as ViewItem;
		const linkContext = createLinkContext(sourceFile);
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
			interactionDescriptor: null,
			presentation: undefined,
			searchQuery: "compiled",
			searchScope: "title-only",
			contentPreview: undefined,
			previewRefreshToken: 0,
			previewOverride: null,
			previewRequest: compileCardPreviewRequest({
				file: targetFile,
				searchQuery: "compiled",
				previewRefreshToken: 0,
				previewOverride: null,
				previewRenderVersion: "compiled-preview",
				settings: DEFAULT_SETTINGS,
			}),
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
		expect(linkContext.fileToLinktext).not.toHaveBeenCalled();
		expect(linkContext.getMetadata).not.toHaveBeenCalled();
		expect(screen.getByTestId("card-preview-probe")).toHaveAttribute(
			"data-file-path",
			targetFile.path,
		);
	});

	it("renders unresolved placeholders without preview processing", () => {
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
		const linkContext = createLinkContext(sourceFile);
		linkContext.resolveFile.mockReturnValue(null);

		render(ViewItemCardHarness, {
			props: {
				item,
				settings: DEFAULT_SETTINGS,
				linkContext: linkContext as never,
				applicationStore: { updateVersion: 0 } as never,
				sourceFile,
			},
		});

		expect(screen.queryByTestId("card-preview-probe")).toBeNull();
		expect(
			document.querySelector(".unresolved-preview-placeholder"),
		).not.toBeNull();
		expect(linkContext.getPreview).not.toHaveBeenCalled();
	});

	it("passes the direct non-virtual preview request to CardPreview", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("notes/target.md");
		const item = { type: "file", data: targetFile } as ViewItem;

		render(ViewItemCardHarness, {
			props: {
				item,
				searchQuery: "needle",
				previewRefreshToken: 4,
				linkContext: createLinkContext(sourceFile) as never,
				applicationStore: { updateVersion: 0 } as never,
				sourceFile,
			},
		});

		const preview = screen.getByTestId("card-preview-probe");
		expect(preview).toHaveAttribute("data-file-path", targetFile.path);
		expect(preview).toHaveAttribute("data-search-query", "needle");
		expect(preview).toHaveAttribute("data-preview-refresh-token", "0:0:4");
	});
});
