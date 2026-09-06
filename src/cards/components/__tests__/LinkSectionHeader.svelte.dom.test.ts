import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import LinkSectionHeaderHarness from "./LinkSectionHeaderHarness.svelte";

describe("LinkSectionHeader", () => {
	afterEach(() => cleanup());

	it("is not a sequential focus target", () => {
		const view = render(LinkSectionHeaderHarness, {
			props: { sectionVariant: "backlinks" },
		});
		const header = view.container.querySelector<HTMLElement>(
			".cosense-card-links__connected-links-header",
		);

		expect(header).not.toHaveAttribute("tabindex");
		expect(header).not.toHaveAttribute("role", "button");
		expect(header?.tabIndex).toBe(-1);
	});

	it("replaces the section variant on a reused header root", async () => {
		const view = render(LinkSectionHeaderHarness, {
			props: { sectionVariant: "new-links" },
		});
		const header = view.container.querySelector<HTMLElement>(
			".cosense-card-links__connected-links-header",
		);

		expect(header).toHaveAttribute("data-ccl-section-variant", "new-links");

		await view.rerender({ sectionVariant: "backlinks" });

		expect(
			view.container.querySelector(".cosense-card-links__connected-links-header"),
		).toBe(header);
		expect(header).toHaveAttribute("data-ccl-section-variant", "backlinks");
	});
});
