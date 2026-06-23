import { describe, expect, it, vi } from "vitest";
import { createStylingService } from "../stylingService";
import { UNRESOLVED_LINK_ATTRIBUTE } from "../../../appConstants";

type LinkStatusServiceLike = {
	extractHref: (el: HTMLElement) => string | undefined;
	normalizeHref: (href: string) => string;
	generateLookupPath: (href: string) => string;
	shouldDecorateLink: (path: string) => boolean;
	shouldDecorateLinkBatch: (paths: Iterable<string>) => Map<string, boolean>;
	isDecorationEnabled: () => boolean;
};

function createLinkStatusService(
	overrides: Partial<LinkStatusServiceLike> = {},
): LinkStatusServiceLike {
	return {
		extractHref: vi.fn(
			(el: HTMLElement) => el.getAttribute("data-href") ?? undefined,
		),
		normalizeHref: vi.fn((href: string) => href),
		generateLookupPath: vi.fn((href: string) => href),
		shouldDecorateLink: vi.fn(() => false),
		shouldDecorateLinkBatch: vi.fn((paths: Iterable<string>) => {
			const arr = Array.from(paths);
			return new Map(arr.map((path) => [path, false]));
		}),
		isDecorationEnabled: vi.fn(() => true),
		...overrides,
	};
}

function getDecoratedState(el: Element | null): string | null {
	return el?.getAttribute(UNRESOLVED_LINK_ATTRIBUTE.NAME) ?? null;
}

describe("StylingService", () => {
	it("applies and removes the unresolved attribute for a rendered link", () => {
		document.body.innerHTML = `
			<a class="internal-link" data-href="missing.md">Missing</a>
		`;

		let unresolved = true;
		const linkStatusService = createLinkStatusService({
			shouldDecorateLinkBatch: vi.fn((paths: Iterable<string>) => {
				const arr = Array.from(paths);
				return new Map(arr.map((path) => [path, unresolved]));
			}),
		});
		const service = createStylingService(linkStatusService as never);
		const linkEl = document.querySelector<HTMLElement>(".internal-link");

		service.reconcileLinkElementsInContainer(linkEl!.parentElement!, [linkEl!]);

		expect(getDecoratedState(linkEl)).toBe(UNRESOLVED_LINK_ATTRIBUTE.VALUE_SPECIAL);

		unresolved = false;
		service.reconcileLinkElementsInContainer(linkEl!.parentElement!, [linkEl!]);

		expect(linkEl?.hasAttribute(UNRESOLVED_LINK_ATTRIBUTE.NAME)).toBe(false);
	});

	it("keeps metadata wrapper decoration when decorating metadata links", () => {
		document.body.innerHTML = `
			<div class="metadata-content">
				<div class="metadata-link-inner internal-link is-unresolved" data-href="missing.md">
					Missing
				</div>
			</div>
		`;

		const linkStatusService = createLinkStatusService({
			shouldDecorateLinkBatch: vi.fn((paths: Iterable<string>) => {
				const arr = Array.from(paths);
				return new Map(arr.map((path) => [path, true]));
			}),
		});
		const service = createStylingService(linkStatusService as never);
		const metadataLink =
			document.querySelector<HTMLElement>(".metadata-link-inner");

		service.reconcileLinkElementsInContainer(
			metadataLink!.parentElement!,
			[metadataLink!],
			undefined,
			[".metadata-link-inner"],
			undefined,
			"properties",
		);

		expect(getDecoratedState(metadataLink)).toBe(
			UNRESOLVED_LINK_ATTRIBUTE.VALUE_SPECIAL,
		);
	});

	it("skips clearing attributes when the container has no internal links", () => {
		document.body.innerHTML = `
			<div id="container">
				<span class="cm-link-alias-pipe" data-twohop-link-state="special-unresolved"></span>
			</div>
		`;

		const linkStatusService = createLinkStatusService();
		const service = createStylingService(linkStatusService as never);
		const container = document.querySelector<HTMLElement>("#container");

		service.decorateLinksInContainer(container!, "notes/source.md");

		expect(
			container
				?.querySelector(".cm-link-alias-pipe")
				?.hasAttribute(UNRESOLVED_LINK_ATTRIBUTE.NAME),
		).toBe(true);
		expect(linkStatusService.shouldDecorateLinkBatch).not.toHaveBeenCalled();
	});

	it("removes stale attributes only from the current link targets", () => {
		document.body.innerHTML = `
			<div id="container">
				<a class="internal-link" data-href="resolved.md" data-twohop-link-state="special-unresolved">Resolved</a>
				<span class="other" data-twohop-link-state="special-unresolved"></span>
			</div>
		`;

		const linkStatusService = createLinkStatusService({
			shouldDecorateLinkBatch: vi.fn((paths: Iterable<string>) => {
				const arr = Array.from(paths);
				return new Map(arr.map((path) => [path, false]));
			}),
		});
		const service = createStylingService(linkStatusService as never);
		const container = document.querySelector<HTMLElement>("#container");
		const link = document.querySelector<HTMLElement>("a.internal-link");
		const other = document.querySelector<HTMLElement>(".other");

		service.decorateLinksInContainer(container!, "notes/source.md");

		expect(link?.hasAttribute(UNRESOLVED_LINK_ATTRIBUTE.NAME)).toBe(false);
		expect(other?.hasAttribute(UNRESOLVED_LINK_ATTRIBUTE.NAME)).toBe(true);
	});
});
