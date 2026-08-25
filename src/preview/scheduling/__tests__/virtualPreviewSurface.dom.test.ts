import type { TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "settings/model";
import type {
	CardPreviewRenderer,
	PreviewRenderCallbacks,
} from "preview/ui/cardPreviewRenderer";
import type { CardPreviewRequest } from "preview/pipeline/cardPreviewRequest";
import { createPreviewRenderSettings } from "preview/pipeline/previewRenderSettings";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import { createVirtualPreviewSurface } from "../virtualPreviewSurface";
import {
	createPreviewActivationScheduler,
	type PreviewActivationScheduler,
} from "../previewActivationScheduler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestVirtualFrameCoordinator } from "testing/testVirtualFrameCoordinator";

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
	return { slotId, rowIndex, request: request(identity) };
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

function createManualActivationQueue(): {
	readonly scheduler: PreviewActivationScheduler;
	pendingKeys(): string[];
	activateNext(): string | undefined;
} {
	interface ManualRequest {
		readonly key: string;
		readonly onActivated: (() => void) | undefined;
		settled: boolean;
	}

	const requests: ManualRequest[] = [];
	const settleAll = (): void => {
		for (const request of requests) request.settled = true;
	};
	const scope = {
		request: (key: string, onActivated?: () => void) => {
			const request: ManualRequest = { key, onActivated, settled: false };
			requests.push(request);
			return {
				key,
				cancel(): void {
					request.settled = true;
				},
			};
		},
		dispose: settleAll,
	};
	const scheduler: PreviewActivationScheduler = {
		createScope: () => scope,
		dispose: settleAll,
	};

	return {
		scheduler,
		pendingKeys: () =>
			requests
				.filter((request) => !request.settled)
				.map((request) => request.key),
		activateNext(): string | undefined {
			const request = requests.find((candidate) => !candidate.settled);
			if (!request) return undefined;
			request.settled = true;
			request.onActivated?.();
			return request.key;
		},
	};
}

function createHarness(
	frameCoordinator: VirtualFrameCoordinator = createTestVirtualFrameCoordinator(),
	activationScheduler = createPreviewActivationScheduler(),
): {
	surface: Surface;
	renders: RenderRecord[];
} {
	const renders: RenderRecord[] = [];
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
		actualSurface.publish({
			bindings: [...bindings.values()].map((card) => ({
				key: card.slotId,
				rowIndex: card.rowIndex,
				request: card.request,
			})),
			activeRange: nextWindow.previewRange,
			active: nextWindow.active,
		});
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
	attachment: "detachable" | "host-bound" = "detachable",
): boolean {
	if (record.isCancelled()) return false;
	const content = document.createElement("span");
	content.textContent = record.identity;
	record.container.replaceChildren(content);
	record.callbacks.onCommitted("text", attachment);
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

		expect(schedule).toHaveBeenCalledTimes(2);
		expect(schedule).toHaveBeenCalledWith(
			"post-paint",
			"virtual-preview-surface:flush",
			expect.any(Function),
		);
		surface.dispose();
	});

	it("applies only the latest snapshot published before the post-paint flush", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot-0", host);

		enter(surface, binding("slot-0", 0, "superseded"));
		rebind(surface, binding("slot-0", 0, "latest"));
		await flushActivation();

		expect(renders.map((render) => render.identity)).toEqual(["latest"]);
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

	it("rejects a committed-frame render after its host lease is remounted", async () => {
		const { surface, renders } = createHarness();
		const oldHost = document.createElement("div");
		const hostLease = surface.registerHost("slot-0", oldHost);
		const card = binding("slot-0", 0, "a");
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

	it("keeps committed content visible while a changed request is staged", async () => {
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
		expect(host.classList.contains("is-stale")).toBe(false);

		await flushActivation();
		await flushActivation();
		expect(renders[0].cleanup).toHaveBeenCalledOnce();
		expect(renders.at(-1)?.identity).toBe("c");
		expect(host.textContent).toBe("a");
		expect(host.classList.contains("is-stale")).toBe(false);
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

	it("does not restart rendering for a new request object with the same render key", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		const first = binding("slot-0", 0, "stable-render");
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

	it("activates queued previews bottom-to-top when the preview range moves backward", async () => {
		const activationQueue = createManualActivationQueue();
		const { surface, renders } = createHarness(
			undefined,
			activationQueue.scheduler,
		);
		const initialCards = [
			binding("slot-10", 10, "row-10"),
			binding("slot-11", 11, "row-11"),
			binding("slot-12-left", 12, "row-12-left"),
			binding("slot-12-right", 12, "row-12-right"),
			binding("slot-13", 13, "row-13"),
		];
		for (const card of initialCards) {
			surface.registerHost(card.slotId, document.createElement("div"));
		}

		surface.publish({
			previewBindingsBySlot: new Map(
				initialCards.map((card) => [card.slotId, card]),
			),
			previewWindow: {
				previewRange: { start: 10, end: 14 },
				active: true,
			},
		});
		await flushActivation();
		expect(activationQueue.pendingKeys()).toEqual([
			"slot-10",
			"slot-11",
			"slot-12-left",
			"slot-12-right",
			"slot-13",
		]);

		expect(activationQueue.activateNext()).toBe("slot-10");
		expect(renders.map((render) => render.identity)).toEqual(["row-10"]);

		const newlyEntered = binding("slot-9", 9, "row-9");
		surface.registerHost(newlyEntered.slotId, document.createElement("div"));
		const backwardCards = [newlyEntered, ...initialCards];
		surface.publish({
			previewBindingsBySlot: new Map(
				backwardCards.map((card) => [card.slotId, card]),
			),
			previewWindow: {
				previewRange: { start: 9, end: 14 },
				active: true,
			},
		});
		await flushActivation();

		expect(activationQueue.pendingKeys()).toEqual([
			"slot-13",
			"slot-12-left",
			"slot-12-right",
			"slot-11",
			"slot-9",
		]);
		expect(activationQueue.activateNext()).toBe("slot-13");
		expect(activationQueue.activateNext()).toBe("slot-12-left");
		expect(activationQueue.activateNext()).toBe("slot-12-right");
		expect(activationQueue.activateNext()).toBe("slot-11");
		expect(activationQueue.activateNext()).toBe("slot-9");
		expect(renders.map((render) => render.identity)).toEqual([
			"row-10",
			"row-13",
			"row-12-left",
			"row-12-right",
			"row-11",
			"row-9",
		]);
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
		expect(host.classList.contains("is-stale")).toBe(false);

		surface.setPreviewWindow({
			previewRange: { start: 0, end: 1 },
			active: true,
		});
		await flushActivation();
		expect(renders).toHaveLength(1);
		surface.dispose();
	});

	it("unloads and idle-clears host-bound DOM on deactivation", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot-0", host);
		enter(surface, binding("slot-0", 0, "a"));
		await flushActivation();
		commit(renders[0], "host-bound");

		surface.setPreviewWindow({
			previewRange: { start: 1, end: 2 },
			active: true,
		});
		await flushActivation();
		expect(host.classList.contains("is-stale")).toBe(true);

		await vi.runAllTimersAsync();
		expect(renders[0].cleanup).toHaveBeenCalledOnce();
		expect(host.childNodes).toHaveLength(0);
		expect(host.classList.contains("cosense-card-links__box-preview--dom")).toBe(
			false,
		);
		surface.dispose();
	});

	it("cancels host-bound idle cleanup when the slot is reactivated", async () => {
		const { surface, renders } = createHarness();
		const host = document.createElement("div");
		surface.registerHost("slot-0", host);
		enter(surface, binding("slot-0", 0, "a"));
		await flushActivation();
		commit(renders[0], "host-bound");

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
