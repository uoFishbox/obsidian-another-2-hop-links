import { describe, expect, test } from "vitest";
import type { IncrementalFileChange } from "../types/IndexTypes";
import { FileChangeQueue } from "../index-service/FileChangeQueue";

interface NormalizationCase {
	name: string;
	changes: IncrementalFileChange[];
	expected: IncrementalFileChange[];
}

const normalizationCases: NormalizationCase[] = [
	{
		name: "single create",
		changes: [{ type: "create", path: "notes/new.md" }],
		expected: [{ type: "create", path: "notes/new.md" }],
	},
	{
		name: "single modify",
		changes: [{ type: "modify", path: "notes/existing.md" }],
		expected: [{ type: "modify", path: "notes/existing.md" }],
	},
	{
		name: "single delete",
		changes: [{ type: "delete", path: "notes/old.md" }],
		expected: [{ type: "delete", path: "notes/old.md" }],
	},
	{
		name: "single rename",
		changes: [{ type: "rename", oldPath: "notes/old.md", newPath: "notes/new.md" }],
		expected: [
			{ type: "rename", oldPath: "notes/old.md", newPath: "notes/new.md" },
		],
	},
	{
		name: "create -> delete cancels out",
		changes: [
			{ type: "create", path: "notes/temp.md" },
			{ type: "delete", path: "notes/temp.md" },
		],
		expected: [],
	},
	{
		name: "create -> modify merges to create",
		changes: [
			{ type: "create", path: "notes/new.md" },
			{ type: "modify", path: "notes/new.md" },
		],
		expected: [{ type: "create", path: "notes/new.md" }],
	},
	{
		name: "create -> rename becomes create at newPath",
		changes: [
			{ type: "create", path: "notes/original.md" },
			{
				type: "rename",
				oldPath: "notes/original.md",
				newPath: "notes/renamed.md",
			},
		],
		expected: [{ type: "create", path: "notes/renamed.md" }],
	},
	{
		name: "rename -> modify keeps both",
		changes: [
			{ type: "rename", oldPath: "notes/old.md", newPath: "notes/new.md" },
			{ type: "modify", path: "notes/other.md" },
		],
		expected: [
			{ type: "rename", oldPath: "notes/old.md", newPath: "notes/new.md" },
			{ type: "modify", path: "notes/other.md" },
		],
	},
	{
		name: "rename -> create(oldPath) keeps both",
		changes: [
			{ type: "rename", oldPath: "notes/old.md", newPath: "notes/new.md" },
			{ type: "create", path: "notes/old.md" },
		],
		expected: [
			{ type: "rename", oldPath: "notes/old.md", newPath: "notes/new.md" },
			{ type: "create", path: "notes/old.md" },
		],
	},
	{
		name: "modify -> delete becomes delete",
		changes: [
			{ type: "modify", path: "notes/target.md" },
			{ type: "delete", path: "notes/target.md" },
		],
		expected: [{ type: "delete", path: "notes/target.md" }],
	},
	{
		name: "delete -> create recreates",
		changes: [
			{ type: "delete", path: "notes/target.md" },
			{ type: "create", path: "notes/target.md" },
		],
		expected: [{ type: "create", path: "notes/target.md" }],
	},
	{
		name: "delete -> rename becomes delete + rename",
		changes: [
			{ type: "delete", path: "notes/old.md" },
			{ type: "rename", oldPath: "notes/old.md", newPath: "notes/new.md" },
		],
		expected: [
			{ type: "delete", path: "notes/old.md" },
			{ type: "rename", oldPath: "notes/old.md", newPath: "notes/new.md" },
		],
	},
	{
		name: "multiple creates",
		changes: [
			{ type: "create", path: "notes/a.md" },
			{ type: "create", path: "notes/b.md" },
			{ type: "create", path: "notes/c.md" },
		],
		expected: [
			{ type: "create", path: "notes/a.md" },
			{ type: "create", path: "notes/b.md" },
			{ type: "create", path: "notes/c.md" },
		],
	},
	{
		name: "duplicate create is ignored",
		changes: [
			{ type: "create", path: "notes/new.md" },
			{ type: "create", path: "notes/new.md" },
		],
		expected: [{ type: "create", path: "notes/new.md" }],
	},
	{
		name: "duplicate modify is ignored",
		changes: [
			{ type: "modify", path: "notes/existing.md" },
			{ type: "modify", path: "notes/existing.md" },
		],
		expected: [{ type: "modify", path: "notes/existing.md" }],
	},
	{
		name: "rename same path is ignored",
		changes: [
			{ type: "rename", oldPath: "notes/same.md", newPath: "notes/same.md" },
		],
		expected: [],
	},
	{
		name: "modify after rename on different file",
		changes: [
			{ type: "rename", oldPath: "notes/a.md", newPath: "notes/b.md" },
			{ type: "modify", path: "notes/c.md" },
			{ type: "modify", path: "notes/d.md" },
		],
		expected: [
			{ type: "rename", oldPath: "notes/a.md", newPath: "notes/b.md" },
			{ type: "modify", path: "notes/c.md" },
			{ type: "modify", path: "notes/d.md" },
		],
	},
	{
		name: "create -> delete -> create recreates",
		changes: [
			{ type: "create", path: "notes/temp.md" },
			{ type: "delete", path: "notes/temp.md" },
			{ type: "create", path: "notes/temp.md" },
		],
		expected: [{ type: "create", path: "notes/temp.md" }],
	},
	{
		name: "rename chain a->b->c becomes a->c",
		changes: [
			{ type: "rename", oldPath: "notes/a.md", newPath: "notes/b.md" },
			{ type: "rename", oldPath: "notes/b.md", newPath: "notes/c.md" },
		],
		expected: [{ type: "rename", oldPath: "notes/a.md", newPath: "notes/c.md" }],
	},
	{
		name: "modify -> rename becomes rename",
		changes: [
			{ type: "modify", path: "notes/old.md" },
			{ type: "rename", oldPath: "notes/old.md", newPath: "notes/new.md" },
		],
		expected: [
			{ type: "rename", oldPath: "notes/old.md", newPath: "notes/new.md" },
		],
	},
	{
		name: "multiple deleted tracks retain their original order",
		changes: [
			{ type: "delete", path: "notes/old.md" },
			{ type: "rename", oldPath: "notes/old.md", newPath: "notes/moved.md" },
			{ type: "create", path: "notes/old.md" },
			{ type: "rename", oldPath: "notes/moved.md", newPath: "notes/old.md" },
			{ type: "delete", path: "notes/old.md" },
			{ type: "delete", path: "notes/moved.md" },
			{ type: "create", path: "notes/old.md" },
		],
		expected: [
			{ type: "create", path: "notes/old.md" },
			{ type: "delete", path: "notes/old.md" },
		],
	},
];

