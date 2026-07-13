export type CardSectionVariant =
	| "backlinks"
	| "outgoing"
	| "merged"
	| "new-links"
	| "tag"
	| "two-hop";

export interface CardPresentationState {
	readonly sectionVariant: CardSectionVariant;
	readonly resolution: "resolved" | "missing";
	readonly attachment: boolean;
	readonly extension: string | null;
}
