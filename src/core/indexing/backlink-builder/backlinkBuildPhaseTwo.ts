import {
	drainYieldSteps,
	HEAVY_YIELD_CHECK_INTERVAL,
	type YieldScheduler,
	type YieldStepGenerator,
} from "../timeSlicing";
import type { BacklinkSourceMap } from "types/domain";
import type { BacklinksBuildArtifacts } from "./backlinkBuildArtifacts";

type MutableBacklinksBuildArtifacts = BacklinksBuildArtifacts;

export interface DestinationBuildState {
	sourceMap: BacklinkSourceMap;
	lookupKey: string;
	lookupSources: Set<string>;
	resolvedSourceCount: number;
}

export async function finalizePhaseTwoArtifactsChunked(
	artifacts: MutableBacklinksBuildArtifacts,
	destinationBuildStates: Map<string, DestinationBuildState>,
	yieldScheduler: YieldScheduler,
): Promise<void> {
	await drainYieldSteps(
		finalizePhaseTwoArtifacts(artifacts, destinationBuildStates, yieldScheduler),
	);
}

function* finalizePhaseTwoArtifacts(
	artifacts: MutableBacklinksBuildArtifacts,
	destinationBuildStates: Map<string, DestinationBuildState>,
	yieldScheduler: YieldScheduler,
): YieldStepGenerator {
	yield* finalizeDestinationLookupArtifacts(
		artifacts,
		destinationBuildStates,
		yieldScheduler,
	);
	destinationBuildStates.clear();
}

function* finalizeDestinationLookupArtifacts(
	artifacts: MutableBacklinksBuildArtifacts,
	destinationBuildStates: Map<string, DestinationBuildState>,
	yieldScheduler: YieldScheduler,
): YieldStepGenerator {
	let destinationCount = 0;
	for (const [lookupPath, state] of destinationBuildStates) {
		if (state.resolvedSourceCount > 0) {
			artifacts.lookupPathResolvedSourceCount.set(
				lookupPath,
				state.resolvedSourceCount,
			);
			incrementLookupKeyDirectResolvedPathCount(
				artifacts.lookupKeyDirectResolvedPathCount,
				state.lookupKey,
			);
		}

		destinationCount++;
		const pendingYield = yieldScheduler.checkpoint(
			destinationCount,
			HEAVY_YIELD_CHECK_INTERVAL,
		);
		if (pendingYield) {
			yield pendingYield;
		}
	}
}

function incrementLookupKeyDirectResolvedPathCount(
	lookupKeyDirectResolvedPathCount: Map<string, number>,
	lookupKey: string,
): void {
	const next = (lookupKeyDirectResolvedPathCount.get(lookupKey) ?? 0) + 1;
	lookupKeyDirectResolvedPathCount.set(lookupKey, next);
}
