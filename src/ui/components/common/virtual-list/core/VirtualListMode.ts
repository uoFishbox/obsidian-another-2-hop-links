export type BootstrapReason =
	| "initial"
	| "unstable-measurement"
	| "invalid-mounted-range"
	| "empty-current-range";

export type SkipReason =
	| "unstable-measurement"
	| "no-window"
	| "no-root"
	| "stable-range-not-yet-available";

export type EmptyReason =
	| "no-rows"
	| "no-renderable-content"
	| "clamped-to-empty-range";

export type VirtualListMode =
	| { kind: "uninitialized" }
	| { kind: "bootstrapped"; reason: BootstrapReason }
	| { kind: "stable"; scrolling: boolean }
	| { kind: "skipped"; reason: SkipReason }
	| { kind: "empty"; reason: EmptyReason };

export type MaterializedVirtualListMode = Exclude<
	VirtualListMode,
	{ kind: "uninitialized" }
>;

export type VirtualListMeasurementKind =
	| "stable"
	| "bootstrapped"
	| "skipped";

export const getMeasurementKindForMode = (
	mode: MaterializedVirtualListMode,
): VirtualListMeasurementKind => {
	switch (mode.kind) {
		case "bootstrapped":
			return "bootstrapped";
		case "skipped":
			return "skipped";
		case "empty":
		case "stable":
			return "stable";
	}
};
