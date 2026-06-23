import { Component, TFile, type App } from "obsidian";

export type VaultContentChangeListener = (changedFile: TFile, oldPath?: string) => void;

class FileContentVaultEventHub {
	private component: Component | null = null;
	private listeners = new Set<VaultContentChangeListener>();

	constructor(private readonly app: App) {}

	subscribe(listener: VaultContentChangeListener): () => void {
		this.listeners.add(listener);
		this.ensureStarted();

		return () => {
			this.listeners.delete(listener);

			if (this.listeners.size === 0) {
				this.stop();
			}
		};
	}

	private ensureStarted(): void {
		if (this.component) {
			return;
		}

		const component = new Component();
		const emit = (changedFile: unknown, oldPath?: string): void => {
			if (!(changedFile instanceof TFile)) {
				return;
			}

			for (const listener of this.listeners) {
				listener(changedFile, oldPath);
			}
		};

		component.registerEvent(
			this.app.vault.on("modify", (changedFile) => {
				emit(changedFile);
			}),
		);
		component.registerEvent(
			this.app.vault.on("create", (changedFile) => {
				emit(changedFile);
			}),
		);
		component.registerEvent(
			this.app.vault.on("delete", (changedFile) => {
				emit(changedFile);
			}),
		);
		component.registerEvent(
			this.app.vault.on("rename", (changedFile, oldPath) => {
				emit(changedFile, oldPath);
			}),
		);

		this.component = component;
	}

	private stop(): void {
		this.component?.unload();
		this.component = null;
	}
}

const hubByApp = new WeakMap<App, FileContentVaultEventHub>();

export function getFileContentVaultEventHub(app: App): FileContentVaultEventHub {
	let hub = hubByApp.get(app);

	if (!hub) {
		hub = new FileContentVaultEventHub(app);
		hubByApp.set(app, hub);
	}

	return hub;
}
