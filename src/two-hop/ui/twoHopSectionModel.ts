import type { CardItem } from "cards/CardItem";
import { generateLinkKey } from "preview/text/textUtils";
import type { ClickableHeaderExtraProps } from "two-hop/ui/section-descriptors/types";

/** Immutable section data consumed by two-hop layout and rendering. */
export interface TwoHopSectionModel {
	readonly id: string;
	readonly kind:
		| "primary-section"
		| "two-hop-branch"
		| "tag-section"
		| "new-links-section";
	readonly title: string;
	readonly header: TwoHopHeaderModel;
	/** Materialized item prefix consumed by the virtual row model. */
	readonly items: readonly TwoHopItemModel[];
	/** Total source item count, including the unpublished suffix. */
	readonly totalCount: number;
}

export interface TwoHopHeaderModel {
	readonly logicalKey: string;
	readonly props: ClickableHeaderExtraProps;
}

/** Minimal immutable item data shared by every two-hop section kind. */
export interface TwoHopItemModel {
	readonly item: CardItem;
	readonly interactionId?: string;
	readonly searchKey: string;
	readonly key: string;
}

/** Input required to publish a two-hop section model. */
export interface CreateTwoHopSectionModelParams {
	readonly id: string;
	readonly kind: TwoHopSectionModel["kind"];
	readonly title: string;
	readonly headerProps?: ClickableHeaderExtraProps;
	readonly items: readonly TwoHopItemModel[];
	/** Must be greater than or equal to items.length. */
	readonly totalCount: number;
}

/** Publishes one immutable section consumed directly by the virtual row model. */
export function createTwoHopSectionModel(
	params: CreateTwoHopSectionModelParams,
): TwoHopSectionModel {
	const items = Object.freeze(params.items);
	const requestedTotalCount = Math.floor(params.totalCount);
	const totalCount = Number.isFinite(requestedTotalCount)
		? Math.max(items.length, requestedTotalCount)
		: items.length;
	return Object.freeze({
		id: params.id,
		kind: params.kind,
		title: params.title,
		header: Object.freeze({
			logicalKey: `header:${params.id}`,
			props: params.headerProps ?? {},
		}),
		items,
		totalCount,
	});
}

export function createTaggedNoteSectionItemKey(
	item: CardItem,
	tag: string,
	index: number,
): string {
	if (item.type !== "taggedNote") return `tag-item-${tag}-${index}`;

	const data = item.data;
	const startOffset = data.position?.start.offset ?? "";
	const endOffset = data.position?.end.offset ?? "";
	const suffix = `tag-note:${tag}:${data.usageKey ?? ""}:${startOffset}:${endOffset}`;
	return generateLinkKey(data.path, data.file.basename, suffix);
}
