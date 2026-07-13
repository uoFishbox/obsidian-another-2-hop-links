import { describe, expect, it } from "vitest";
import {
	createVirtualListLayoutRevisionToken,
	createVirtualListRevision,
	hasSameVirtualListRevisionDependency,
	sameRevisionToken,
} from "../virtualListRevision";

describe("VirtualListRevision", () => {
	it("compares array revision tokens shallowly with Object.is semantics", () => {
		const sharedObject = { id: "shared" };

		expect(sameRevisionToken([sharedObject, 1, NaN], [sharedObject, 1, NaN])).toBe(
			true,
		);
		expect(sameRevisionToken([sharedObject, 1], [{ id: "shared" }, 1])).toBe(false);
	});

	it("creates stable layout tokens from numeric layout dependencies", () => {
		const current = createVirtualListRevision({
			layout: createVirtualListLayoutRevisionToken([3, 100, 120, 10]),
		});
		const next = createVirtualListRevision({
			layout: createVirtualListLayoutRevisionToken([3, 100, 120, 10]),
		});

		expect(
			hasSameVirtualListRevisionDependency(current, next, {
				layout: true,
			}),
		).toBe(true);
	});

	it("keeps layout token values distinct without string coercion collisions", () => {
		const current = createVirtualListRevision({
			layout: createVirtualListLayoutRevisionToken(["1:2", 3]),
		});
		const next = createVirtualListRevision({
			layout: createVirtualListLayoutRevisionToken([1, "2:3"]),
		});

		expect(
			hasSameVirtualListRevisionDependency(current, next, {
				layout: true,
			}),
		).toBe(false);
	});

	it("compares object layout token values by reference instead of stringifying", () => {
		const sharedObject = { width: 100 };
		const current = createVirtualListRevision({
			layout: createVirtualListLayoutRevisionToken([sharedObject]),
		});
		const sameReference = createVirtualListRevision({
			layout: createVirtualListLayoutRevisionToken([sharedObject]),
		});
		const sameShape = createVirtualListRevision({
			layout: createVirtualListLayoutRevisionToken([{ width: 100 }]),
		});

		expect(
			hasSameVirtualListRevisionDependency(current, sameReference, {
				layout: true,
			}),
		).toBe(true);
		expect(
			hasSameVirtualListRevisionDependency(current, sameShape, {
				layout: true,
			}),
		).toBe(false);
	});

	it("compares only the dependencies a cache declares", () => {
		const rows = [{ key: 0 }];
		const layoutA = { columns: 2 };
		const layoutB = { columns: 3 };
		const current = createVirtualListRevision({
			content: rows,
			layout: layoutA,
			keyResolver: 1,
			pagination: "page-1",
		});
		const measurementChanged = createVirtualListRevision({
			content: rows,
			layout: layoutA,
			keyResolver: 1,
			pagination: "page-1",
			measurement: "scroll-1",
		});
		const layoutChanged = createVirtualListRevision({
			content: rows,
			layout: layoutB,
			keyResolver: 1,
			pagination: "page-1",
		});

		expect(
			hasSameVirtualListRevisionDependency(current, measurementChanged, {
				content: true,
				layout: true,
			}),
		).toBe(true);
		expect(
			hasSameVirtualListRevisionDependency(current, layoutChanged, {
				content: true,
				layout: true,
			}),
		).toBe(false);
	});

});
