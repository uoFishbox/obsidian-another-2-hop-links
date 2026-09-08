import { afterEach, describe, expect, it, vi } from "vitest";
import { observeSearchPreviewFit } from "../searchPreviewFit";

describe("search preview fitting", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.replaceChildren();
	});

	it("fits a match across text nodes and refits after resizing without accumulating offsets", () => {
		let resize: ResizeObserverCallback = () => {};
		const disconnect = vi.fn();
		vi.spyOn(window, "ResizeObserver").mockImplementation(function (callback) {
			resize = callback;
			return { observe: vi.fn(), unobserve: vi.fn(), disconnect };
		});
		let frame: FrameRequestCallback = () => {};
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frame = callback;
			return 1;
		});
		const host = document.createElement("div");
		host.innerHTML =
			'before <span class="ccl-search-highlight">tar</span><b><span class="ccl-search-highlight">get</span></b> after';
		document.body.appendChild(host);
		let height = 60;
		vi.spyOn(host, "getBoundingClientRect").mockImplementation(
			() => new DOMRect(0, 0, 140, height),
		);
		let selected = "";
		Object.defineProperty(Range.prototype, "getClientRects", {
			configurable: true,
			value: function (this: Range) {
				selected = this.toString();
				return [new DOMRect(0, 90, 30, 16), new DOMRect(0, 106, 30, 16)];
			},
		});
		const stop = observeSearchPreviewFit(host, "target");
		const body = host.firstElementChild as HTMLElement;
		vi.spyOn(body, "getBoundingClientRect").mockReturnValue(
			new DOMRect(0, 0, 140, 200),
		);
		frame(0);
		expect(selected).toBe("target");
		expect(body.style.transform).toBe("translateY(-62px)");
		height = 120;
		resize([], {} as ResizeObserver);
		frame(0);
		expect(body.style.transform).toBe("translateY(-2px)");
		height = 16;
		resize([], {} as ResizeObserver);
		frame(0);
		expect(body.style.transform).toBe("translateY(-90px)");
		expect(host.classList.contains("ccl-search-preview-truncated")).toBe(true);
		stop();
		expect(disconnect).toHaveBeenCalledOnce();
		expect(body.style.transform).toBe("");
		expect(host.classList.contains("ccl-search-preview")).toBe(false);
		delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
	});
});
