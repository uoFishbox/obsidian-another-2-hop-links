import { describe, expect, test } from "vitest";
import {
	buildProtectedSegmentToken,
	createProtectedSegmentRestorer,
	restoreProtectedSegments,
} from "../protectedHtml";

describe("protected HTML restoration", () => {
	test("restores generated tokens by index", () => {
		const firstToken = buildProtectedSegmentToken(0);
		const secondToken = buildProtectedSegmentToken(1);
		const segments = [
			{ token: firstToken, html: "<code>first</code>" },
			{ token: secondToken, html: "<code>second</code>" },
		];

		expect(restoreProtectedSegments(`${secondToken}:${firstToken}`, segments)).toBe(
			"<code>second</code>:<code>first</code>",
		);
	});

	test("restorer can be reused and preserves unknown tokens", () => {
		const token = buildProtectedSegmentToken(0);
		const unknownToken = buildProtectedSegmentToken(1);
		const restore = createProtectedSegmentRestorer([
			{ token, html: "<span>known</span>" },
		]);

		expect(restore(`${token}:${unknownToken}`)).toBe(
			`<span>known</span>:${unknownToken}`,
		);
		expect(restore(token)).toBe("<span>known</span>");
	});
});
