import { describe, expect, it, vi } from "vitest";
import { markdownPostProcessor } from "../markdownHandlers";

function createMockElement(innerTextValue: string) {
	const el = document.createElement("div");
	const innerText = vi.fn(() => innerTextValue);
	Object.defineProperty(el, "innerText", {
		get: innerText,
		configurable: true,
	});
	return { el, innerText };
}

function createPostProcessorDependencies() {
	return {
		ctx: {
			sourcePath: "notes/private.md",
		} as any,
		indexingService: {
			awaitIdle: vi.fn().mockResolvedValue(undefined),
		},
		stylingService: {
			decorateLinksInContainer: vi.fn(),
		},
		markdownRenderManager: {
			registerElement: vi.fn(),
		},
	};
}

function runPostProcessor(
	el: HTMLElement,
	deps: ReturnType<typeof createPostProcessorDependencies>,
) {
	return markdownPostProcessor(
		el,
		deps.ctx,
		{} as any,
		deps.indexingService as any,
		deps.stylingService as any,
		deps.markdownRenderManager as any,
	);
}

function assertCoreEffects(
	el: HTMLElement,
	deps: ReturnType<typeof createPostProcessorDependencies>,
) {
	expect(deps.markdownRenderManager.registerElement).toHaveBeenCalledWith(
		"notes/private.md",
		el,
		deps.ctx,
	);
	expect(deps.indexingService.awaitIdle).toHaveBeenCalledTimes(1);
	expect(deps.stylingService.decorateLinksInContainer).toHaveBeenCalledWith(
		el,
		"notes/private.md",
	);
}

describe("markdownPostProcessor", () => {
	it("registers, waits for indexing, and decorates without reading text", async () => {
		const { el, innerText } = createMockElement("private note body");
		const deps = createPostProcessorDependencies();

		await runPostProcessor(el, deps);

		expect(innerText).not.toHaveBeenCalled();
		assertCoreEffects(el, deps);
	});
});
