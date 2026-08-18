export type VirtualCellBodyLifecyclePolicy<TCell> =
	| {
			readonly type: "physical-slot";
			/**
			 * Remounts the body when the physical slot itself stays resident but the
			 * meaning of its binding changes outside normal viewport recycling.
			 */
			readonly revision?: unknown;
	  }
	| {
			readonly type: "keyed";
			readonly resolveKey?: (cell: TCell) => unknown;
	  };

export const KEYED_VIRTUAL_CELL_BODY_LIFECYCLE = {
	type: "keyed",
} as const satisfies VirtualCellBodyLifecyclePolicy<never>;

export const PHYSICAL_SLOT_BODY_LIFECYCLE = {
	type: "physical-slot",
} as const satisfies VirtualCellBodyLifecyclePolicy<never>;

/** Resolves the identity of a keyed body without coupling it to a row model. */
export function resolveVirtualCellBodyKey<TCell>(params: {
	readonly cell: TCell;
	readonly policy: Extract<
		VirtualCellBodyLifecyclePolicy<TCell>,
		{ readonly type: "keyed" }
	>;
	readonly resolveDefaultKey: (cell: TCell) => unknown;
}): unknown {
	return (
		params.policy.resolveKey?.(params.cell) ?? params.resolveDefaultKey(params.cell)
	);
}
