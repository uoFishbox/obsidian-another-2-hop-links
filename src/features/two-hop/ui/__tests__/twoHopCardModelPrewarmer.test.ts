import { describe, expect, it, vi } from "vitest";
import { createTwoHopCardModelPrewarmer } from "features/two-hop/ui/twoHopCardModelPrewarmer";
import type {
	TwoHopDocument,
	TwoHopDocumentItem,
	TwoHopDocumentSection,
} from "features/two-hop/ui/twoHopDocument";
import type { TwoHopVirtualListSection } from "features/two-hop/ui/twoHopVirtualListModel";
import type {
	VirtualFrameCoordinator,
	VirtualFrameLane,
} from "ui/virtualization/scheduling/frameCoordinator";
import { createDocumentRevision } from "features/two-hop/ui/twoHopRevisions";

function createCoordinatorHarness(): {
	readonly coordinator: VirtualFrameCoordinator;
	runIdle(): boolean;
	hasIdleTask(): boolean;
} {
	const tasks = new Map<string, () => void>();
	return {
		coordinator: {
			schedule(lane, key, task) {
				if (lane !== "idle" || tasks.has(key)) return false;
				tasks.set(key, task);
				return true;
			},
			cancel(lane: VirtualFrameLane, key: string) {
				if (lane === "idle") tasks.delete(key);
			},
			isScheduled: (lane, key) => lane === "idle" && tasks.has(key),
			dispose: () => tasks.clear(),
		},
		runIdle(): boolean {
			const entry = tasks.entries().next().value as
				| [string, () => void]
				| undefined;
			if (!entry) return false;
			tasks.delete(entry[0]);
			entry[1]();
			return true;
		},
		hasIdleTask: () => tasks.size > 0,
	};
}

function createDocument(
	itemCount: number,
	revision: number,
): {
	readonly document: TwoHopDocument;
	readonly items: readonly TwoHopDocumentItem[];
} {
	const items: TwoHopDocumentItem[] = Array.from(
		{ length: itemCount },
		(_, index) => ({
			kind: "primary-link",
			item: { type: "newLink" } as TwoHopDocumentItem["item"],
			sourceSectionId: "outgoing",
			searchKey: `item:${index}`,
			virtualKey: `item:${index}`,
		}),
	);
	const virtualSection: TwoHopVirtualListSection = {
		kind: "primary-section",
		rawSectionId: "outgoing",
		sectionId: "outgoing",
		sectionKey: "outgoing",
		title: "Outgoing",
	};
	const section = {
		key: "outgoing",
		sourceRevision: revision,
		header: {
			kind: "header",
			logicalKey: "header:outgoing",
			sectionId: "outgoing",
			section: virtualSection,
			props: {},
		},
		visibleItemCount: items.length,
		totalItemCount: items.length,
		getItem: (index: number) => items[index],
		loadMore: null,
	} as unknown as TwoHopDocumentSection;
	return {
		document: {
			revision: createDocumentRevision(revision),
			sections: [section],
		},
		items,
	};
}

function drain(runIdle: () => boolean): void {
	while (runIdle()) {
		// Drain the deterministic coordinator one chunk at a time.
	}
}

describe("createTwoHopCardModelPrewarmer", () => {
	it("warms a large document in bounded idle chunks", () => {
		const harness = createCoordinatorHarness();
		const { document, items } = createDocument(70, 1);
		const resolveItem = vi.fn();
		const prewarmer = createTwoHopCardModelPrewarmer({
			frameCoordinator: harness.coordinator,
			readNow: () => 0,
		});

		prewarmer.schedule(document, resolveItem);

		expect(resolveItem).not.toHaveBeenCalled();
		expect(harness.runIdle()).toBe(true);
		expect(resolveItem).toHaveBeenCalledTimes(32);
		expect(harness.hasIdleTask()).toBe(true);
		drain(harness.runIdle);
		expect(resolveItem).toHaveBeenCalledTimes(items.length);
		expect(resolveItem.mock.calls.map(([item]) => item)).toEqual(items);
	});

	it("replaces stale work when the document changes", () => {
		const harness = createCoordinatorHarness();
		const first = createDocument(70, 1);
		const second = createDocument(2, 2);
		const resolveFirst = vi.fn();
		const resolveSecond = vi.fn();
		const prewarmer = createTwoHopCardModelPrewarmer({
			frameCoordinator: harness.coordinator,
			readNow: () => 0,
		});

		prewarmer.schedule(first.document, resolveFirst);
		harness.runIdle();
		prewarmer.schedule(second.document, resolveSecond);
		drain(harness.runIdle);

		expect(resolveFirst).toHaveBeenCalledTimes(32);
		expect(resolveSecond).toHaveBeenCalledTimes(2);
	});

	it("cancels pending work when the resolver is removed", () => {
		const harness = createCoordinatorHarness();
		const { document } = createDocument(1, 1);
		const resolveItem = vi.fn();
		const prewarmer = createTwoHopCardModelPrewarmer({
			frameCoordinator: harness.coordinator,
		});

		prewarmer.schedule(document, resolveItem);
		prewarmer.cancel();

		expect(harness.hasIdleTask()).toBe(false);
		expect(resolveItem).not.toHaveBeenCalled();
	});

	it("cancels pending work when disposed", () => {
		const harness = createCoordinatorHarness();
		const { document } = createDocument(1, 1);
		const resolveItem = vi.fn();
		const prewarmer = createTwoHopCardModelPrewarmer({
			frameCoordinator: harness.coordinator,
		});

		prewarmer.schedule(document, resolveItem);
		prewarmer.dispose();

		expect(harness.hasIdleTask()).toBe(false);
		expect(harness.runIdle()).toBe(false);
		expect(resolveItem).not.toHaveBeenCalled();
	});
});
