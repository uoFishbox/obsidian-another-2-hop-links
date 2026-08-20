export {
	type ItemStrategy,
	type ViewItemData,
	BacklinkStrategy,
	NewLinkStrategy,
	OutgoingStrategy,
	NonMdStrategy,
	TaggedNoteStrategy,
	getItemStrategy,
} from "./ItemStrategy";

export {
	type ViewItem,
	toViewItem,
	toViewItems,
	fromViewItem,
	getViewItemKey,
	getViewItemPath,
} from "./ViewItem";

export {
	createStableViewItemReconciler,
	type StableViewItemReconciler,
	type StableViewItemReconcilerOptions,
} from "./stableViewItemReconciler";

export {
	hasSameBacklinkIndexedLink,
	hasSameBacklinkIndexedLinks,
	hasSameTaggedNote,
	hasSameTaggedNotes,
	hasSameTwoHopBranchCard,
	hasSameTwoHopIndexedLink,
	hasSameTwoHopIndexedLinks,
	hasSameViewItemSource,
} from "./viewItemEquality";
