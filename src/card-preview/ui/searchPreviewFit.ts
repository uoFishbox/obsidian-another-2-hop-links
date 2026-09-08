import { createCaseInsensitiveRegExp } from "card-preview/text/searchUtils";

/** Fits a search match inside a mounted preview; dispose before detaching its host. */
export function observeSearchPreviewFit(host: HTMLElement, query: string): () => void {
	const view = host.ownerDocument.defaultView;
	if (!view || !host.querySelector(".ccl-search-highlight")) return () => {};
	let body = host.querySelector<HTMLElement>(":scope > .ccl-search-preview-body");
	if (!body) {
		body = host.ownerDocument.createElement("div");
		body.className = "ccl-search-preview-body";
		while (host.firstChild) body.appendChild(host.firstChild);
		host.appendChild(body);
	}
	const content = body;
	host.classList.add("ccl-search-preview");
	const range = findMatchRange(content, query);
	let frame: number | undefined;
	let disposed = false;

	function fit(): void {
		frame = undefined;
		if (disposed || !host.isConnected || !range) return;
		const bounds = host.getBoundingClientRect();
		const style = view!.getComputedStyle(host);
		const height =
			bounds.height -
			parseFloat(style.paddingTop || "0") -
			parseFloat(style.paddingBottom || "0");
		if (bounds.width <= 0 || height <= 0) return;
		const rects = Array.from(range.getClientRects()).filter(
			(rect) => rect.height > 0,
		);
		if (!rects.length) return;
		// Both rectangles include the old translation, so their difference remains
		// stable across resize callbacks without resetting styles and forcing layout.
		const origin = content.getBoundingClientRect().top;
		const start = Math.min(...rects.map((rect) => rect.top)) - origin;
		const end = Math.max(...rects.map((rect) => rect.bottom)) - origin;
		const offset = Math.max(0, Math.min(start, end - height));
		content.style.transform = `translateY(${-offset}px)`;
		host.classList.toggle("ccl-search-preview-truncated", end - start > height);
	}

	function schedule(): void {
		if (disposed || frame !== undefined) return;
		frame = view!.requestAnimationFrame(fit);
	}

	const observer = new view.ResizeObserver(schedule);
	observer.observe(host);
	observer.observe(content);
	host.ownerDocument.fonts?.addEventListener("loadingdone", schedule);
	schedule();
	return (): void => {
		disposed = true;
		observer.disconnect();
		if (frame !== undefined) view.cancelAnimationFrame(frame);
		host.ownerDocument.fonts?.removeEventListener("loadingdone", schedule);
		content.style.removeProperty("transform");
		host.classList.remove("ccl-search-preview", "ccl-search-preview-truncated");
	};
}

function findMatchRange(content: HTMLElement, query: string): Range | undefined {
	const match = createCaseInsensitiveRegExp(query)?.exec(content.textContent ?? "");
	if (!match) return undefined;
	const range = content.ownerDocument.createRange();
	const walker = content.ownerDocument.createTreeWalker(content, 4 /* SHOW_TEXT */);
	const end = match.index + match[0].length;
	let offset = 0;
	let started = false;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const length = node.textContent?.length ?? 0;
		if (!started && offset + length > match.index) {
			range.setStart(node, match.index - offset);
			started = true;
		}
		if (started && offset + length >= end) {
			range.setEnd(node, end - offset);
			return range;
		}
		offset += length;
	}
	return undefined;
}
