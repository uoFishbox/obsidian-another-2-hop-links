import { describe, expect, test } from "vitest";
import { hasSourceDependentRawLinkPath } from "../link-resolution/sourceDependentLinks";

describe("hasSourceDependentRawLinkPath", () => {
	test.each([
		".",
		"..",
		"./peer",
		"../peer",
		".\\peer",
		"..\\peer",
		"folder/./peer",
		"folder\\..\\peer",
	])("detects source-dependent path %s", (rawLinkPath) => {
		expect(hasSourceDependentRawLinkPath(rawLinkPath)).toBe(true);
	});

	test.each(["peer", "folder/peer", "folder\\peer", ".../peer"])(
		"does not flag source-independent path %s",
		(rawLinkPath) => {
			expect(hasSourceDependentRawLinkPath(rawLinkPath)).toBe(false);
		},
	);
});
