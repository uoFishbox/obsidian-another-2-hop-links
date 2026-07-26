import { describe, expect, it, vi } from "vitest";
import type { ViewItem } from "application/presenters";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { LinkUtilitiesContext } from "types/linkContext";
import { DEFAULT_SETTINGS } from "features/settings/model";
import {
	createTwoHopCardRenderModelCache,
	type TwoHopCardModelRevision,
} from "features/two-hop/ui/twoHopCardRenderModelCache";
import type { TwoHopVirtualListItem } from "features/two-hop/ui/twoHopVirtualListModel";

describe("createTwoHopCardRenderModelCache", () => {
	it("reuses a compiled model while the content revision is unchanged", () => {
		resetCCLDevMeasurements();
		const sourceFile = createMockTFile("notes/source.md");
		const targetFile = createMockTFile("notes/target.md");
		const getMetadata = vi.fn(() => null);
		const fileToLinktext = vi.fn(() => "Target");
		const context: LinkUtilitiesContext = {
			getPreview: vi.fn(async () => ({
				type: "text" as const,
				content: "preview",
			})),
			resolveFile: vi.fn(() => null),
			buildWikiLink: vi.fn(() => "[[target]]"),
			fileToLinktext,
			sourceFile,
			getMetadata,
		};
		const getPreviewRenderVersion = vi.fn(() => "0:0");
		const revision: TwoHopCardModelRevision = {
			settings: DEFAULT_SETTINGS,
			searchQuery: "",
			searchScope: "title-and-content",
			matchedItemByKey: null,
			linkContext: context,
			getPreviewRenderVersion,
			applicationUpdateVersion: 0,
		};
		const item: ViewItem = { type: "file", data: targetFile };
		const row: TwoHopVirtualListItem = {
			kind: "primary-link",
			item,
			sourceSectionId: "outgoing",
			searchKey: "target",
			virtualKey: "target",
			interactionId: "i0",
			interactionKey: "item:file:target.md",
		};
		const presentation = {
			sectionVariant: "outgoing",
			resolution: "resolved",
			attachment: false,
			extension: null,
		} as const;
		const cache = createTwoHopCardRenderModelCache();

		const first = cache.resolve(row, presentation, revision);
		const second = cache.resolve(row, { ...presentation }, revision);

		expect(second).toBe(first);
		expect(fileToLinktext).toHaveBeenCalledTimes(1);
		expect(getMetadata).not.toHaveBeenCalled();
		let counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.cardRenderModelCache.miss"].count).toBe(1);
		expect(counters["twoHop.cardRenderModelCache.hit"].count).toBe(1);

		const nextRevision = { ...revision, applicationUpdateVersion: 1 };
		expect(cache.resolve(row, presentation, nextRevision)).not.toBe(first);
		cache.invalidate();
		counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.cardRenderModelCache.miss"].count).toBe(2);
		expect(counters["twoHop.cardRenderModelCache.invalidate"].count).toBe(1);
	});

	it("does not invalidate an unrelated card for one path preview update", () => {
		const sourceFile = createMockTFile("notes/source.md");
		const firstFile = createMockTFile("notes/first.md");
		const secondFile = createMockTFile("notes/second.md");
		const context: LinkUtilitiesContext = {
			getPreview: vi.fn(async () => ({
				type: "text" as const,
				content: "preview",
			})),
			resolveFile: vi.fn(() => null),
			buildWikiLink: vi.fn(() => ""),
			fileToLinktext: vi.fn((file) => file.basename),
			sourceFile,
			getMetadata: vi.fn(() => null),
		};
		const previewVersions: Record<string, string> = {
			[firstFile.path]: "0:0",
			[secondFile.path]: "0:0",
		};
		const revision: TwoHopCardModelRevision = {
			settings: DEFAULT_SETTINGS,
			searchQuery: "",
			searchScope: "title-and-content",
			matchedItemByKey: null,
			linkContext: context,
			getPreviewRenderVersion: (path) => previewVersions[path] ?? "0:0",
			applicationUpdateVersion: 0,
		};
		const createRow = (
			file: typeof firstFile,
			key: string,
		): TwoHopVirtualListItem => ({
			kind: "primary-link",
			item: { type: "file", data: file },
			sourceSectionId: "outgoing",
			searchKey: key,
			virtualKey: key,
		});
		const presentation = {
			sectionVariant: "outgoing",
			resolution: "resolved",
			attachment: false,
			extension: null,
		} as const;
		const firstRow = createRow(firstFile, "first");
		const secondRow = createRow(secondFile, "second");
		const cache = createTwoHopCardRenderModelCache();
		const firstModel = cache.resolve(firstRow, presentation, revision);
		const secondModel = cache.resolve(secondRow, presentation, revision);

		previewVersions[firstFile.path] = "0:1";

		expect(cache.resolve(firstRow, presentation, revision)).not.toBe(firstModel);
		expect(cache.resolve(secondRow, presentation, revision)).toBe(secondModel);
	});
});
