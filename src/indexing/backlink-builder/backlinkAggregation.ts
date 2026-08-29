import type { LinkReference } from "indexing/model";
import type {
	OrderedBacklinkRef,
	SourceDestinationSummary,
	SourceLookupSummary,
	SourceSummary,
} from "../indexState";
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
	summary: SourceDestinationSummary,
) => void;

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

	const destinations = takeDestinationBucketsAsSummaryMap(localAggregation);
	const destinationAggregates = destinations as unknown as Map<
		string,
		FileLocalDestinationAggregate
	>;
	for (const [destinationPath, aggregate] of destinationAggregates) {
		const summary: SourceDestinationSummary = {
			count: aggregate.count,
			hasResolved: aggregate.hasResolved,
			firstRefIndex: addRepresentativeRef(orderedReferences, aggregate.firstRef),
		};
		destinations.set(destinationPath, summary);
	}

	const lookupKeyStates = takeLookupKeyStatesAsSummaryMap(localAggregation);
	const lookupEntries = fuseLookupKeyStates(
		lookupKeyStates as unknown as Map<string, FileLocalLookupKeyState>,
		orderedReferences,
	);

	return {
		destinations,
		orderedReferences,
		lookupEntries,
		hasSourceDependentLinks: localAggregation.hasSourceDependentLinks,
	};
}

/**
 * Transfers the scratch map into the persistent summary without copying its
 * entries. A fresh empty map is installed before the caller starts rewriting
 * the transferred values, so the scratch owner never observes the summary map
 * again.
 */
function takeDestinationBucketsAsSummaryMap(
	localAggregation: FileLocalAggregation,
): Map<string, SourceDestinationSummary> {
	const destinationBuckets = localAggregation.destinationBuckets;
	localAggregation.destinationBuckets = new Map();
	return destinationBuckets as unknown as Map<string, SourceDestinationSummary>;
}

/** Transfers lookup-key scratch slots into the persistent summary map. */
function takeLookupKeyStatesAsSummaryMap(
	localAggregation: FileLocalAggregation,
): Map<string, SourceLookupSummary> {
	const lookupKeyStates = localAggregation.lookupKeyStates;
	localAggregation.lookupKeyStates = new Map();
	return lookupKeyStates as unknown as Map<string, SourceLookupSummary>;
}

function fuseLookupKeyStates(
	lookupKeyStates: Map<string, FileLocalLookupKeyState>,
	orderedReferences: OrderedBacklinkRef[],
): Map<string, SourceLookupSummary> {
	const lookupEntries = lookupKeyStates as unknown as Map<
		string,
		SourceLookupSummary
	>;

	for (const [lookupKey, lookupState] of lookupKeyStates) {
		const rawLinkPaths = lookupState.rawLinkPaths;
		lookupEntries.set(lookupKey, {
			firstRefIndex: addRepresentativeRef(
				orderedReferences,
				lookupState.representative,
			),
			rawLinkPaths:
				typeof rawLinkPaths === "string"
					? rawLinkPaths
					: Array.from(rawLinkPaths),
			isUnresolved: lookupState.isUnresolved,
		});
	}

	return lookupEntries;
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

	const destinations = takeDestinationBucketsAsSummaryMap(localAggregation);
	const destinationAggregates = destinations as unknown as Map<
		string,
		FileLocalDestinationAggregate
	>;
	for (const [destinationPath, aggregate] of destinationAggregates) {
		const summary: SourceDestinationSummary = {
			count: aggregate.count,
			hasResolved: aggregate.hasResolved,
			firstRefIndex: addRepresentativeRef(orderedReferences, aggregate.firstRef),
		};
		destinations.set(destinationPath, summary);
		visitDestination?.(destinationPath, summary);

		operationCount++;
		const pendingYield = yieldScheduler.checkpoint(
			operationCount,
			HEAVY_YIELD_CHECK_INTERVAL,
		);
		if (pendingYield) {
			yield pendingYield;
		}
	}

	// Keep the fused per-lookup-key records in the persistent summary map.
	const lookupEntries = takeLookupKeyStatesAsSummaryMap(localAggregation);
	const lookupKeyStates = lookupEntries as unknown as Map<
		string,
		FileLocalLookupKeyState
	>;

	for (const [lookupKey, lookupState] of lookupKeyStates) {
		const rawLinkPaths = lookupState.rawLinkPaths;
		lookupEntries.set(lookupKey, {
			firstRefIndex: addRepresentativeRef(
				orderedReferences,
				lookupState.representative,
			),
			rawLinkPaths:
				typeof rawLinkPaths === "string"
					? rawLinkPaths
					: Array.from(rawLinkPaths),
			isUnresolved: lookupState.isUnresolved,
		});

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
		lookupEntries,
		hasSourceDependentLinks: localAggregation.hasSourceDependentLinks,
	};
}
