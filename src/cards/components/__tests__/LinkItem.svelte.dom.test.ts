import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import LinkItem from "../LinkItem.svelte";
import type { InteractionHandle } from "cards/interactions/interactionTypes";

vi.mock("obsidian", () => ({
	Platform: {
		isMobile: false,
	},
	TFile: class {},
}));

const handle = (value: string): InteractionHandle => value as InteractionHandle;

describe("LinkItem", () => {
	it("renders title as plain text when search query is empty", () => {
		const { container } = render(LinkItem, {
			props: {
				title: "Target Note <Beta>",
				ariaLabel: "target-note-card",
				interactionHandle: handle("token-plain-card"),
				searchQuery: "",
			},
		});

		const title = container.querySelector(".cosense-card-links__box-title");
		expect(title).not.toBeNull();
		expect(title?.querySelector(".ccl-search-highlight")).toBeNull();
		expect(title).toHaveTextContent("Target Note <Beta>");
		expect(title?.innerHTML).not.toContain("ccl-search-highlight");
	});

	it("highlights matching parts of title in HTML when searching", () => {
		const { container } = render(LinkItem, {
			props: {
				title: "Notebook Search Result",
				ariaLabel: "search result",
				interactionHandle: handle("item:file:notes/search.md"),
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
				interactionHandle: handle("item:file:notes/diagram.canvas"),
				extension: "canvas",
			},
		});

		expect(
			container.querySelector(".cosense-card-links__box-extension"),
		).toHaveTextContent("canvas");

		const title = container.querySelector(".cosense-card-links__box-title");
		expect(title).toHaveClass("has-file-icon");
		expect(title?.children).toHaveLength(1);
		expect(title?.children[0]).toHaveClass("cosense-card-links__file-icon");
	});

	it("makes card body draggable", () => {
		const { container } = render(LinkItem, {
			props: {
				title: "Draggable Target",
				ariaLabel: "draggable-target-card",
				interactionHandle: handle("token-draggable-card"),
			},
		});

		const card = container.querySelector<HTMLElement>(".cosense-card-links__box");

		expect(card).toHaveAttribute("draggable", "true");
	});

	it("does not make card body draggable when draggable is disabled", () => {
		const { container } = render(LinkItem, {
			props: {
				title: "Disabled Target",
				ariaLabel: "disabled-target-card",
				interactionHandle: handle("token-disabled-card"),
				draggable: false,
			},
		});

		expect(container.querySelector(".cosense-card-links__box")).not.toHaveAttribute(
			"draggable",
		);
	});

	it("reuses a non-interactive shell root when interaction is enabled", async () => {
		const baseProps = {
			title: "",
			ariaLabel: "",
			interactionHandle: handle("token-reusable-card"),
			className: "twohop-card-shell is-skeleton",
		};
		const { container, rerender } = render(LinkItem, {
			props: {
				...baseProps,
				interactive: false,
			},
		});
		const card = container.querySelector<HTMLElement>(".cosense-card-links__box");

		expect(card).toHaveAttribute("aria-hidden", "true");
		expect(card).not.toHaveAttribute("role");
		expect(card).not.toHaveAttribute("tabindex");
		expect(card).not.toHaveAttribute("data-ccl-interaction-handle");
		expect(card).not.toHaveAttribute("draggable");

		await rerender({
			...baseProps,
			title: "Visible Target Note",
			ariaLabel: "visible-target-card",
			className: "",
			interactive: true,
		});

		expect(container.querySelector(".cosense-card-links__box")).toBe(card);
		expect(card).not.toHaveAttribute("aria-hidden");
		expect(card).toHaveAttribute("role", "button");
		expect(card).toHaveAttribute("tabindex", "0");
		expect(card).toHaveAttribute(
			"data-ccl-interaction-handle",
			"token-reusable-card",
		);
		expect(card).toHaveAttribute("draggable", "true");
	});

	it("keeps class state while omitting redundant card metadata", () => {
		const { container } = render(LinkItem, {
			props: {
				title: "Missing PDF",
				ariaLabel: "missing PDF",
				interactionHandle: handle("item:new-link:missing-pdf"),
				className: "cosense-card-links__box--missing",
				extension: "pdf",
			},
		});
		const card = container.querySelector<HTMLElement>(".cosense-card-links__box");

		expect(card).toHaveClass("cosense-card-links__box--missing");
		expect(card).toHaveClass("is-attachment");
		for (const attribute of [
			"data-ccl-interaction-kind",
			"data-directory",
			"data-ccl-section-variant",
			"data-ccl-resolution",
			"data-ccl-attachment",
			"data-ccl-extension",
		]) {
			expect(card).not.toHaveAttribute(attribute);
		}
	});
});
