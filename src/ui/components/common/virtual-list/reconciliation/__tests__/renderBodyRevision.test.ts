import { describe, expect, it } from "vitest";
import {
	encodeResolvedItemRenderRevisionToken,
	encodeRenderRevisionToken,
	resolveHeaderRenderRevisionToken,
	resolveItemRenderRevisionToken,
	tryResolveItemRenderRevisionToken,
} from "../renderBodyRevision";
import { logicalCellKey, sourceKey } from "../../types";

describe("renderBodyRevision", () => {
	it("encodes primitive render revisions without collisions", () => {
		const values = [null, false, true, 0, -0, NaN, "null", "0", "n:NaN"];
		const encoded = values.map(encodeRenderRevisionToken);

		expect(new Set(encoded).size).toBe(values.length);
		expect(encoded).toEqual([
			"null",
			"b:false",
			"b:true",
			"n:0",
			"n:-0",
			"n:NaN",
			"s:null",
			"s:0",
			"s:n:NaN",
		]);
	});

	it("resolves explicit item render revisions", () => {
		const token = resolveItemRenderRevisionToken({
			kind: "item",
			key: logicalCellKey("item-0::item:0"),
			sourceKey: sourceKey("item-0"),
			item: { id: "item-0" },
			itemIndex: 0,
			itemRenderRevision: null,
		});

		expect(token).toEqual({
			kind: "render",
			revision: null,
		});
		expect(encodeResolvedItemRenderRevisionToken(token)).toBe("null");
	});

	it("isolates missing item revisions behind fallback policies", () => {
		const item = {
			id: "item-0",
		};
		const cell = {
			kind: "item" as const,
			key: logicalCellKey("item-0::item:0"),
			sourceKey: sourceKey("item-0"),
			item,
			itemIndex: 0,
		};

		expect(resolveItemRenderRevisionToken(cell, "source-key-only")).toEqual({
			kind: "render",
			revision: null,
		});
		expect(resolveItemRenderRevisionToken(cell)).toEqual({
			kind: "render",
			revision: null,
		});
		expect(() =>
			resolveItemRenderRevisionToken(cell, "required"),
		).toThrow(
			'Missing item render revision for sourceKey="item-0" cellKey="item-0::item:0".',
		);
		expect(tryResolveItemRenderRevisionToken(cell, "required")).toEqual({
			ok: false,
			error: {
				type: "missing-item-render-revision",
				sourceKey: "item-0",
				cellKey: "item-0::item:0",
			},
		});
	});

	it("resolves explicit header render revisions", () => {
		const descriptor = {
			section: { id: "section-0" },
			sectionKey: "section-0",
			title: "Initial",
			sectionId: "section-0",
			totalCount: 1,
			loadedCount: 1,
			getItems: () => [],
			headerProps: { interactionKind: "sectionHeader" as const },
			headerRenderRevision: false,
		};

		expect(resolveHeaderRenderRevisionToken(descriptor)).toEqual({
			kind: "render",
			revision: false,
		});
	});

	it("uses a source-key-only header revision when header render revision is missing", () => {
		const descriptor = {
			section: { id: "section-0" },
			sectionKey: "section-0",
			title: "Initial",
			sectionId: "section-0",
			totalCount: 1,
			loadedCount: 1,
			getItems: () => [],
			headerProps: { interactionKind: "sectionHeader" as const },
		};

		expect(resolveHeaderRenderRevisionToken(descriptor)).toEqual({
			kind: "render",
			revision: null,
		});
	});
});
