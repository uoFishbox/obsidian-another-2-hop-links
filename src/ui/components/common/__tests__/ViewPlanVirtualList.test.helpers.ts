import { screen as domScreen, within } from "@testing-library/svelte";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import {
	setElementRect,
	setNumericProperty,
	triggerResize,
} from "testing/helpers/DOMObserverMock";

export interface HarnessSection {
	key: string;
	label?: string;
	revision?: number;
}

export function withItemsState<T, G>(
	descriptor: SectionRenderDescriptor<T, G>,
): SectionRenderDescriptor<T, G> {
	return descriptor;
}

export type TextMatcher = Parameters<typeof domScreen.queryAllByText>[0];

export function collectOpenShadowRoots(root: ParentNode = document.body): ShadowRoot[] {
	const shadowRoots: ShadowRoot[] = [];

	for (const element of Array.from(root.querySelectorAll("*"))) {
		if (!(element instanceof HTMLElement) || !element.shadowRoot) {
			continue;
		}

		shadowRoots.push(element.shadowRoot);
		shadowRoots.push(...collectOpenShadowRoots(element.shadowRoot));
	}

	return shadowRoots;
}

export function queryAllByTestIdDeep(testId: string): HTMLElement[] {
	const seen = new Set<HTMLElement>();
	const results: HTMLElement[] = [];
	for (const element of domScreen.queryAllByTestId(testId)) {
		if (!seen.has(element)) {
			seen.add(element);
			results.push(element);
		}
	}

	for (const shadowRoot of collectOpenShadowRoots()) {
		for (const element of within(
			shadowRoot as unknown as HTMLElement,
		).queryAllByTestId(testId)) {
			if (!seen.has(element)) {
				seen.add(element);
				results.push(element);
			}
		}
	}

	return results;
}

export function queryAllByTextDeep(text: TextMatcher): HTMLElement[] {
	const seen = new Set<HTMLElement>();
	const results: HTMLElement[] = [];
	for (const element of domScreen.queryAllByText(text)) {
		if (!seen.has(element)) {
			seen.add(element);
			results.push(element);
		}
	}

	for (const shadowRoot of collectOpenShadowRoots()) {
		for (const element of within(
			shadowRoot as unknown as HTMLElement,
		).queryAllByText(text)) {
			if (!seen.has(element)) {
				seen.add(element);
				results.push(element);
			}
		}
	}

	return results;
}

export function getSingleMatch<T extends HTMLElement>(
	elements: T[],
	description: string,
): T {
	if (elements.length === 1) {
		return elements[0];
	}

	if (elements.length === 0) {
		throw new Error(`Unable to find an element by: ${description}`);
	}

	throw new Error(`Found multiple elements by: ${description}`);
}

export function expectFindOne<T>(
	items: T[] | undefined,
	predicate: (item: T) => boolean,
	description: string,
): T {
	const found = items?.find(predicate);
	expect(found).toBeDefined();
	return found!;
}

export function expectFocused(element: HTMLElement): void {
	const rootNode = element.getRootNode();
	if (rootNode instanceof ShadowRoot) {
		expect(rootNode.activeElement).toBe(element);
		return;
	}

	expect(element).toHaveFocus();
}

export function createDeepScreen() {
	return {
		...domScreen,
		getAllByTestId(testId: string): HTMLElement[] {
			const elements = queryAllByTestIdDeep(testId);
			if (elements.length === 0) {
				throw new Error(
					`Unable to find an element by: [data-testid="${testId}"]`,
				);
			}
			return elements;
		},
		queryAllByTestId(testId: string): HTMLElement[] {
			return queryAllByTestIdDeep(testId);
		},
		getByTestId(testId: string): HTMLElement {
			return getSingleMatch(
				queryAllByTestIdDeep(testId),
				`[data-testid="${testId}"]`,
			);
		},
		queryByTestId(testId: string): HTMLElement | null {
			const elements = queryAllByTestIdDeep(testId);
			return elements.length > 0 ? elements[0] : null;
		},
		getByText(text: TextMatcher): HTMLElement {
			return getSingleMatch(queryAllByTextDeep(text), `text: ${String(text)}`);
		},
		queryByText(text: TextMatcher): HTMLElement | null {
			const elements = queryAllByTextDeep(text);
			return elements.length > 0 ? elements[0] : null;
		},
	};
}

