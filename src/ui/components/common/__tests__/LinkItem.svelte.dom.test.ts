import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import LinkItem from "../LinkItem.svelte";
import { DEFAULT_SETTINGS } from "types/settings";

vi.mock("obsidian", () => ({
	Platform: {
		isMobile: false,
	},
	TFile: class {},
}));

describe("LinkItem", () => {
	it("renders title as plain text when search query is empty", () => {
		const { container } = render(LinkItem, {
			props: {
				title: "Alpha <Beta>",
				ariaLabel: "alpha",
				interactionId: "item:file:notes/alpha.md",
				interactionKind: "item",
				settings: DEFAULT_SETTINGS,
				searchQuery: "",
			},
		});

		const title = container.querySelector(".cosense-card-links__box-title");
		expect(title).not.toBeNull();
		expect(title?.querySelector(".ccl-search-highlight")).toBeNull();
		expect(title?.textContent).toContain("Alpha <Beta>");
		expect(title?.innerHTML).not.toContain("ccl-search-highlight");
	});

	it("highlights matching parts of title in HTML when searching", () => {
		const { container } = render(LinkItem, {
			props: {
				title: "Notebook Search Result",
				ariaLabel: "search result",
				interactionId: "item:file:notes/search.md",
				interactionKind: "item",
				settings: DEFAULT_SETTINGS,
				searchQuery: "search",
			},
		});

		const highlight = container.querySelector(".ccl-search-highlight");
		expect(highlight).not.toBeNull();
		expect(highlight).toHaveTextContent("Search");
		expect(screen.getByRole("button", { name: "search result" })).toHaveTextContent(
			"Notebook Search Result",
		);
	});

	it("renders extension text", () => {
		const { container } = render(LinkItem, {
			props: {
				title: "diagram",
				ariaLabel: "diagram",
				interactionId: "item:file:notes/diagram.canvas",
				interactionKind: "item",
				settings: DEFAULT_SETTINGS,
				extension: "canvas",
			},
		});

		expect(
			container.querySelector(".cosense-card-links__box-extension"),
		).toHaveTextContent("canvas");
	});

	it("makes card body draggable", () => {
		const { container } = render(LinkItem, {
			props: {
				title: "Alpha",
				ariaLabel: "alpha",
				interactionId: "item:file:notes/alpha.md",
				interactionKind: "item",
				settings: DEFAULT_SETTINGS,
			},
		});

		const card = container.querySelector<HTMLElement>(".cosense-card-links__box");

		expect(card).toHaveAttribute("draggable", "true");
	});

	it("does not make card body draggable when draggable is disabled", () => {
		const { container } = render(LinkItem, {
			props: {
				title: "Alpha",
				ariaLabel: "alpha",
				interactionId: "item:file:notes/alpha.md",
				interactionKind: "item",
				settings: DEFAULT_SETTINGS,
				draggable: false,
			},
		});

		expect(container.querySelector(".cosense-card-links__box")).toHaveAttribute(
			"draggable",
			"false",
		);
	});
});
