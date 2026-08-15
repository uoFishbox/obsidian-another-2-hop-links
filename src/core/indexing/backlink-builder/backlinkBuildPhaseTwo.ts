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
