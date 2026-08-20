import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import Icon from "../Icon.svelte";

describe("Icon", () => {
	afterEach(cleanup);

	it("renders structured SVG data with controlled presentation props", () => {
		const view = render(Icon, {
			props: {
				name: "Link",
				width: 24,
				height: 20,
				class: "test-icon",
			},
		});
		const icon = view.container.querySelector("svg");

		expect(icon).toHaveAttribute("width", "24");
		expect(icon).toHaveAttribute("height", "20");
		expect(icon).toHaveClass("test-icon");
		expect(icon).toHaveAttribute("aria-hidden", "true");
		expect(icon?.querySelectorAll("path")).toHaveLength(2);
	});
});
