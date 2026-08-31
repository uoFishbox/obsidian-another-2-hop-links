import type { IncrementalFileChange } from "../indexState";

interface QueuedFileTrack {
	slot: number;
	initialPath?: string;
	currentPath?: string;
	modified: boolean;
	resolved: boolean;
	createSemantics: boolean;
}

interface FileChangeQueueDrainResult {
	changes: IncrementalFileChange[];
	requiresFullRebuild: boolean;
}

export class FileChangeQueue {
	private readonly tracks: Array<QueuedFileTrack | undefined> = [];
	private readonly trackByCurrentPath = new Map<string, QueuedFileTrack>();
	/** Tracks that currently represent deletions, indexed by their initial path. */
	private readonly trackByInitialPath = new Map<string, Set<QueuedFileTrack>>();
	private pendingTrackCount = 0;
	private pendingCreateTrackCount = 0;
	private fullRebuildRequested = false;

	recordChange(change: IncrementalFileChange): void {
		switch (change.type) {
			case "create":
				this.recordCreate(change.path);
				return;
			case "modify":
				this.recordModify(change.path);
				return;
			case "delete":
				this.recordDelete(change.path);
				return;
			case "rename":
				this.recordRename(change.oldPath, change.newPath);
				return;
			case "resolve":
				this.recordResolve(change.path);
				return;
		}
	}

	recordChanges(changes: readonly IncrementalFileChange[]): void {
		for (const change of changes) {
			this.recordChange(change);
		}
	}

	/** Marks all queued changes for recovery through a full index rebuild. */
	requestFullRebuild(): void {
		this.fullRebuildRequested = true;
	}

	hasPending(): boolean {
		return this.fullRebuildRequested || this.pendingTrackCount > 0;
	}

	hasPendingCreateChanges(): boolean {
		return this.pendingCreateTrackCount > 0;
	}

	requiresFullRebuild(): boolean {
		return this.fullRebuildRequested;
	}

	drain(): FileChangeQueueDrainResult {
		const pending = this.getNormalizedChanges();
		const requiresFullRebuild = this.fullRebuildRequested;
		this.tracks.length = 0;
		this.trackByCurrentPath.clear();
		this.trackByInitialPath.clear();
		this.pendingTrackCount = 0;
		this.pendingCreateTrackCount = 0;
		this.fullRebuildRequested = false;
		return {
			changes: pending,
			requiresFullRebuild,
		};
	}

	private recordCreate(path: string): void {
		const currentTrack = this.trackByCurrentPath.get(path);
		if (currentTrack) {
			return;
		}

		const deletedTrack = this.findDeletedTrackByInitialPath(path);
		if (deletedTrack) {
			this.removeDeletedTrack(deletedTrack);
			this.updateTrack(deletedTrack, () => {
				deletedTrack.currentPath = path;
				deletedTrack.createSemantics = true;
			});
			this.trackByCurrentPath.set(path, deletedTrack);
			return;
		}

		this.addTrack({
			initialPath: undefined,
			currentPath: path,
			modified: false,
			resolved: false,
			createSemantics: true,
		});
	}

	private recordModify(path: string): void {
		const track = this.trackByCurrentPath.get(path);
		if (track) {
			if (
				track.initialPath !== undefined &&
				track.initialPath === track.currentPath &&
				!track.createSemantics
			) {
				this.updateTrack(track, () => {
					track.modified = true;
				});
			}
			return;
		}

		if (this.findDeletedTrackByInitialPath(path)) {
			return;
		}

		this.addTrack({
			initialPath: path,
			currentPath: path,
			modified: true,
			resolved: false,
			createSemantics: false,
		});
	}

	private recordResolve(path: string): void {
		const track = this.trackByCurrentPath.get(path);
		if (track) {
			if (
				track.initialPath !== undefined &&
				track.initialPath === track.currentPath &&
				!track.createSemantics &&
				!track.modified
			) {
				this.updateTrack(track, () => {
					track.resolved = true;
				});
			}
			return;
		}

		if (this.findDeletedTrackByInitialPath(path)) {
			return;
		}

		this.addTrack({
			initialPath: path,
			currentPath: path,
			modified: false,
			resolved: true,
			createSemantics: false,
		});
	}

	private recordDelete(path: string): void {
		const track = this.trackByCurrentPath.get(path);
		if (track) {
			this.trackByCurrentPath.delete(path);
			if (track.initialPath === undefined) {
				this.removeTrack(track);
				return;
			}

			this.updateTrack(track, () => {
				track.currentPath = undefined;
			});
			this.addDeletedTrack(track);
			return;
		}

		if (this.findDeletedTrackByInitialPath(path)) {
			return;
		}

		this.addTrack({
			initialPath: path,
			currentPath: undefined,
			modified: false,
			resolved: false,
			createSemantics: false,
		});
	}

