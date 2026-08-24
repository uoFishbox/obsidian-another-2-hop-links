import type { TFile } from "obsidian";
import type { IIndexingService } from "types/services";
import type { IMetadataCache } from "types/obsidian";
import type { LinkReference, TwoHopIndexedLink, TwoHopLinkBranch } from "types/domain";
import { defaultYieldToMainThread } from "core/indexing/timeSlicing";
import { getLookupPathForLink } from "core/indexing/link-resolution/linkResolution";
import { resolveLinkDestination } from "core/indexing/link-resolution/linkResolution";
import { throwIfResolveAborted } from "./ResolverDependencies";

const BUILD_YIELD_INTERVAL_MS = 8;
const BUILD_YIELD_CHECK_CADENCE = 32;

export class TwoHopBranchBuilder {
	constructor(
		private readonly metadataCache: IMetadataCache,
		private readonly indexingService: IIndexingService,
	) {}

	public async buildHop1OnlyBranches(
		targetFile: TFile,
		outgoingLinks: readonly LinkReference[],
		signal?: AbortSignal,
	): Promise<TwoHopLinkBranch[]> {
		let lastYieldAt = this.getNowMs();
		let processedCount = 0;
		const branches: TwoHopLinkBranch[] = [];
		const branchIndexByLookupPath = new Map<string, number>();
		const resolutionCache = new Map<
			string,
			ReturnType<typeof resolveLinkDestination>
		>();
		for (let i = 0; i < outgoingLinks.length; i += 1) {
			throwIfResolveAborted(signal);
			const linkReference = outgoingLinks[i];
			const resolution = this.getResolvedOutgoingLink(
				targetFile.path,
				linkReference,
				resolutionCache,
			);
			if (this.isSelfReference(resolution, targetFile.path)) {
				continue;
			}

			const lookupPath = resolution.file?.path ?? resolution.lookupPath;
			const existingIndex = branchIndexByLookupPath.get(lookupPath);
			if (existingIndex !== undefined) {
				this.updateHop1PositionFromReference(
					branches[existingIndex].hop1,
					linkReference,
				);
				processedCount += 1;
				if (this.shouldYieldToMainThread(processedCount, lastYieldAt)) {
					await this.yieldToMainThread();
					throwIfResolveAborted(signal);
					lastYieldAt = this.getNowMs();
				}
				continue;
			}

			const hop1 = this.createHop1Link(
				linkReference,
				resolution.file?.path ?? undefined,
				resolution.lookupPath,
				resolution.isUnresolved,
				targetFile,
			);
			branchIndexByLookupPath.set(lookupPath, branches.length);
			branches.push({ hop1, hop2: [] });

			processedCount += 1;
			if (this.shouldYieldToMainThread(processedCount, lastYieldAt)) {
				await this.yieldToMainThread();
				throwIfResolveAborted(signal);
				lastYieldAt = this.getNowMs();
			}
		}

		return branches;
	}

	public async populateHop2(
		targetFile: TFile,
		branches: readonly TwoHopLinkBranch[],
		signal?: AbortSignal,
	): Promise<TwoHopLinkBranch[]> {
		let lastYieldAt = this.getNowMs();
		const populatedBranches = new Array<TwoHopLinkBranch>(branches.length);

		for (let index = 0; index < branches.length; index += 1) {
			throwIfResolveAborted(signal);
			const branch = branches[index];
			const lookupPath = branch.hop1.path ?? getLookupPathForLink(branch.hop1);
			populatedBranches[index] = {
				hop1: branch.hop1,
				hop2: this.indexingService.getUniqueBacklinkSourcesForLink(
					lookupPath,
					targetFile.path,
				),
			};

			if (this.shouldYieldToMainThread(index + 1, lastYieldAt)) {
				await this.yieldToMainThread();
				throwIfResolveAborted(signal);
				lastYieldAt = this.getNowMs();
			}
		}

		return populatedBranches;
	}

	private updateHop1Position(
		existingHop1: TwoHopIndexedLink,
		nextPos: TwoHopIndexedLink["position"],
	): void {
		const existingPos = existingHop1.position;
		if (nextPos && !existingPos) {
			existingHop1.position = nextPos;
			return;
		}

		if (
			nextPos?.start &&
			existingPos?.start &&
			nextPos.start.offset < existingPos.start.offset
		) {
			existingHop1.position = nextPos;
		}
	}

	private updateHop1PositionFromReference(
		existingHop1: TwoHopIndexedLink,
		linkReference: LinkReference,
	): void {
		this.updateHop1Position(
			existingHop1,
			"position" in linkReference ? linkReference.position : undefined,
		);
	}

	private getResolvedOutgoingLink(
		sourcePath: string,
		linkReference: LinkReference,
		resolutionCache: Map<string, ReturnType<typeof resolveLinkDestination>>,
	): ReturnType<typeof resolveLinkDestination> {
		const cached = resolutionCache.get(linkReference.link);
		if (cached) {
			return cached;
		}

		const resolved = resolveLinkDestination(
			this.metadataCache,
			linkReference,
			sourcePath,
		);
		resolutionCache.set(linkReference.link, resolved);
		return resolved;
	}

	private createHop1Link(
		linkReference: LinkReference,
		resolvedPath: string | undefined,
		lookupPath: string,
		isUnresolved: boolean,
		sourceFile: TFile,
	): TwoHopIndexedLink {
		const displayText =
			"displayText" in linkReference
				? (linkReference as { displayText?: string }).displayText
				: undefined;
		const key = "key" in linkReference ? linkReference.key : undefined;

		const link: TwoHopIndexedLink = {
			rawText: linkReference.link,
			path: resolvedPath,
			lookupPath,
			displayText: undefined,
			isUnresolved,
			sourceFile,
			position: undefined,
			backlinkCount: undefined,
			key: undefined,
		};
		link.displayText = displayText;
		link.position =
			"position" in linkReference ? linkReference.position : undefined;
		if (key !== undefined) {
			link.key = key;
		}

		if (isUnresolved) {
			const resolvedLookupPath = getLookupPathForLink(link);
			link.backlinkCount =
				this.indexingService.getBacklinkCountForLink(resolvedLookupPath);
		}

		return link;
	}

	private isSelfReference(
		resolution: ReturnType<typeof resolveLinkDestination>,
		targetPath: string,
	): boolean {
		return (
			(resolution.file && resolution.file.path === targetPath) ||
			(!resolution.file && resolution.lookupPath === targetPath)
		);
	}

	private shouldYieldToMainThread(iteration: number, lastYieldAt: number): boolean {
		if ((iteration & (BUILD_YIELD_CHECK_CADENCE - 1)) !== 0) {
			return false;
		}
		const now = this.getNowMs();
		if (now - lastYieldAt < BUILD_YIELD_INTERVAL_MS) {
			return false;
		}
		return true;
	}

	private async yieldToMainThread(): Promise<void> {
		await defaultYieldToMainThread();
	}

	private getNowMs(): number {
		if (typeof performance !== "undefined") {
			return performance.now();
		}
		return Date.now();
	}
}
