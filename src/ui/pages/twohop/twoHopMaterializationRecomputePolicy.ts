import {
	rangeOverlap,
	type RowRange,
} from "ui/components/common/virtual-list/rowRange";

/**
 * Whether a background materialization step needs a synchronous mounted-rows
 * recompute. When the snapshot has no mounted range yet we default to
 * recompute so the initial mounted build reflects the freshly materialized
 * cells; once a range exists we only recompute when it actually overlaps the
 * affected rows.
 */
export function affectsMountedRows(
	mounted: RowRange | undefined,
	affectedRowRange: RowRange | null,
): boolean {
	if (affectedRowRange === null) return false;
	if (mounted === undefined) return true;
	const overlap = rangeOverlap(mounted, affectedRowRange);
	return overlap.start < overlap.end;
}