	private recordRename(oldPath: string, newPath: string): void {
		if (oldPath === newPath) {
			return;
		}

		const sourceTrack =
			this.trackByCurrentPath.get(oldPath) ??
			this.addTrack({
				initialPath: oldPath,
				currentPath: oldPath,
				modified: false,
				resolved: false,
				createSemantics: false,
			});

		if (this.trackByCurrentPath.has(newPath)) {
			return;
		}

		this.trackByCurrentPath.delete(oldPath);
		this.updateTrack(sourceTrack, () => {
			sourceTrack.currentPath = newPath;
		});
		this.trackByCurrentPath.set(newPath, sourceTrack);
		this.cleanupTrackIfNoLongerNeeded(sourceTrack);
	}

	private addTrack(track: Omit<QueuedFileTrack, "slot">): QueuedFileTrack {
		const queuedTrack: QueuedFileTrack = {
			slot: this.tracks.length,
			...track,
		};
		this.tracks.push(queuedTrack);
		if (queuedTrack.currentPath !== undefined) {
			this.trackByCurrentPath.set(queuedTrack.currentPath, queuedTrack);
		} else {
			this.addDeletedTrack(queuedTrack);
		}
		this.addPendingCounts(queuedTrack);
		return queuedTrack;
	}

	private removeTrack(target: QueuedFileTrack): void {
		if (this.tracks[target.slot] !== target) {
			return;
		}

		this.tracks[target.slot] = undefined;
		if (
			target.currentPath !== undefined &&
			this.trackByCurrentPath.get(target.currentPath) === target
		) {
			this.trackByCurrentPath.delete(target.currentPath);
		}
		this.removeDeletedTrack(target);
		this.removePendingCounts(target);
	}

	private findDeletedTrackByInitialPath(path: string): QueuedFileTrack | undefined {
		return this.trackByInitialPath.get(path)?.values().next().value;
	}

	private addDeletedTrack(track: QueuedFileTrack): void {
		if (track.initialPath === undefined) {
			return;
		}

		const tracks = this.trackByInitialPath.get(track.initialPath);
		if (tracks) {
			tracks.add(track);
			return;
		}

		this.trackByInitialPath.set(track.initialPath, new Set([track]));
	}

	private removeDeletedTrack(track: QueuedFileTrack): void {
		if (track.initialPath === undefined) {
			return;
		}

		const tracks = this.trackByInitialPath.get(track.initialPath);
		if (!tracks) {
			return;
		}

		tracks.delete(track);
		if (tracks.size === 0) {
			this.trackByInitialPath.delete(track.initialPath);
		}
	}

	private updateTrack(track: QueuedFileTrack, update: () => void): void {
		const wasPending = this.hasPendingTrack(track);
		const wasPendingCreate = this.hasPendingCreateTrack(track);
		update();
		const isPending = this.hasPendingTrack(track);
		const isPendingCreate = this.hasPendingCreateTrack(track);
		this.pendingTrackCount += Number(isPending) - Number(wasPending);
		this.pendingCreateTrackCount +=
			Number(isPendingCreate) - Number(wasPendingCreate);
	}

	private addPendingCounts(track: QueuedFileTrack): void {
		this.pendingTrackCount += Number(this.hasPendingTrack(track));
		this.pendingCreateTrackCount += Number(this.hasPendingCreateTrack(track));
	}

	private removePendingCounts(track: QueuedFileTrack): void {
		this.pendingTrackCount -= Number(this.hasPendingTrack(track));
		this.pendingCreateTrackCount -= Number(this.hasPendingCreateTrack(track));
	}

	private cleanupTrackIfNoLongerNeeded(track: QueuedFileTrack): void {
		if (this.hasPendingTrack(track)) {
			return;
		}

		this.removeTrack(track);
	}

	private hasPendingTrack(track: QueuedFileTrack): boolean {
		if (track.currentPath === undefined) {
			return track.initialPath !== undefined;
		}
		if (track.initialPath === undefined) {
			return true;
		}
		return (
			track.initialPath !== track.currentPath ||
			track.createSemantics ||
			track.modified ||
			track.resolved
		);
	}

	private hasPendingCreateTrack(track: QueuedFileTrack): boolean {
		if (track.currentPath === undefined) {
			return false;
		}
		return (
			track.initialPath === undefined ||
			track.initialPath !== track.currentPath ||
			track.createSemantics
		);
	}

	private getNormalizedChanges(): IncrementalFileChange[] {
		const result: IncrementalFileChange[] = [];
		for (let i = 0; i < this.tracks.length; i++) {
			const track = this.tracks[i];
			if (track === undefined) {
				continue;
			}
			const change = this.materializeTrack(track);
			if (change !== null) {
				result.push(change);
			}
		}
		return result;
	}

	private materializeTrack(track: QueuedFileTrack): IncrementalFileChange | null {
		if (track.currentPath === undefined) {
			return track.initialPath
				? { type: "delete", path: track.initialPath }
				: null;
		}

		if (track.initialPath === undefined) {
			return { type: "create", path: track.currentPath };
		}

		if (track.initialPath !== track.currentPath) {
			return {
				type: "rename",
				oldPath: track.initialPath,
				newPath: track.currentPath,
			};
		}

		if (track.createSemantics) {
			return { type: "create", path: track.currentPath };
		}

		if (track.modified) {
			return { type: "modify", path: track.currentPath };
		}

		if (track.resolved) {
			return { type: "resolve", path: track.currentPath };
		}

		return null;
	}
}
