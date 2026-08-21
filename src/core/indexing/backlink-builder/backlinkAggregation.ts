import type { BacklinkBucket } from "types/domain";
import type { LinkReference } from "types/domain";
import type {
	OrderedBacklinkRef,
	SourceDestinationSummary,
	SourceSummary,
} from "../types/IndexTypes";
import { createOrderedBacklinkRef } from "./backlinkReferenceSequence";
import type { ResolvedLinkInfo } from "../link-resolution/linkResolution";
import { HEAVY_YIELD_CHECK_INTERVAL, type YieldScheduler } from "../timeSlicing";

export interface FileLocalDestinationAggregate {
	count: number;
	hasResolved: boolean;
	firstRef: RepresentativeRef;
}

export interface RepresentativeRef {
	ref: OrderedBacklinkRef;
	offset: number;
	summaryIndex?: number;
}

export type RawLinkPathAccumulator = string | Set<string>;

export interface FileLocalLookupKeyState {
	representative: RepresentativeRef;
	rawLinkPaths: RawLinkPathAccumulator;
	isUnresolved: boolean;
}

export interface FileLocalAggregation {
	destinationBuckets: Map<string, FileLocalDestinationAggregate>;
	lookupKeyStates: Map<string, FileLocalLookupKeyState>;
	hasSourceDependentLinks: boolean;
}

type SourceSummaryDestinationVisitor = (
	destinationPath: string,
	aggregate: FileLocalDestinationAggregate,
) => void;

const EMPTY_UNRESOLVED_LOOKUP_KEYS: ReadonlySet<string> = new Set<string>();

export function createFileLocalAggregation(): FileLocalAggregation {
	return {
		destinationBuckets: new Map(),
		lookupKeyStates: new Map(),
		hasSourceDependentLinks: false,
	};
}

export function resetFileLocalAggregation(scratch: FileLocalAggregation): void {
	scratch.destinationBuckets.clear();
	scratch.lookupKeyStates.clear();
	scratch.hasSourceDependentLinks = false;
}

function accumulateRawLinkPath(
	lookupState: FileLocalLookupKeyState,
	rawLinkPath: string,
): void {
	const existing = lookupState.rawLinkPaths;
	if (typeof existing === "string") {
		if (existing === rawLinkPath) return;

		const paths = new Set<string>();
		paths.add(existing);
		paths.add(rawLinkPath);
		lookupState.rawLinkPaths = paths;
		return;
	}

	existing.add(rawLinkPath);
}

export function recordFileLocalReference(
	state: FileLocalAggregation,
	linkReference: LinkReference,
	resolved: ResolvedLinkInfo,
	offset: number,
	rawLinkPath: string,
): void {
	let representativeRef: OrderedBacklinkRef | undefined;
	let sharedRep: RepresentativeRef | undefined;

	const rawLookupKey = resolved.rawLookupKey;
	const lookupState = state.lookupKeyStates.get(rawLookupKey);
	if (!lookupState) {
		representativeRef = createOrderedBacklinkRef(linkReference, resolved);
		sharedRep = { ref: representativeRef, offset };
		state.lookupKeyStates.set(rawLookupKey, {
			representative: sharedRep,
			rawLinkPaths: rawLinkPath,
			isUnresolved: resolved.isUnresolved,
		});
	} else {
		if (offset < lookupState.representative.offset) {
			representativeRef = createOrderedBacklinkRef(linkReference, resolved);
			lookupState.representative.ref = representativeRef;
			lookupState.representative.offset = offset;
		}
		accumulateRawLinkPath(lookupState, rawLinkPath);
		if (resolved.isUnresolved) {
			lookupState.isUnresolved = true;
		}
	}
	state.hasSourceDependentLinks ||= resolved.isSourceDependent;

	const destination = state.destinationBuckets.get(resolved.destinationPath);
	if (!destination) {
		state.destinationBuckets.set(resolved.destinationPath, {
			count: 1,
			hasResolved: !resolved.isUnresolved,
			firstRef: sharedRep ?? {
				ref:
					representativeRef ??
					createOrderedBacklinkRef(linkReference, resolved),
				offset,
			},
		});
		return;
	}

	destination.count++;
	destination.hasResolved ||= !resolved.isUnresolved;
	if (offset < destination.firstRef.offset) {
		destination.firstRef.ref =
			representativeRef ?? createOrderedBacklinkRef(linkReference, resolved);
		destination.firstRef.offset = offset;
	}
}

export function createBacklinkBucketForSource(
	aggregate: Pick<SourceDestinationSummary, "count" | "hasResolved">,
): BacklinkBucket {
	return {
		count: aggregate.count,
		hasResolved: aggregate.hasResolved,
	};
}

function addRepresentativeRef(
	orderedReferences: OrderedBacklinkRef[],
	representative: RepresentativeRef,
): number {
	if (representative.summaryIndex !== undefined) {
		return representative.summaryIndex;
	}

	const index = orderedReferences.length;
	orderedReferences.push(representative.ref);
	representative.summaryIndex = index;
	return index;
}

