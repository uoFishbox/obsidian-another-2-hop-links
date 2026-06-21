import type { VirtualGridDataSource } from "../types";
import type {
	Result,
	VirtualListInputError,
} from "./virtualListValidationError";

export interface FlatLogicalCellSourceInput<T> {
	readonly items?: readonly T[];
	readonly dataSource?: VirtualGridDataSource<T>;
	readonly getKey?: (item: T, index: number) => string;
}

export type ValidatedFlatLogicalCellSourceInput<T> =
	| {
			readonly type: "data-source-backed";
			readonly dataSource: VirtualGridDataSource<T>;
	  }
	| {
			readonly type: "array-backed";
			readonly items: readonly T[];
			readonly getKey: (item: T, index: number) => string;
	  };

export function validateFlatLogicalCellSourceInput<T>(
	input: FlatLogicalCellSourceInput<T>,
): Result<
	ValidatedFlatLogicalCellSourceInput<T>,
	VirtualListInputError<T, unknown>
> {
	if (input.dataSource) {
		return {
			ok: true,
			value: {
				type: "data-source-backed",
				dataSource: input.dataSource,
			},
		};
	}

	if (!input.getKey) {
		return {
			ok: false,
			error: {
				type: "missing-array-source-key-resolver",
			},
		};
	}

	return {
		ok: true,
		value: {
			type: "array-backed",
			items: input.items ?? [],
			getKey: input.getKey,
		},
	};
}
