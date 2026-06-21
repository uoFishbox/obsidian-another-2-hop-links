import type { IncrementalFileChange } from "../types/IndexTypes";

interface QueuedFileTrack {
	order: number;
	initialPath?: string;
	currentPath?: string;
	modified: boolean;
	createSemantics: boolean;
}

export class FileChangeQueue {
	private readonly tracks: QueuedFileTrack[] = [];
	private readonly trackByCurrentPath = new Map<string, QueuedFileTrack>();
	private requiresBacklinkRebuild = false;
	private requiresTagRebuild = false;
	private nextTrackOrder = 0;

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
		}
	}

	triggerBacklinkRebuild(): void {
		this.requiresBacklinkRebuild = true;
	}

	triggerTagRebuild(): void {
		this.requiresTagRebuild = true;
	}

	hasPending(): boolean {
		return (
			this.requiresBacklinkRebuild ||
			this.requiresTagRebuild ||
			this.tracks.some((track) => this.hasPendingTrack(track))
		);
	}

	hasPendingCreateChanges(): boolean {
		return this.tracks.some((track) => this.hasPendingCreateTrack(track));
	}

	requiresFullRebuild(): boolean {
		return this.requiresBacklinkRebuild || this.requiresTagRebuild;
	}

	drain() {
		const pending = this.getNormalizedChanges();
		const needsBacklinkRebuild = this.requiresBacklinkRebuild;
		const needsTagRebuild = this.requiresTagRebuild;
		this.tracks.length = 0;
		this.trackByCurrentPath.clear();
		this.requiresBacklinkRebuild = false;
		this.requiresTagRebuild = false;
		return {
			changes: pending,
			requiresBacklinkRebuild: needsBacklinkRebuild,
			requiresTagRebuild: needsTagRebuild,
		};
	}

	private recordCreate(path: string): void {
		const currentTrack = this.trackByCurrentPath.get(path);
		if (currentTrack) {
			return;
		}

		const deletedTrack = this.findDeletedTrackByInitialPath(path);
		if (deletedTrack) {
			deletedTrack.currentPath = path;
			deletedTrack.createSemantics = true;
			this.trackByCurrentPath.set(path, deletedTrack);
			return;
		}

		this.addTrack({
			initialPath: undefined,
			currentPath: path,
			modified: false,
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
				track.modified = true;
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

			track.currentPath = undefined;
			return;
		}

		if (this.findDeletedTrackByInitialPath(path)) {
			return;
		}

		this.addTrack({
			initialPath: path,
			currentPath: undefined,
			modified: false,
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
				createSemantics: false,
			});

		if (this.trackByCurrentPath.has(newPath)) {
			return;
		}

		this.trackByCurrentPath.delete(oldPath);
		sourceTrack.currentPath = newPath;
		this.trackByCurrentPath.set(newPath, sourceTrack);
		this.cleanupTrackIfNoLongerNeeded(sourceTrack);
	}

	private addTrack(track: Omit<QueuedFileTrack, "order">): QueuedFileTrack {
		const queuedTrack: QueuedFileTrack = {
			order: this.nextTrackOrder++,
			...track,
		};
		this.tracks.push(queuedTrack);
		if (queuedTrack.currentPath) {
			this.trackByCurrentPath.set(queuedTrack.currentPath, queuedTrack);
		}
		return queuedTrack;
	}

	private removeTrack(target: QueuedFileTrack): void {
		const index = this.tracks.indexOf(target);
		if (index !== -1) {
			this.tracks.splice(index, 1);
		}
		if (target.currentPath) {
			this.trackByCurrentPath.delete(target.currentPath);
		}
	}

	private findDeletedTrackByInitialPath(
		path: string,
	): QueuedFileTrack | undefined {
		return this.tracks.find(
			(track) =>
				track.initialPath === path && track.currentPath === undefined,
		);
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
			track.modified
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
			const change = this.materializeTrack(this.tracks[i]);
			if (change !== null) {
				result.push(change);
			}
		}
		return result;
	}

	private materializeTrack(
		track: QueuedFileTrack,
	): IncrementalFileChange | null {
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

		return null;
	}
}
