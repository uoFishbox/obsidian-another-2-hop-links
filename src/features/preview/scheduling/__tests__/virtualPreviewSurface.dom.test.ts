import type { TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "features/settings/model";
import type {
	CardPreviewRenderer,
	PreviewRenderCallbacks,
} from "features/preview/ui/cardPreviewRenderer";
import type { CardPreviewSnapshot } from "features/preview/ui/cardPreviewSnapshot";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import {
	createVirtualPreviewSurface,
	type RowPreviewCardBinding,
} from "../virtualPreviewSurface";
import { resetPreviewActivationSchedulerForTests } from "../previewActivationScheduler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FRAME_INTERVAL_MS = 1000 / 60;

interface RenderRecord {
	readonly container: HTMLElement;
	readonly identity: string;
	readonly callbacks: PreviewRenderCallbacks;
	readonly cleanup: ReturnType<typeof vi.fn>;
}

function snapshot(identity: string): CardPreviewSnapshot {
	return {
		identity,
		file: {
			path: `${identity}.md`,
			basename: identity,
			extension: "md",
			stat: { mtime: 1 },
		} as TFile,
		searchQuery: "",
		previewRefreshToken: 0,
		previewOverride: null,
	};
}

function binding(
	slotId: string,
	rowIndex: number,
	identity: string,
): RowPreviewCardBinding {
	return { slotId, rowIndex, snapshot: snapshot(identity) };
}

function createHarness(frameCoordinator?: VirtualFrameCoordinator) {
	const renders: RenderRecord[] = [];
	const surface = createVirtualPreviewSurface({
		getSettings: () => DEFAULT_SETTINGS,
		getPreviewRenderVersion: () => "0:0",
		frameCoordinator,
		createRenderer: (): CardPreviewRenderer => {
			return (container, _request, identity, callbacks) => {
				if (!callbacks) throw new TypeError("Missing surface callbacks");
				const cleanup = vi.fn();
				renders.push({ container, identity, callbacks, cleanup });
				callbacks.onLoadingChange(true);
				return cleanup;
			};
		},
	});
	return { surface, renders };
}

function enter(
	surface: ReturnType<typeof createVirtualPreviewSurface>,
	card: RowPreviewCardBinding,
): void {
	surface.commitBindingDelta(
		{ enteredSlots: [card], reboundSlots: [], releasedSlots: [] },
		{
			previewRange: { start: card.rowIndex, end: card.rowIndex + 1 },
			active: true,
		},
	);
}

function rebind(
	surface: ReturnType<typeof createVirtualPreviewSurface>,
	card: RowPreviewCardBinding,
): void {
	surface.syncBindingDelta({
		enteredSlots: [],
		reboundSlots: [card],
		releasedSlots: [],
	});
}

function commit(
	record: RenderRecord,
	retention: "resident" | "lifecycle-bound" = "resident",
): boolean {
	if (!record.callbacks.isCurrent()) return false;
	const content = document.createElement("span");
	content.textContent = record.identity;
	record.container.replaceChildren(content);
	record.callbacks.onCommitted("text", retention);
	record.callbacks.onRendered();
	return true;
}

async function flushActivation(): Promise<void> {
	await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS);
	await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS);
	await Promise.resolve();
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) =>
			setTimeout(() => callback(FRAME_INTERVAL_MS), FRAME_INTERVAL_MS),
		),
	);
	vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
});

