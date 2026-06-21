import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import {
	getFileContentVaultEventHub,
	type VaultContentChangeListener,
} from "../fileContentVaultEventHub";

const obsidianMockState = vi.hoisted(() => ({
	componentUnloads: [] as Array<ReturnType<typeof vi.fn>>,
	registrations: [] as Array<{ active: boolean }>,
}));

vi.mock("obsidian", () => {
	class MockComponent {
		private registrations: Array<{ active: boolean }> = [];
		unloadFn = vi.fn();

		constructor() {
			obsidianMockState.componentUnloads.push(this.unloadFn);
		}

		registerEvent(registration: { active: boolean }) {
			this.registrations.push(registration);
		}

		unload() {
			this.unloadFn();
			for (const reg of this.registrations) {
				reg.active = false;
			}
		}
	}

	class MockTFile {
		path = "";
		name = "";
		basename = "";
		extension = "";
		stat = { ctime: 0, mtime: 0, size: 0 };
	}

	return {
		Component: MockComponent,
		TFile: MockTFile,
	};
});

type VaultEventName = "modify" | "create" | "delete" | "rename";

function createMockApp(): {
	app: App;
	triggerEvent: (eventName: VaultEventName, ...args: unknown[]) => void;
} {
	const callbacks: Array<{
		eventName: VaultEventName;
		callback: (...args: unknown[]) => void;
		registration: { active: boolean };
	}> = [];

	const on = vi.fn(
		(eventName: VaultEventName, callback: (...args: unknown[]) => void) => {
			const registration = { active: true };
			obsidianMockState.registrations.push(registration);
			const entry = { eventName, callback, registration };
			callbacks.push(entry);
			return registration;
		},
	);

	return {
		app: {
			vault: {
				on,
			},
		} as unknown as App,
		triggerEvent: (eventName: VaultEventName, ...args: unknown[]) => {
			for (const entry of callbacks) {
				if (entry.eventName === eventName && entry.registration.active) {
					entry.callback(...args);
				}
			}
		},
	};
}

afterEach(() => {
	obsidianMockState.componentUnloads.length = 0;
	obsidianMockState.registrations.length = 0;
	vi.clearAllMocks();
});

describe("fileContentVaultEventHub", () => {
	it("multiple subscribers on the same vault do not cause duplicate notifications", () => {
		const { app, triggerEvent } = createMockApp();
		const hub = getFileContentVaultEventHub(app);
		const listenerA = vi.fn<VaultContentChangeListener>();
		const listenerB = vi.fn<VaultContentChangeListener>();
		const file = createMockTFile("notes/shared.md");

		hub.subscribe(listenerA);
		hub.subscribe(listenerB);

		triggerEvent("modify", file);

		expect(listenerA).toHaveBeenCalledTimes(1);
		expect(listenerA).toHaveBeenCalledWith(file, undefined);
		expect(listenerB).toHaveBeenCalledTimes(1);
		expect(listenerB).toHaveBeenCalledWith(file, undefined);
	});

	it("does not notify after unsubscribe", () => {
		const { app, triggerEvent } = createMockApp();
		const hub = getFileContentVaultEventHub(app);
		const listener = vi.fn<VaultContentChangeListener>();
		const file = createMockTFile("notes/test.md");

		const unsubscribe = hub.subscribe(listener);

		triggerEvent("create", file);
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		vi.clearAllMocks();

		triggerEvent("create", file);
		expect(listener).not.toHaveBeenCalled();
	});

	it("cleans up when the last subscriber is removed", () => {
		const { app } = createMockApp();
		const hub = getFileContentVaultEventHub(app);

		const unsubscribeA = hub.subscribe(vi.fn<VaultContentChangeListener>());
		const unsubscribeB = hub.subscribe(vi.fn<VaultContentChangeListener>());

		unsubscribeA();
		expect(obsidianMockState.componentUnloads[0]).not.toHaveBeenCalled();

		unsubscribeB();
		expect(obsidianMockState.componentUnloads[0]).toHaveBeenCalledTimes(1);
	});

	it("notifies after resubscribing", () => {
		const { app, triggerEvent } = createMockApp();
		const hub = getFileContentVaultEventHub(app);
		const listener = vi.fn<VaultContentChangeListener>();
		const file = createMockTFile("notes/return.md");

		const unsubscribe = hub.subscribe(listener);
		unsubscribe();

		const unsubscribeSecond = hub.subscribe(listener);

		triggerEvent("delete", file);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(file, undefined);

		unsubscribeSecond();
	});

	it("rename event passes oldPath as well", () => {
		const { app, triggerEvent } = createMockApp();
		const hub = getFileContentVaultEventHub(app);
		const listener = vi.fn<VaultContentChangeListener>();
		const file = createMockTFile("notes/new-name.md");

		hub.subscribe(listener);

		triggerEvent("rename", file, "notes/old-name.md");

		expect(listener).toHaveBeenCalledWith(file, "notes/old-name.md");
	});
});
