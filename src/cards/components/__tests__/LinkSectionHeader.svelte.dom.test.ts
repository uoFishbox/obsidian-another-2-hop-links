import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import LinkSectionHeaderHarness from "./LinkSectionHeaderHarness.svelte";

describe("LinkSectionHeader", () => {
	afterEach(() => cleanup());

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
