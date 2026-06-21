import type { PluginHost } from "types/pluginHost";
import { cloneDeskState } from "settings/SettingsManager";
import type { DeskCardRecord, DeskGridPosition, DeskState } from "./types";

type DeskStateListener = (state: DeskState) => void;

export class DeskStore {
	private listeners = new Set<DeskStateListener>();

	constructor(private plugin: PluginHost) {}

	getSnapshot(): DeskState {
		return cloneDeskState(this.plugin.settings.desk);
	}

	subscribe(listener: DeskStateListener): () => void {
		this.listeners.add(listener);
		listener(this.getSnapshot());

		return () => {
			this.listeners.delete(listener);
		};
	}

	async addOrMovePath(
		path: string,
		insertIndex?: number,
		gridPosition?: DeskGridPosition,
	): Promise<void> {
		if (!path) {
			return;
		}

		const current = this.getSnapshot();
		const now = Date.now();
		const existing = current.cards.find((card) => card.path === path);
		const without = current.cards.filter((card) => card.path !== path);
		const nextCard: DeskCardRecord = {
			...(existing ?? {
				path,
				addedAt: now,
				updatedAt: now,
			}),
			path,
			updatedAt: now,
			...(gridPosition ? { gridPosition } : {}),
		};
		const index = Math.max(
			0,
			Math.min(insertIndex ?? without.length, without.length),
		);
		const cards = [
			...without.slice(0, index),
			nextCard,
			...without.slice(index),
		];

		await this.save({ version: 1, cards });
	}

	async placePath(
		path: string,
		gridPosition: DeskGridPosition,
	): Promise<void> {
		await this.addOrMovePath(path, undefined, gridPosition);
	}

	async placePathAndMoveOccupant(
		path: string,
		gridPosition: DeskGridPosition,
		occupantPath: string,
		occupantGridPosition: DeskGridPosition,
	): Promise<void> {
		if (!path || !occupantPath || path === occupantPath) {
			await this.placePath(path, gridPosition);
			return;
		}

		const current = this.getSnapshot();
		const now = Date.now();
		const existing = current.cards.find((card) => card.path === path);
		const occupant = current.cards.find((card) => card.path === occupantPath);
		const without = current.cards.filter(
			(card) => card.path !== path && card.path !== occupantPath,
		);
		const nextCard: DeskCardRecord = {
			...(existing ?? {
				path,
				addedAt: now,
				updatedAt: now,
			}),
			path,
			updatedAt: now,
			gridPosition,
		};
		const nextOccupant: DeskCardRecord = {
			...(occupant ?? {
				path: occupantPath,
				addedAt: now,
				updatedAt: now,
			}),
			path: occupantPath,
			updatedAt: now,
			gridPosition: occupantGridPosition,
		};

		await this.save({
			version: 1,
			cards: [...without, nextCard, nextOccupant],
		});
	}

	async removePath(path: string): Promise<void> {
		const current = this.getSnapshot();
		const cards = current.cards.filter((card) => card.path !== path);

		if (cards.length === current.cards.length) {
			return;
		}

		await this.save({ version: 1, cards });
	}

	async clear(): Promise<void> {
		await this.save({ version: 1, cards: [] });
	}

	async handleRename(oldPath: string, newPath: string): Promise<void> {
		const current = this.getSnapshot();
		let changed = false;
		const now = Date.now();
		const seen = new Set<string>();
		const cards: DeskCardRecord[] = [];

		for (const card of current.cards) {
			const path = card.path === oldPath ? newPath : card.path;
			if (card.path === oldPath) {
				changed = true;
			}
			if (!path || seen.has(path)) {
				changed = true;
				continue;
			}
			seen.add(path);
			cards.push({
				...card,
				path,
				updatedAt: card.path === oldPath ? now : card.updatedAt,
			});
		}

		if (changed) {
			await this.save({ version: 1, cards });
		}
	}

	private async save(state: DeskState): Promise<void> {
		await this.plugin.settingsManager.update("desk", state);
		for (const listener of this.listeners) {
			listener(state);
		}
	}
}
