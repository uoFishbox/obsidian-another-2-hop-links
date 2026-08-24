import { describe, expect, it } from "vitest";
import { getArrowNavigationDirection } from "../keyboardNavigation";

describe("VirtualSurfaceKeyboard", () => {
	it("maps arrow keys to result navigation directions", () => {
		expect(getArrowNavigationDirection("ArrowDown")).toBe("down");
		expect(getArrowNavigationDirection("ArrowUp")).toBe("up");
		expect(getArrowNavigationDirection("ArrowLeft")).toBe("left");
		expect(getArrowNavigationDirection("ArrowRight")).toBe("right");
		expect(getArrowNavigationDirection("Enter")).toBeNull();
	});
});