export function createSections(
	sectionCount: number,
	itemsPerSection: number,
): SectionRenderDescriptor<string, HarnessSection>[] {
	return Array.from({ length: sectionCount }, (_, sectionIndex) => {
		const sectionKey = `section-${sectionIndex}`;
		const items = Array.from(
			{ length: itemsPerSection },
			(_, itemIndex) => `${sectionKey}-item-${itemIndex}`,
		);
		return withItemsState({
			section: { key: sectionKey },
			sectionKey,
			title: `Section ${sectionIndex}`,
			sectionId: `section-${sectionIndex}`,
			totalCount: itemsPerSection,
			loadedCount: itemsPerSection,
			getItems: () => items,
			headerProps: {},
		});
	});
}

export function createSpiedSections(
	sectionCount: number,
	itemsPerSection: number,
): SectionRenderDescriptor<string, HarnessSection>[] {
	return Array.from({ length: sectionCount }, (_, sectionIndex) => {
		const sectionKey = `section-${sectionIndex}`;
		const items = Array.from(
			{ length: itemsPerSection },
			(_, itemIndex) => `${sectionKey}-item-${itemIndex}`,
		);
		return withItemsState({
			section: { key: sectionKey },
			sectionKey,
			title: `Section ${sectionIndex}`,
			sectionId: `section-${sectionIndex}`,
			totalCount: itemsPerSection,
			loadedCount: itemsPerSection,
			getItems: vi.fn(() => items),
			headerProps: {},
		});
	});
}

export function createTrackedSections(
	sectionCount: number,
	itemsPerSection: number,
): {
	sections: SectionRenderDescriptor<string, HarnessSection>[];
	getIndexedAccessCount: () => number;
	resetIndexedAccessCount: () => void;
} {
	const sections = createSections(sectionCount, itemsPerSection);
	let indexedAccessCount = 0;
	const trackedSections = new Proxy(sections, {
		get(target, property, receiver) {
			if (typeof property === "string" && /^\d+$/.test(property)) {
				indexedAccessCount += 1;
			}

			return Reflect.get(target, property, receiver);
		},
	});

	return {
		sections: trackedSections as SectionRenderDescriptor<string, HarnessSection>[],
		getIndexedAccessCount: () => indexedAccessCount,
		resetIndexedAccessCount: () => {
			indexedAccessCount = 0;
		},
	};
}

export function prepareVirtualListLayout(
	container: HTMLElement,
	options: {
		rootHeight: number;
		width: number;
		sectionTop?: number;
		scrollTop?: number;
	},
): {
	scrollRoot: HTMLElement;
	virtualList: HTMLElement;
} {
	const scrollRoot = container.querySelector<HTMLElement>(
		"[data-testid='scroll-root']",
	);
	const virtualList = container.querySelector<HTMLElement>(".view-plan-virtual-list");

	if (!scrollRoot || !virtualList) {
		throw new Error("Required elements not found");
	}

	const sectionTop = options.sectionTop ?? 0;
	setNumericProperty(scrollRoot, "clientHeight", options.rootHeight);
	setNumericProperty(scrollRoot, "scrollTop", options.scrollTop ?? 0);
	scrollRoot.style.overflow = "auto";
	setElementRect(scrollRoot, {
		top: 0,
		width: options.width,
		height: options.rootHeight,
	});
	setElementRect(virtualList, {
		top: sectionTop,
		width: options.width,
		height: 4000,
	});
	virtualList.style.setProperty("--ccl-box-size", "100px");
	virtualList.style.setProperty("--ccl-box-height", "120px");
	virtualList.style.setProperty("--ccl-box-gap", "10px");
	virtualList.style.setProperty("--ccl-box-cols-max", "4");
	virtualList.style.setProperty("--ccl-section-margin-bottom", "45px");
	triggerResize(virtualList, options.width, 4000);
	triggerResize(scrollRoot, options.width, options.rootHeight);

	return {
		scrollRoot,
		virtualList,
	};
}
