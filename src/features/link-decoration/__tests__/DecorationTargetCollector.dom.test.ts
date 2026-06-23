import { beforeEach, describe, expect, it } from "vitest";
import { collectDecorationTargets } from "../decorationTargetCollector";

function classNames(elements: HTMLElement[] | null): string[] {
	if (elements === null) {
		return [];
	}
	return elements.map((el) => el.className.trim());
}

describe("collectDecorationTargets", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("returns null (self-only) for rendered mode without selectors", () => {
		document.body.innerHTML = `
			<a class="internal-link" data-href="missing.md">
				<span class="label">Missing</span>
			</a>
		`;
		const linkEl = document.querySelector<HTMLElement>(".internal-link");

		const targets = collectDecorationTargets(linkEl!, { mode: "rendered" });

		expect(targets).toBeNull();
	});

	it("returns null (self-only) for bases mode without selectors", () => {
		document.body.innerHTML = `
			<div class="internal-link" data-path="missing.md">
				<span class="label">Missing</span>
			</div>
		`;
		const linkEl = document.querySelector<HTMLElement>(".internal-link");

		const targets = collectDecorationTargets(linkEl!, { mode: "bases" });

		expect(targets).toBeNull();
	});

	it("collects alias-related CodeMirror targets", () => {
		document.body.innerHTML = `
			<div class="cm-content">
				<span class="cm-hmd-internal-link cm-link-has-alias">
					<span class="internal-link" data-href="missing.md">Missing</span>
				</span>
				<span class="cm-link-alias-pipe">|</span>
				<span class="cm-link-alias">Alias</span>
			</div>
		`;
		const linkEl = document.querySelector<HTMLElement>(".internal-link");

		const targets = collectDecorationTargets(linkEl!, {
			mode: "codemirror",
		});

		expect(classNames(targets)).toEqual([
			"internal-link",
			"cm-hmd-internal-link cm-link-has-alias",
			"cm-link-alias-pipe",
			"cm-link-alias",
		]);
	});

	it("collects property pill parent and selected descendants", () => {
		document.body.innerHTML = `
			<div class="multi-select-pill internal-link">
				<div class="multi-select-pill-content internal-link" data-href="missing.md">
					<span class="label">Missing</span>
				</div>
			</div>
		`;
		const linkEl = document.querySelector<HTMLElement>(
			".multi-select-pill-content",
		);

		const targets = collectDecorationTargets(linkEl!, {
			mode: "properties",
			targetSelectors: [".label"],
		});

		expect(classNames(targets)).toEqual([
			"multi-select-pill-content internal-link",
			"label",
			"multi-select-pill internal-link",
		]);
	});
});
