import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import {
	createItems,
	setupVirtualGridTestEnvironment,
} from "./virtualGridListTestDriver";
import {
	flushFrames,
	setElementRect,
	setNumericProperty,
	triggerResize,
} from "testing/helpers/DOMObserverMock";
import VirtualGridLinkListRenderProbeHarness from "./VirtualGridLinkListRenderProbeHarness.svelte";

setupVirtualGridTestEnvironment();

function getRequiredElement<T extends HTMLElement>(
	container: HTMLElement,
	selector: string,
): T {
	const element = container.querySelector<T>(selector);
	if (!element) {
		throw new Error(`Missing test element: ${selector}`);
	}
	return element;
}

async function setViewport(
	container: HTMLElement,
	options: { rootHeight: number; width: number; scrollTop?: number },
): Promise<void> {
	const scrollRoot = getRequiredElement<HTMLElement>(
		container,
		"[data-testid='scroll-root']",
	);
	const gridRoot = getRequiredElement<HTMLElement>(
		container,
		".cosense-card-links__virtual-grid",
	);

	setNumericProperty(scrollRoot, "clientHeight", options.rootHeight);
	setNumericProperty(scrollRoot, "scrollTop", options.scrollTop ?? 0);
	scrollRoot.style.overflow = "auto";
	setElementRect(scrollRoot, {
		top: 0,
		width: options.width,
		height: options.rootHeight,
	});
	gridRoot.style.setProperty("--ccl-box-size", "100px");
	gridRoot.style.setProperty("--ccl-box-height", "120px");
	gridRoot.style.setProperty("--ccl-box-gap", "10px");
	gridRoot.style.setProperty("--ccl-box-cols-max", "4");
	setElementRect(gridRoot, {
		top: 0,
		width: options.width,
		height: 2000,
	});
	triggerResize(gridRoot, options.width, 2000);
	triggerResize(scrollRoot, options.width, options.rootHeight);
	await flushFrames();
}

async function scrollGrid(
	container: HTMLElement,
	options: { scrollTop: number; sectionTop: number },
): Promise<void> {
	const scrollRoot = getRequiredElement<HTMLElement>(
		container,
		"[data-testid='scroll-root']",
	);
	const gridRoot = getRequiredElement<HTMLElement>(
		container,
		".cosense-card-links__virtual-grid",
	);

	setNumericProperty(scrollRoot, "scrollTop", options.scrollTop);
	setElementRect(gridRoot, {
		top: options.sectionTop,
		width: gridRoot.getBoundingClientRect().width,
		height: 2000,
	});
	await fireEvent.scroll(scrollRoot);
	await flushFrames();
}

function getFirstSlotProbe(container: HTMLElement): HTMLElement | null {
	const gridRoot = container.querySelector<HTMLElement>(
		".cosense-card-links__virtual-grid",
	);
	return (
		gridRoot?.shadowRoot?.querySelector<HTMLElement>(
			"[data-ccl-cell-slot='0'] [data-testid='probe-item-cell']",
		) ?? null
	);
}

describe("VirtualGridLinkList body remount policy", () => {
	it("remounts a grid-row body by default when a physical slot receives another logical item", async () => {
		const mountedItems: string[] = [];
		const { container } = render(VirtualGridLinkListRenderProbeHarness, {
			props: {
				items: createItems(30),
				initialVisibleCount: 30,
				onItemMount: (id: string) => mountedItems.push(id),
			},
		});

		await setViewport(container, { rootHeight: 120, width: 330 });
		await waitFor(() => {
			expect(getFirstSlotProbe(container)?.textContent).toBe("Item 0");
		});

		mountedItems.length = 0;
		await scrollGrid(container, {
			scrollTop: 804,
			sectionTop: -804,
		});

		await waitFor(() => {
			expect(getFirstSlotProbe(container)?.textContent).not.toBe("Item 0");
		});
		const firstSlotProbe = getFirstSlotProbe(container);
		const firstSlotProbeId = `${firstSlotProbe?.dataset.index}-${firstSlotProbe?.textContent}`;
		expect(mountedItems.length).toBeGreaterThan(0);
		expect(mountedItems).toContain(firstSlotProbeId);
	});

	it("can reuse a grid-row body when a physical slot receives another logical item", async () => {
		const mountedItems: string[] = [];
		const updatedItems: string[] = [];
		const { container } = render(VirtualGridLinkListRenderProbeHarness, {
			props: {
				items: createItems(30),
				initialVisibleCount: 30,
				remountCellBodyOnKeyChange: false,
				onItemMount: (id: string) => mountedItems.push(id),
				onItemUpdate: (id: string) => updatedItems.push(id),
			},
		});

		await setViewport(container, { rootHeight: 120, width: 330 });
		await waitFor(() => {
			expect(getFirstSlotProbe(container)?.textContent).toBe("Item 0");
		});

		mountedItems.length = 0;
		updatedItems.length = 0;
		await scrollGrid(container, {
			scrollTop: 804,
			sectionTop: -804,
		});

		await waitFor(() => {
			expect(getFirstSlotProbe(container)?.textContent).not.toBe("Item 0");
		});
		const firstSlotProbe = getFirstSlotProbe(container);
		const firstSlotProbeId = `${firstSlotProbe?.dataset.index}-${firstSlotProbe?.textContent}`;
		expect(mountedItems).not.toContain(firstSlotProbeId);
		expect(updatedItems).toContain(firstSlotProbeId);
		expect(updatedItems.length).toBeGreaterThan(0);
	});

	it("remounts a physical-slot body when the item binding topology changes", async () => {
		const mountedItems: string[] = [];
		const items = createItems(2);
		const onItemMount = (id: string) => mountedItems.push(id);
		const rendered = render(VirtualGridLinkListRenderProbeHarness, {
			props: {
				items,
				initialVisibleCount: 2,
				remountCellBodyOnKeyChange: false,
				onItemMount,
			},
		});

		await setViewport(rendered.container, { rootHeight: 120, width: 330 });
		await waitFor(() => {
			expect(getFirstSlotProbe(rendered.container)?.textContent).toBe("Item 0");
		});
		const firstSlotProbeBefore = getFirstSlotProbe(rendered.container);
		expect(firstSlotProbeBefore).not.toBeNull();

		mountedItems.length = 0;
		await rendered.rerender({
			items: [items[1]!],
			initialVisibleCount: 2,
			remountCellBodyOnKeyChange: false,
			onItemMount,
		});
		await flushFrames();

		await waitFor(() => {
			expect(getFirstSlotProbe(rendered.container)?.textContent).toBe("Item 1");
		});
		const firstSlotProbeAfter = getFirstSlotProbe(rendered.container);
		expect(firstSlotProbeAfter).not.toBe(firstSlotProbeBefore);
		expect(mountedItems).toContain("0-Item 1");
	});
});