afterEach(() => {
	resetPreviewActivationSchedulerForTests();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("VirtualPreviewSurface", () => {
	it("schedules one keyed post-paint flush for multiple commits", () => {
		const schedule = vi.fn(() => true);
		const frameCoordinator: VirtualFrameCoordinator = {
			schedule,
			cancel: vi.fn(),
			isScheduled: vi.fn(() => false),
			dispose: vi.fn(),
		};
		const { surface } = createHarness(frameCoordinator);

		enter(surface, binding("slot-0", 0, "a"));
		surface.commitBindingDelta(
			{
				enteredSlots: [],
				reboundSlots: [binding("slot-0", 0, "b")],
				releasedSlots: [],
			},
			{ previewRange: { start: 0, end: 1 }, active: true },
		);

		expect(schedule).toHaveBeenCalledOnce();
		expect(schedule).toHaveBeenCalledWith(
			"post-paint",
			"two-hop:preview-sidecar-flush",
			expect.any(Function),
		);
		surface.dispose();
	});

	it("rejects an old render after the physical slot is rebound", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot-0", host);
		enter(surface, binding("slot-0", 0, "a"));
		await flushActivation();

		rebind(surface, binding("slot-0", 0, "b"));
		expect(renders[0].cleanup).toHaveBeenCalledOnce();
		expect(commit(renders[0])).toBe(false);
		await flushActivation();
		expect(commit(renders[1])).toBe(true);
		expect(host.textContent).toBe("b");
		surface.dispose();
	});

	it("invalidates and hides a rebound slot before post-paint cleanup", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot-0", host);
		enter(surface, binding("slot-0", 0, "a"));
		await flushActivation();
		expect(commit(renders[0])).toBe(true);

		surface.commitBindingDelta(
			{
				enteredSlots: [],
				reboundSlots: [binding("slot-0", 0, "b")],
				releasedSlots: [],
			},
			{ previewRange: { start: 0, end: 1 }, active: true },
		);
		surface.commitBindingDelta(
			{
				enteredSlots: [],
				reboundSlots: [binding("slot-0", 0, "c")],
				releasedSlots: [],
			},
			{ previewRange: { start: 0, end: 1 }, active: true },
		);

		expect(renders[0].callbacks.isCurrent()).toBe(false);
		expect(renders[0].cleanup).not.toHaveBeenCalled();
		expect(host.textContent).toBe("a");
		expect(host.classList.contains("is-stale")).toBe(true);

		await flushActivation();
		await flushActivation();
		expect(renders[0].cleanup).toHaveBeenCalledOnce();
		expect(renders.at(-1)?.identity).toBe("c");
		surface.dispose();
	});

	it("coalesces staged deltas per slot without losing an earlier release", async () => {
		const { surface, renders } = createHarness();
		const firstHost = document.createElement("div");
		const secondHost = document.createElement("div");
		surface.registerHost("slot-0", firstHost);
		surface.registerHost("slot-1", secondHost);
		surface.commitBindingDelta(
			{
				enteredSlots: [binding("slot-0", 0, "a"), binding("slot-1", 1, "b")],
				reboundSlots: [],
				releasedSlots: [],
			},
			{ previewRange: { start: 0, end: 2 }, active: true },
		);
		await flushActivation();
		expect(commit(renders[0])).toBe(true);
		expect(commit(renders[1])).toBe(true);

		surface.commitBindingDelta(
			{
				enteredSlots: [],
				reboundSlots: [binding("slot-1", 1, "c")],
				releasedSlots: ["slot-0"],
			},
			{ previewRange: { start: 0, end: 2 }, active: true },
		);
		surface.commitBindingDelta(
			{
				enteredSlots: [],
				reboundSlots: [binding("slot-1", 1, "d")],
				releasedSlots: [],
			},
			{ previewRange: { start: 0, end: 2 }, active: true },
		);

		expect(firstHost.textContent).toBe("a");
		expect(secondHost.textContent).toBe("b");
		await flushActivation();
		await flushActivation();

		expect(firstHost.childNodes).toHaveLength(0);
		expect(renders[1].cleanup).toHaveBeenCalledOnce();
		expect(renders.map((record) => record.identity)).not.toContain("c");
		surface.dispose();
	});

	it("lets a later binding overwrite a staged release of the same slot", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot-0", host);
		enter(surface, binding("slot-0", 0, "a"));
		await flushActivation();
		expect(commit(renders[0])).toBe(true);

		surface.commitBindingDelta(
			{ enteredSlots: [], reboundSlots: [], releasedSlots: ["slot-0"] },
			{ previewRange: { start: 0, end: 1 }, active: true },
		);
		surface.commitBindingDelta(
			{
				enteredSlots: [binding("slot-0", 0, "b")],
				reboundSlots: [],
				releasedSlots: [],
			},
			{ previewRange: { start: 0, end: 1 }, active: true },
		);
		await flushActivation();

		expect(renders.map((record) => record.identity)).toEqual(["a", "b"]);
		expect(host.classList.contains("is-stale")).toBe(true);
		expect(commit(renders[1])).toBe(true);
		expect(host.textContent).toBe("b");
		surface.dispose();
	});

	it("detects rebind when the caller reuses a mutable binding object", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot-0", host);
		const permanentBinding = binding("slot-0", 0, "a");
		enter(surface, permanentBinding);
		await flushActivation();

		permanentBinding.snapshot = snapshot("b");
		rebind(surface, permanentBinding);
		expect(renders[0].cleanup).toHaveBeenCalledOnce();
		await flushActivation();
		expect(commit(renders[0])).toBe(false);
		expect(commit(renders[1])).toBe(true);
		expect(host.textContent).toBe("b");
		surface.dispose();
	});

	it("never touches an unregistered or replaced host from an old render", async () => {
		const { surface, renders } = createHarness();
		const oldHost = document.createElement("div");
		const lease = surface.registerHost("slot-0", oldHost);
		enter(surface, binding("slot-0", 0, "a"));
		await flushActivation();
		lease.dispose();

		expect(commit(renders[0])).toBe(false);
		expect(oldHost.childNodes).toHaveLength(0);

		const newHost = document.createElement("div");
		surface.registerHost("slot-0", newHost);
		await flushActivation();
		expect(renders).toHaveLength(2);
		expect(commit(renders[0])).toBe(false);
		expect(commit(renders[1])).toBe(true);
		expect(newHost.textContent).toBe("a");
		surface.dispose();
	});

	it("cancels queued activation when a slot is released", async () => {
		const { surface, renders } = createHarness();
		surface.registerHost("slot-0", document.createElement("div"));
		enter(surface, binding("slot-0", 0, "a"));
		surface.syncBindingDelta({
			enteredSlots: [],
			reboundSlots: [],
			releasedSlots: ["slot-0"],
		});
		await flushActivation();

		expect(renders).toHaveLength(0);
		surface.dispose();
	});

	it("skips slot reconciliation when bindings and preview range are unchanged", () => {
		const { surface } = createHarness();
		const card = binding("slot-0", 0, "a");
		const cardSnapshot = card.snapshot;
		let snapshotReads = 0;
		Object.defineProperty(card, "snapshot", {
			configurable: true,
			get() {
				snapshotReads += 1;
				return cardSnapshot;
			},
		});
		surface.registerHost("slot-0", document.createElement("div"));
		enter(surface, card);
		snapshotReads = 0;

		surface.commitBindingDelta(
			{ enteredSlots: [], reboundSlots: [], releasedSlots: [] },
			{ previewRange: { start: 0, end: 1 }, active: true },
		);

		expect(snapshotReads).toBe(0);
		surface.dispose();
	});

	it("keeps and reuses resident DOM outside the preview range", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot-0", host);
		enter(surface, binding("slot-0", 0, "a"));
		await flushActivation();
		commit(renders[0]);

		surface.setPreviewWindow({
			previewRange: { start: 1, end: 2 },
			active: true,
		});
		expect(host.textContent).toBe("a");
		expect(host.dataset.previewState).toBe("committed");

		surface.setPreviewWindow({
			previewRange: { start: 0, end: 1 },
			active: true,
		});
		await flushActivation();
		expect(renders).toHaveLength(1);
		surface.dispose();
	});

	it("does not mutate host attributes when the applied state is unchanged", async () => {
		const { surface } = createHarness();
		const host = document.createElement("div");
		const attributeMutations: MutationRecord[] = [];
		const observer = new MutationObserver((records) => {
			attributeMutations.push(...records);
		});
		observer.observe(host, { attributes: true });
		surface.registerHost("slot-0", host);
		await Promise.resolve();
		attributeMutations.length = 0;

		surface.syncBindingDelta({
			enteredSlots: [],
			reboundSlots: [],
			releasedSlots: ["slot-0"],
		});
		await Promise.resolve();

		expect(attributeMutations).toEqual([]);
		observer.disconnect();
		surface.dispose();
	});

	it("unloads and idle-clears lifecycle-bound DOM on deactivation", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot-0", host);
		enter(surface, binding("slot-0", 0, "a"));
		await flushActivation();
		commit(renders[0], "lifecycle-bound");

		surface.setPreviewWindow({
			previewRange: { start: 1, end: 2 },
			active: true,
		});
		expect(renders[0].cleanup).toHaveBeenCalledOnce();
		expect(host.dataset.previewState).toBe("dormant");

		await vi.runAllTimersAsync();
		expect(host.childNodes).toHaveLength(0);
		expect(host.dataset.hasPreviewContent).toBeUndefined();
		surface.dispose();
	});

	it("cancels lifecycle idle cleanup when the slot is reactivated", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot-0", host);
		enter(surface, binding("slot-0", 0, "a"));
		await flushActivation();
		commit(renders[0], "lifecycle-bound");

		surface.setPreviewWindow({
			previewRange: { start: 1, end: 2 },
			active: true,
		});
		surface.setPreviewWindow({
			previewRange: { start: 0, end: 1 },
			active: true,
		});
		await flushActivation();

		expect(host.textContent).toBe("a");
		expect(renders).toHaveLength(2);
		surface.dispose();
	});

	it("invalidates math-like pending work and changed identities on rebind", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot-0", host);
		enter(surface, binding("slot-0", 0, "settings:v1"));
		await flushActivation();

		rebind(surface, binding("slot-0", 0, "settings:v2"));
		await flushActivation();
		expect(renders[0].callbacks.isCurrent()).toBe(false);
		expect(commit(renders[0])).toBe(false);
		expect(commit(renders[1])).toBe(true);
		expect(host.textContent).toBe("settings:v2");
		surface.dispose();
	});

	it("invalidates activation, callbacks, and commits after dispose", async () => {
		const pending = createHarness();
		pending.surface.registerHost("slot-0", document.createElement("div"));
		enter(pending.surface, binding("slot-0", 0, "queued"));
		pending.surface.dispose();
		await flushActivation();
		expect(pending.renders).toHaveLength(0);

		const active = createHarness();
		const host = document.createElement("div");
		active.surface.registerHost("slot-0", host);
		enter(active.surface, binding("slot-0", 0, "active"));
		await flushActivation();
		active.surface.dispose();
		expect(active.renders[0].cleanup).toHaveBeenCalledOnce();
		expect(commit(active.renders[0])).toBe(false);
		expect(host.childNodes).toHaveLength(0);
	});
});