describe("FileChangeQueue normalization", () => {
	test.each(normalizationCases)("$name", ({ changes, expected }) => {
		const queue = new FileChangeQueue();
		for (const change of changes) {
			queue.recordChange(change);
		}
		const { changes: result } = queue.drain();
		expect(result).toEqual(expected);
	});
});

describe("FileChangeQueue batching", () => {
	test("recordChanges preserves order while ignoring removed tracks", () => {
		const queue = new FileChangeQueue();

		queue.recordChanges([
			{ type: "create", path: "notes/temp.md" },
			{ type: "delete", path: "notes/temp.md" },
			{ type: "rename", oldPath: "notes/old.md", newPath: "notes/new.md" },
		]);

		expect(queue.drain().changes).toEqual([
			{ type: "rename", oldPath: "notes/old.md", newPath: "notes/new.md" },
		]);
	});
});

describe("FileChangeQueue flags", () => {
	test("hasPending is false when empty", () => {
		const queue = new FileChangeQueue();
		expect(queue.hasPending()).toBe(false);
	});

	test("hasPending is true after recording change", () => {
		const queue = new FileChangeQueue();
		queue.recordChange({ type: "create", path: "notes/new.md" });
		expect(queue.hasPending()).toBe(true);
	});

	test("hasPendingCreateChanges detects create/rename", () => {
		const queue = new FileChangeQueue();
		queue.recordChange({ type: "modify", path: "notes/existing.md" });
		expect(queue.hasPendingCreateChanges()).toBe(false);

		queue.recordChange({ type: "create", path: "notes/new.md" });
		expect(queue.hasPendingCreateChanges()).toBe(true);
	});

	test("pending counts return to zero after a change is canceled", () => {
		const queue = new FileChangeQueue();
		queue.recordChange({ type: "create", path: "notes/temp.md" });
		expect(queue.hasPending()).toBe(true);
		expect(queue.hasPendingCreateChanges()).toBe(true);

		queue.recordChange({ type: "delete", path: "notes/temp.md" });
		expect(queue.hasPending()).toBe(false);
		expect(queue.hasPendingCreateChanges()).toBe(false);
	});

	test("requiresFullRebuild reflects a full rebuild request", () => {
		const queue = new FileChangeQueue();
		expect(queue.requiresFullRebuild()).toBe(false);

		queue.requestFullRebuild();
		expect(queue.requiresFullRebuild()).toBe(true);

		queue.drain();
		expect(queue.requiresFullRebuild()).toBe(false);
	});

	test("drain clears all state", () => {
		const queue = new FileChangeQueue();
		queue.recordChange({ type: "create", path: "notes/new.md" });
		queue.requestFullRebuild();

		const result = queue.drain();
		expect(result.changes).toHaveLength(1);
		expect(result.requiresFullRebuild).toBe(true);

		expect(queue.hasPending()).toBe(false);
		expect(queue.requiresFullRebuild()).toBe(false);
	});
});
