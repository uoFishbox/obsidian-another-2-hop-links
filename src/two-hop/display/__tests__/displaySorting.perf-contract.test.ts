import { expect, it } from "vitest";
import { SortService } from "cards/sorting/SortService";
import type { SortOption } from "cards/sorting";
import { DEFAULT_SETTINGS } from "settings/model";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { TwoHopLinkBranch } from "two-hop/model";
import { createDisplayDataBuilder } from "../displayDataBuilder";

it.each<SortOption>(["modified-date-reverse", "relevance"])(
	"bounds cold work and skips sorting/metadata on warm display reads (%s)",
	(option) => {
		const count = 1000;
		const origin = createMockTFile("origin.md");
		const branches: TwoHopLinkBranch[] = Array.from({ length: count }, (_, i) => ({
			hop1: {
				path: `note-${i}.md`,
				rawText: `note-${i}`,
				isUnresolved: false,
				sourceFile: origin,
			},
			hop2: [],
		}));
		const targets = new Set(branches.map((branch) => branch.hop1.path!));
		const shared = new Set([...targets].slice(0, 8));
		let metadataReads = 0;
		let metricReads = 0;
		let version = 0;
		const sortService = new SortService({
			getDisplayName: (item) => ("hop1" in item ? item.hop1.rawText : ""),
			getModifiedTime: (item) => {
				metricReads += 1;
				return "hop1" in item ? Number(item.hop1.rawText.slice(5)) : 0;
			},
			getCreatedTime: () => 0,
			getFileSize: () => 0,
			getBacklinkCount: () => 0,
			getOutgoingLinkCount: () => 0,
		});
		const builder = createDisplayDataBuilder({
			sortService,
			getSortContextVersion: () => version,
			getLinkTargets: (path) => {
				metadataReads += 1;
				return path === origin.path ? targets : shared;
			},
		});
		const settings = { ...DEFAULT_SETTINGS, useMergedLinksSection: true };
		const data = {
			...builder.preprocessLinkDisplayData(
				{
					originFile: origin,
					branches,
					backlinks: [],
					taggedNotes: [],
				},
				settings,
			).data,
			rawTagGroups: [],
		};
		const cold: number[] = [];
		const warm: number[] = [];
		for (let sample = 0; sample < 35; sample += 1) {
			version += 1;
			sortService.invalidateCache();
			metadataReads = metricReads = 0;
			let start = performance.now();
			const result = builder.sortAndAssembleDisplayData(data, settings, option);
			const coldMs = performance.now() - start;
			expect(result.mergedItems[0]).toBe(branches[count - 1]);
			expect(metricReads).toBe(count);
			expect(metadataReads).toBe(option === "relevance" ? count + 1 : 0);
			metadataReads = metricReads = 0;
			start = performance.now();
			let revisited = result;
			for (let repeat = 0; repeat < 1000; repeat += 1) {
				revisited = builder.sortAndAssembleDisplayData(data, settings, option);
			}
			const warmMs = (performance.now() - start) / 1000;
			expect(revisited).toBe(result);
			expect(metadataReads).toBe(0);
			expect(metricReads).toBe(0);
			if (sample >= 5) {
				cold.push(coldMs);
				warm.push(warmMs);
			}
		}
		const median = (values: number[]) => values.sort((a, b) => a - b)[15];
		process.stdout.write(
			`${option}: n=${count}, cold=${median(cold).toFixed(3)} ms, warm=${(median(warm) * 1000).toFixed(3)} us (30 samples)\n`,
		);
	},
);
