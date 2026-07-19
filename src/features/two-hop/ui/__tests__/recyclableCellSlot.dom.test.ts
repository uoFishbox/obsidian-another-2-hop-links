import { describe, expect, it, vi } from "vitest";
import { createRecyclableCellSlot } from "features/two-hop/ui/recyclableCellSlot";

function createSlot() {
	const cell = document.createElement("div");
	const root = document.createElement("div");
	const previewHost = document.createElement("div");
	cell.append(root);
	root.append(previewHost);
	return {
		slot: createRecyclableCellSlot({ cell, root, previewHost }),
		cell,
		previewHost,
	};
}

function bind(slot: ReturnType<typeof createSlot>["slot"], identity: string) {
	slot.bindSkeleton(
		{
			logicalIdentity: identity,
			logicalRowIndex: 2,
			logicalColumnIndex: 1,
			renderRevision: 3,
		},
		{ preservePreview: false },
	);
	slot.promoteToRich({ cardModel: null });
}

describe("recyclable cell slot", () => {
	it("rejects retaining a rich binding for a different identity", () => {
		const { slot } = createSlot();
		bind(slot, "item:a");

		const retained = slot.retainRichBinding({
			logicalIdentity: "item:b",
			logicalRowIndex: 4,
			logicalColumnIndex: 0,
			renderRevision: 3,
		});

		expect(retained).toBe(false);
		expect(slot.logicalIdentity).toBe("item:a");
		expect(slot.logicalRowIndex).toBe(2);
		expect(slot.logicalColumnIndex).toBe(1);
		expect(slot.rich).toBe(true);
	});

	it("invalidates an enrichment token when the physical slot is rebound", () => {
		const { slot, previewHost } = createSlot();
		bind(slot, "item:a");
		const token = slot.beginEnrichment("preview:a");
		const disposePending = vi.fn();
		token.setDispose(disposePending);

		bind(slot, "item:b");

		expect(token.signal.aborted).toBe(true);
		expect(disposePending).toHaveBeenCalledOnce();
		expect(slot.commitEnrichment(token, document.createElement("strong"))).toBe(
			false,
		);
		expect(previewHost.childElementCount).toBe(0);
		expect(slot.logicalIdentity).toBe("item:b");
		expect(slot.previewStatus).toBe("empty");
	});

	it("disposes committed enrichment exactly once when the slot is unbound", () => {
		const { slot, cell, previewHost } = createSlot();
		bind(slot, "item:a");
		const token = slot.beginEnrichment("preview:a");
		const disposePreview = vi.fn();
		const content = document.createElement("strong");
		token.setDispose(disposePreview);

		expect(slot.commitEnrichment(token, content)).toBe(true);
		expect(slot.previewStatus).toBe("ready");
		expect(previewHost.firstChild).toBe(content);

		slot.unbind();
		slot.unbind();

		expect(disposePreview).toHaveBeenCalledOnce();
		expect(slot.logicalIdentity).toBeNull();
		expect(slot.rich).toBe(false);
		expect(slot.cardModel).toBeNull();
		expect(slot.previewStatus).toBe("empty");
		expect(cell.style.visibility).toBe("hidden");
	});

	it("installs replacement DOM before disposing the previous preview", () => {
		const { slot, previewHost } = createSlot();
		bind(slot, "item:a");
		const previousToken = slot.beginEnrichment("preview:a:previous");
		const previous = document.createElement("strong");
		let contentDuringDispose: Node | null = null;
		previousToken.setDispose(() => {
			contentDuringDispose = previewHost.firstChild;
		});
		expect(slot.commitEnrichment(previousToken, previous)).toBe(true);
		const replacementToken = slot.beginEnrichment("preview:a:replacement");
		const replacement = document.createElement("em");

		expect(slot.commitEnrichment(replacementToken, replacement)).toBe(true);

		expect(contentDuringDispose).toBe(replacement);
		expect(previewHost.firstChild).toBe(replacement);
	});

	it("finishes commit and unbind transitions when disposers throw", () => {
		const { slot, previewHost } = createSlot();
		const reportError = vi.spyOn(console, "error").mockImplementation(() => {});
		bind(slot, "item:a");
		const previousToken = slot.beginEnrichment("preview:a:previous");
		previousToken.setDispose(() => {
			throw new Error("previous dispose failed");
		});
		expect(
			slot.commitEnrichment(previousToken, document.createElement("strong")),
		).toBe(true);
		const replacementToken = slot.beginEnrichment("preview:a:replacement");
		replacementToken.setDispose(() => {
			throw new Error("replacement dispose failed");
		});
		const replacement = document.createElement("em");

		expect(slot.commitEnrichment(replacementToken, replacement)).toBe(true);
		expect(slot.previewStatus).toBe("ready");
		expect(previewHost.firstChild).toBe(replacement);
		expect(() => slot.unbind()).not.toThrow();
		expect(slot.previewStatus).toBe("empty");
		expect(slot.logicalIdentity).toBeNull();
		expect(reportError).toHaveBeenCalledTimes(2);
		reportError.mockRestore();
	});
});
