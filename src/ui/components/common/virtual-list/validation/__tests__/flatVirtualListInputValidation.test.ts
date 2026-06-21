import { describe, expect, it } from "vitest";
import {
	createArrayVirtualGridDataSource,
	tryCreateFlatLogicalCellSource,
} from "../../flatLogicalCellSource";
import { validateFlatLogicalCellSourceInput } from "../flatVirtualListInputValidation";
import { formatVirtualListInputError } from "../virtualListValidationError";

describe("validateFlatLogicalCellSourceInput", () => {
	it("returns a structured error when an array-backed source has no key resolver", () => {
		const result = validateFlatLogicalCellSourceInput({
			items: ["alpha"],
		});

		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.error).toEqual({
			type: "missing-array-source-key-resolver",
		});
		expect(formatVirtualListInputError(result.error)).toBe(
			"getKey is required for array-backed sources.",
		);
	});

	it("accepts data-source-backed input without an array key resolver", () => {
		const dataSource = createArrayVirtualGridDataSource({
			items: ["alpha"],
			getKey: (item) => item,
		});

		const result = validateFlatLogicalCellSourceInput({ dataSource });

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.value).toEqual({
			type: "data-source-backed",
			dataSource,
		});
	});

	it("lets callers create flat logical cell sources without throwing", () => {
		const result = tryCreateFlatLogicalCellSource({
			header: false,
			items: ["alpha"],
			visibleCount: 1,
			showLoadMore: false,
		});

		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.error.type).toBe("missing-array-source-key-resolver");
	});
});