export function createSourceSummaryFromAggregation(
	localAggregation: FileLocalAggregation,
): SourceSummary | undefined {
	if (
		localAggregation.destinationBuckets.size === 0 &&
		localAggregation.lookupKeyStates.size === 0
	) {
		return undefined;
	}

	const orderedReferences: OrderedBacklinkRef[] = [];

	// Take ownership of the scratch maps and rewrite values in place instead
	// of copying every entry into new persistent maps. The scratch slots are
	// replaced with empty maps for the next file.
	const destinationAggregates = localAggregation.destinationBuckets;
	localAggregation.destinationBuckets = new Map();
	const destinations = destinationAggregates as unknown as Map<
		string,
		SourceDestinationSummary
	>;
	for (const [destinationPath, aggregate] of destinationAggregates) {
		destinations.set(destinationPath, {
			count: aggregate.count,
			hasResolved: aggregate.hasResolved,
			firstRefIndex: addRepresentativeRef(orderedReferences, aggregate.firstRef),
		});
	}

	const lookupKeyStates = localAggregation.lookupKeyStates;
	localAggregation.lookupKeyStates = new Map();
	const split = splitLookupKeyStates(lookupKeyStates, orderedReferences);

	return {
		destinations,
		orderedReferences,
		firstRefIndexByLookupKey: split.firstRefIndexByLookupKey,
		lookupKeyToRawLinkPaths: split.lookupKeyToRawLinkPaths,
		unresolvedLookupKeys: split.unresolvedLookupKeys,
		hasSourceDependentLinks: localAggregation.hasSourceDependentLinks,
	};
}

function splitLookupKeyStates(
	lookupKeyStates: Map<string, FileLocalLookupKeyState>,
	orderedReferences: OrderedBacklinkRef[],
): {
	firstRefIndexByLookupKey: Map<string, number>;
	lookupKeyToRawLinkPaths: Map<string, string | string[]>;
	unresolvedLookupKeys: ReadonlySet<string>;
} {
	const firstRefIndexByLookupKey = new Map<string, number>();
	const lookupKeyToRawLinkPaths = new Map<string, string | string[]>();
	let unresolvedLookupKeys: Set<string> | undefined;

	for (const [lookupKey, lookupState] of lookupKeyStates) {
		firstRefIndexByLookupKey.set(
			lookupKey,
			addRepresentativeRef(orderedReferences, lookupState.representative),
		);
		const rawLinkPaths = lookupState.rawLinkPaths;
		lookupKeyToRawLinkPaths.set(
			lookupKey,
			typeof rawLinkPaths === "string" ? rawLinkPaths : Array.from(rawLinkPaths),
		);
		if (lookupState.isUnresolved) {
			(unresolvedLookupKeys ??= new Set<string>()).add(lookupKey);
		}
	}

	return {
		firstRefIndexByLookupKey,
		lookupKeyToRawLinkPaths,
		unresolvedLookupKeys: unresolvedLookupKeys ?? EMPTY_UNRESOLVED_LOOKUP_KEYS,
	};
}

export function* createSourceSummaryFromAggregationChunked(
	localAggregation: FileLocalAggregation,
	yieldScheduler: YieldScheduler,
	visitDestination?: SourceSummaryDestinationVisitor,
): Generator<Promise<void>, SourceSummary | undefined, void> {
	if (
		localAggregation.destinationBuckets.size === 0 &&
		localAggregation.lookupKeyStates.size === 0
	) {
		return undefined;
	}

	const orderedReferences: OrderedBacklinkRef[] = [];
	let operationCount = 0;

	// Take ownership of the scratch maps and rewrite values in place instead
	// of copying every entry into new persistent maps. The scratch slots are
	// replaced with empty maps for the next file.
	const destinationAggregates = localAggregation.destinationBuckets;
	localAggregation.destinationBuckets = new Map();
	const destinations = destinationAggregates as unknown as Map<
		string,
		SourceDestinationSummary
	>;
	for (const [destinationPath, aggregate] of destinationAggregates) {
		destinations.set(destinationPath, {
			count: aggregate.count,
			hasResolved: aggregate.hasResolved,
			firstRefIndex: addRepresentativeRef(orderedReferences, aggregate.firstRef),
		});
		visitDestination?.(destinationPath, aggregate);

		operationCount++;
		const pendingYield = yieldScheduler.checkpoint(
			operationCount,
			HEAVY_YIELD_CHECK_INTERVAL,
		);
		if (pendingYield) {
			yield pendingYield;
		}
	}

	// The fused per-lookup-key records cannot be handed to two output maps,
	// so split them into fresh maps in a single yielding pass.
	const lookupKeyStates = localAggregation.lookupKeyStates;
	localAggregation.lookupKeyStates = new Map();
	const firstRefIndexByLookupKey = new Map<string, number>();
	const lookupKeyToRawLinkPaths = new Map<string, string | string[]>();
	let unresolvedLookupKeys: Set<string> | undefined;

	for (const [lookupKey, lookupState] of lookupKeyStates) {
		firstRefIndexByLookupKey.set(
			lookupKey,
			addRepresentativeRef(orderedReferences, lookupState.representative),
		);
		const rawLinkPaths = lookupState.rawLinkPaths;
		lookupKeyToRawLinkPaths.set(
			lookupKey,
			typeof rawLinkPaths === "string" ? rawLinkPaths : Array.from(rawLinkPaths),
		);
		if (lookupState.isUnresolved) {
			(unresolvedLookupKeys ??= new Set<string>()).add(lookupKey);
		}

		operationCount++;
		const pendingYield = yieldScheduler.checkpoint(
			operationCount,
			HEAVY_YIELD_CHECK_INTERVAL,
		);
		if (pendingYield) {
			yield pendingYield;
		}
	}

	return {
		destinations,
		orderedReferences,
		firstRefIndexByLookupKey,
		lookupKeyToRawLinkPaths,
		unresolvedLookupKeys: unresolvedLookupKeys ?? EMPTY_UNRESOLVED_LOOKUP_KEYS,
		hasSourceDependentLinks: localAggregation.hasSourceDependentLinks,
	};
}
