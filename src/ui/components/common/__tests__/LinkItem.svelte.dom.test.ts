import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import LinkItem from "../LinkItem.svelte";

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
				draggable: false,
			},
		});

		expect(container.querySelector(".cosense-card-links__box")).toHaveAttribute(
			"draggable",
			"false",
		);
	});

	it("reuses a non-interactive shell root when interaction is enabled", async () => {
		const baseProps = {
			title: "",
			ariaLabel: "",
			interactionId: "item:file:notes/alpha.md",
			interactionKind: "item" as const,
			className: "twohop-card-shell is-skeleton",
		};
		const { container, rerender } = render(LinkItem, {
			props: {
				...baseProps,
				interactive: false,
			},
		});
		const card = container.querySelector<HTMLElement>(
			".cosense-card-links__box",
		);

		expect(card).toHaveAttribute("aria-hidden", "true");
		expect(card).not.toHaveAttribute("role");
		expect(card).not.toHaveAttribute("tabindex");
		expect(card).not.toHaveAttribute("data-ccl-interaction-id");
		expect(card).toHaveAttribute("draggable", "false");

		await rerender({
			...baseProps,
			title: "Alpha",
			ariaLabel: "alpha",
			className: "",
			interactive: true,
		});

		expect(container.querySelector(".cosense-card-links__box")).toBe(card);
		expect(card).not.toHaveAttribute("aria-hidden");
		expect(card).toHaveAttribute("role", "button");
		expect(card).toHaveAttribute("tabindex", "0");
		expect(card).toHaveAttribute(
			"data-ccl-interaction-id",
			"item:file:notes/alpha.md",
		);
		expect(card).toHaveAttribute("draggable", "true");
	});

	it("commits section and resolution presentation on the reused card root", async () => {
		const baseProps = {
			title: "Alpha",
			ariaLabel: "alpha",
			interactionId: "item:new-link:alpha",
			interactionKind: "item" as const,
		};
		const { container, rerender } = render(LinkItem, {
			props: {
				...baseProps,
				presentation: {
					sectionVariant: "new-links" as const,
					resolution: "missing" as const,
					attachment: false,
					extension: null,
				},
			},
		});
		const card = container.querySelector<HTMLElement>(".cosense-card-links__box");

		expect(card).toHaveAttribute("data-ccl-section-variant", "new-links");
		expect(card).toHaveAttribute("data-ccl-resolution", "missing");

		await rerender({
			...baseProps,
			interactionId: "item:file:alpha",
			presentation: {
				sectionVariant: "backlinks",
				resolution: "resolved",
				attachment: false,
				extension: null,
			},
		});

		expect(container.querySelector(".cosense-card-links__box")).toBe(card);
		expect(card).toHaveAttribute("data-ccl-section-variant", "backlinks");
		expect(card).toHaveAttribute("data-ccl-resolution", "resolved");
	});
});
