import { screen as domScreen, within } from "@testing-library/svelte";

export type TextMatcher = Parameters<typeof domScreen.queryAllByText>[0];
export type RoleMatcher = Parameters<typeof domScreen.queryAllByRole>[0];
export type ByRoleOptions = Parameters<typeof domScreen.queryAllByRole>[1];

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

export function queryAllByRoleDeep(
	role: RoleMatcher,
	options?: ByRoleOptions,
): HTMLElement[] {
	const seen = new Set<HTMLElement>();
	const results: HTMLElement[] = [];

	for (const element of domScreen.queryAllByRole(role, options)) {
		if (!seen.has(element)) {
			seen.add(element);
			results.push(element);
		}
	}

	for (const shadowRoot of collectOpenShadowRoots()) {
		for (const element of within(
			shadowRoot as unknown as HTMLElement,
		).queryAllByRole(role, options)) {
			if (!seen.has(element)) {
				seen.add(element);
				results.push(element);
			}
		}
	}

	return results;
}
