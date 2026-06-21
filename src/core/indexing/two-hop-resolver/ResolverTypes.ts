export interface ResolverPerformanceSettings {
	enableProgressiveTwoHopBuild: boolean;
	maxOutgoingToProcess: number;
	maxHop2PerBranch: number;
}

export interface ResolverDebugPolicy {
	enableCanvasBacklinkDebug?: boolean;
}
