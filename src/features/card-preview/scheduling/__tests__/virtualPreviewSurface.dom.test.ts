import type { TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "features/settings/model";
import type {
	CardPreviewRenderer,
	PreviewRenderCallbacks,
} from "features/card-preview/ui/cardPreviewRenderer";
import type { CardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";
import { createPreviewRenderSettings } from "features/card-preview/core/previewRenderSettings";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import { createVirtualPreviewSurface } from "../virtualPreviewSurface";
import { createPreviewActivationScheduler } from "../previewActivationScheduler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FRAME_INTERVAL_MS = 1000 / 60;

interface RenderRecord {
	readonly container: HTMLElement;
	readonly identity: string;
	readonly callbacks: PreviewRenderCallbacks;
	readonly cleanup: ReturnType<typeof vi.fn>;
	readonly isCancelled: () => boolean;
}

interface RowPreviewCardBinding {
	readonly slotId: string;
	readonly rowIndex: number;
	readonly request: CardPreviewRequest;
	readonly ownerKey: string;
}

interface PreviewFrame {
	readonly previewBindingsBySlot: ReadonlyMap<string, RowPreviewCardBinding>;
	readonly previewWindow: {
		readonly previewRange: { readonly start: number; readonly end: number };
		readonly active: boolean;
	};
}

function request(identity: string): CardPreviewRequest {
	return {
		renderKey: identity,
		previewContentKey: `content:${identity}`,
		previewCacheRevision: "0:0",
		file: {
			path: `${identity}.md`,
			basename: identity,
			extension: "md",
			stat: { mtime: 1 },
		} as TFile,
		searchQuery: "",
		previewOverride: null,
		settings: createPreviewRenderSettings(DEFAULT_SETTINGS),
	};
}

function binding(
	slotId: string,
	rowIndex: number,
	identity: string,
): RowPreviewCardBinding {
	return { slotId, rowIndex, request: request(identity), ownerKey: identity };
}

function committedFrame(card: RowPreviewCardBinding): PreviewFrame {
	return {
		previewBindingsBySlot: new Map([[card.slotId, card]]),
		previewWindow: {
			previewRange: { start: card.rowIndex, end: card.rowIndex + 1 },
			active: true,
		},
	};
}

type Surface = ReturnType<typeof createVirtualPreviewSurface> & {
	publish(frame: PreviewFrame): void;
	commitBindingDelta(
		delta: {
			readonly enteredSlots: readonly RowPreviewCardBinding[];
			readonly reboundSlots: readonly RowPreviewCardBinding[];
			readonly releasedSlots: readonly string[];
		},
		window: {
			readonly previewRange: {
				readonly start: number;
				readonly end: number;
			};
			readonly active: boolean;
		},
	): void;
	syncBindingDelta(delta: {
		readonly enteredSlots: readonly RowPreviewCardBinding[];
		readonly reboundSlots: readonly RowPreviewCardBinding[];
		readonly releasedSlots: readonly string[];
	}): void;
	setPreviewWindow(window: {
		readonly previewRange: { readonly start: number; readonly end: number };
		readonly active: boolean;
	}): void;
	acceptCommittedFrame(source: { readonly current: PreviewFrame }): void;
};

function createHarness(frameCoordinator?: VirtualFrameCoordinator): {
	surface: Surface;
	renders: RenderRecord[];
} {
	const renders: RenderRecord[] = [];
	const activationScheduler = createPreviewActivationScheduler();
	const actualSurface = createVirtualPreviewSurface({
		frameCoordinator,
		activationScheduler,
		createRenderer: (): CardPreviewRenderer => {
			return (container, previewRequest, callbacks) => {
				if (!callbacks) throw new TypeError("Missing surface callbacks");
				let cancelled = false;
				const cleanup = vi.fn(() => {
					cancelled = true;
				});
				renders.push({
					container,
					identity: previewRequest.renderKey,
					callbacks,
					cleanup,
					isCancelled: () => cancelled,
				});
				return cleanup;
			};
		},
	});
	let bindings = new Map<string, RowPreviewCardBinding>();
	let previewWindow = {
		previewRange: { start: 0, end: 0 },
		active: false,
	};
	const publish = (
		nextBindings: ReadonlyMap<string, RowPreviewCardBinding>,
		nextWindow: typeof previewWindow,
	): void => {
		bindings = new Map(nextBindings);
		previewWindow = nextWindow;
		actualSurface.beginBindings();
		try {
			for (const card of bindings.values()) {
				actualSurface.bindSlot(
					card.slotId,
					card.rowIndex,
					card.ownerKey,
					card.request,
				);
			}
		} finally {
			actualSurface.endBindings();
		}
		actualSurface.setActiveRange(
			nextWindow.previewRange.start,
			nextWindow.previewRange.end,
			nextWindow.active,
		);
	};
	const applyDelta = (
		delta: {
			readonly enteredSlots: readonly RowPreviewCardBinding[];
			readonly reboundSlots: readonly RowPreviewCardBinding[];
			readonly releasedSlots: readonly string[];
		},
		nextWindow: typeof previewWindow,
	): void => {
		const nextBindings = new Map(bindings);
		for (const slotId of delta.releasedSlots) nextBindings.delete(slotId);
		for (const binding of [...delta.enteredSlots, ...delta.reboundSlots]) {
			nextBindings.set(binding.slotId, binding);
		}
		publish(nextBindings, nextWindow);
	};
	const surface = {
		...actualSurface,
		publish: (frame: PreviewFrame) =>
			publish(frame.previewBindingsBySlot, frame.previewWindow),
		commitBindingDelta: (
			delta: Parameters<typeof applyDelta>[0],
			window: typeof previewWindow,
		) => applyDelta(delta, window),
		syncBindingDelta: (delta: Parameters<typeof applyDelta>[0]) =>
			applyDelta(delta, previewWindow),
		setPreviewWindow: (window: typeof previewWindow) =>
			applyDelta(
				{ enteredSlots: [], reboundSlots: [], releasedSlots: [] },
				window,
			),
		acceptCommittedFrame: (source: { readonly current: PreviewFrame }) => {
			const frame = source.current;
			publish(frame.previewBindingsBySlot, frame.previewWindow);
		},
		dispose: () => {
			actualSurface.dispose();
			activationScheduler.dispose();
		},
	} as Surface;
	return { surface, renders };
}

function enter(surface: Surface, card: RowPreviewCardBinding): void {
	surface.commitBindingDelta(
		{ enteredSlots: [card], reboundSlots: [], releasedSlots: [] },
		{
			previewRange: { start: card.rowIndex, end: card.rowIndex + 1 },
			active: true,
		},
	);
}

function rebind(surface: Surface, card: RowPreviewCardBinding): void {
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
	if (record.isCancelled()) return false;
	const content = document.createElement("span");
	content.textContent = record.identity;
	record.container.replaceChildren(content);
	record.callbacks.onCommitted("text", retention);
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
			"virtual-preview-surface:flush",
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
		await flushActivation();
		expect(renders[0].cleanup).toHaveBeenCalledOnce();
		expect(commit(renders[0])).toBe(false);
		await flushActivation();
		expect(commit(renders[1])).toBe(true);
		expect(host.textContent).toBe("b");
		surface.dispose();
	});

	it("uses the current committed frame to reject an old preview owner", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot-0", host);
		const firstOwnerKey = "owner-a";
		const secondOwnerKey = "owner-b";
		const firstBinding = {
			...binding("slot-0", 0, "same-cache-identity"),
			ownerKey: firstOwnerKey,
		};
		let current = committedFrame(firstBinding);
		const source = {
			get current() {
				return current;
			},
		};
		surface.acceptCommittedFrame(source);
		await flushActivation();

		const secondBinding = {
			...binding("slot-0", 0, "same-cache-identity"),
			ownerKey: secondOwnerKey,
		};
		current = committedFrame(secondBinding);
		surface.acceptCommittedFrame(source);

		await flushActivation();
		expect(commit(renders[0])).toBe(false);
		expect(commit(renders[1])).toBe(true);
		surface.dispose();
	});

	it("rejects a committed-frame render after its host lease is remounted", async () => {
		const { surface, renders } = createHarness();
		const oldHost = document.createElement("div");
		const hostLease = surface.registerHost("slot-0", oldHost);
		const card = {
			...binding("slot-0", 0, "a"),
			ownerKey: "a",
		};
		const current = committedFrame(card);
		surface.acceptCommittedFrame({ current });
		await flushActivation();

		hostLease.dispose();
		const newHost = document.createElement("div");
		surface.registerHost("slot-0", newHost);
		await flushActivation();

		expect(commit(renders[0])).toBe(false);
		expect(commit(renders[1])).toBe(true);
		expect(oldHost.childNodes).toHaveLength(0);
		expect(newHost.textContent).toBe("a");
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

		expect(renders[0].cleanup).toHaveBeenCalledOnce();
		expect(host.textContent).toBe("a");
		expect(host.classList.contains("is-stale")).toBe(true);

		await flushActivation();
		await flushActivation();
		expect(renders[0].cleanup).toHaveBeenCalledOnce();
		expect(renders.at(-1)?.identity).toBe("c");
		surface.dispose();
	});

	it("restores an invalidated binding after a staged A to B to A rollback", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		const originalBinding = binding("slot-0", 0, "a");
		const originalFrame = committedFrame(originalBinding);
		surface.registerHost("slot-0", host);
		surface.publish(originalFrame);
		await flushActivation();
		expect(renders.map((record) => record.identity)).toEqual(["a"]);

		surface.publish(committedFrame(binding("slot-0", 0, "b")));
		surface.publish(originalFrame);
		await flushActivation();
		await flushActivation();
		expect(renders.map((record) => record.identity)).toEqual(["a", "a"]);
		expect(commit(renders[0])).toBe(false);
		expect(commit(renders[1])).toBe(true);
		expect(host.textContent).toBe("a");
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

	it("detects rebind when the caller publishes a new immutable binding object", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot-0", host);
		const firstBinding = binding("slot-0", 0, "a");
		enter(surface, firstBinding);
		await flushActivation();

		const reboundBinding = binding("slot-0", 0, "b");
		rebind(surface, reboundBinding);
		expect(firstBinding.request.renderKey).toBe("a");
		await flushActivation();
		expect(renders[0].cleanup).toHaveBeenCalledOnce();
		await flushActivation();
		expect(commit(renders[0])).toBe(false);
		expect(commit(renders[1])).toBe(true);
		expect(host.textContent).toBe("b");
		surface.dispose();
	});

	it("does not restart rendering for a new request object with the same owner and render key", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		const ownerKey = "stable-owner";
		const first = {
			...binding("slot-0", 0, "stable-render"),
			ownerKey,
		};
		surface.registerHost("slot-0", host);
		enter(surface, first);
		await flushActivation();

		const next = {
			...first,
			request: { ...first.request },
		};
		rebind(surface, next);
		await flushActivation();

		expect(renders).toHaveLength(1);
		expect(renders[0].cleanup).not.toHaveBeenCalled();
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

	it("does not schedule a flush for an unchanged binding pass and range", () => {
		const schedule = vi.fn(() => true);
		const frameCoordinator: VirtualFrameCoordinator = {
			schedule,
			cancel: vi.fn(),
			isScheduled: vi.fn(() => false),
			dispose: vi.fn(),
		};
		const { surface } = createHarness(frameCoordinator);
		const card = binding("slot-0", 0, "a");
		enter(surface, card);
		schedule.mockClear();

		surface.commitBindingDelta(
			{ enteredSlots: [], reboundSlots: [], releasedSlots: [] },
			{ previewRange: { start: 0, end: 1 }, active: true },
		);

		expect(schedule).not.toHaveBeenCalled();
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
		await flushActivation();
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
		expect(renders).toHaveLength(1);
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

	it("does not touch a host registered after disposal", () => {
		const { surface } = createHarness();
		const host = document.createElement("div");
		surface.dispose();

		const lease = surface.registerHost("slot-after-dispose", host);
		lease.dispose();

		expect(host.attributes).toHaveLength(0);
		expect(host.childNodes).toHaveLength(0);
	});
});
