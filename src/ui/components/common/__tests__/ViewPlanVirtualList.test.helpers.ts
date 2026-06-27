import { screen as domScreen, within } from "@testing-library/svelte";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import {
	setElementRect,
	setNumericProperty,
	triggerResize,
} from "testing/helpers/DOMObserverMock";
import {
	queryAllByTestIdDeep,
	queryAllByTextDeep,
} from "testing/helpers/shadowDomQueries";

export interface HarnessSection {
	key: string;
	label?: string;
	revision?: number;
}

function withItemsState<T, G>(
	descriptor: SectionRenderDescriptor<T, G>,
): SectionRenderDescriptor<T, G> {
	return descriptor;
}

export type TextMatcher = Parameters<typeof domScreen.queryAllByText>[0];

export { queryAllByTestIdDeep, queryAllByTextDeep };

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
