import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { CardItem } from "cards/CardItem";
import { DEFAULT_SETTINGS } from "settings/model";
import ViewItemCardHarness from "./ViewItemCardHarness.svelte";
import { getLazyLoadManager } from "obsidian-integration/observers/IntersectionObserverRegistry";
import type { CardRenderModel } from "cards/rendering/cardRenderModel";

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
		const item = { type: "file", data: targetFile } as CardItem;
		const linkContext = createLinkContext(sourceFile);
		const model: CardRenderModel = {
			item,
			targetFile,
			title: "Compiled title",
			ariaLabel: "Compiled aria label",
			className: "compiled-card",
			extension: "pdf",
			interactionId: "compiled-id",
			interactionDescriptor: null,
			searchQuery: "compiled",
			previewRequest: null,
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
		} as CardItem;
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

		expect(
			document.querySelector(".unresolved-preview-placeholder"),
		).not.toBeNull();
		expect(linkContext.getPreview).not.toHaveBeenCalled();
	});
});
