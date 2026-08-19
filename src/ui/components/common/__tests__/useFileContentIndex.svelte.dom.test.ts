import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { TFile, type App } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import UseFileContentIndexHarness from "./UseFileContentIndexHarness.svelte";

const yieldHarness = vi.hoisted(() => {
	const calls: unknown[] = [];
	let nextYield: (() => Promise<void>) | null = null;

	return {
		calls,
		setNextYield(fn: () => Promise<void>) {
			nextYield = fn;
		},
		reset() {
			calls.length = 0;
			nextYield = null;
		},
		async yieldToMainThreadIdleAware(options: unknown) {
			calls.push(options);
			const fn = nextYield;
			nextYield = null;
			if (fn) {
				await fn();
			}
		},
	};
});

vi.mock("core/indexing/timeSlicing", () => ({
	yieldToMainThreadIdleAware: yieldHarness.yieldToMainThreadIdleAware,
}));

vi.mock("obsidian", () => {
	class MockComponent {
		registerEvent(_eventRef: unknown) {}
		load() {}
		unload() {}
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

type MockApp = {
	vault: {
		cachedRead: ReturnType<typeof vi.fn>;
		on: ReturnType<typeof vi.fn>;
	};
};

function createMockApp(fileContentsByPath: Record<string, string>): {
	app: App;
	cachedRead: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
} {
	const cachedRead = vi.fn(async (file: TFile) => {
		return fileContentsByPath[file.path] ?? "";
	});
	const on = vi.fn((_eventName: string, _callback: (...args: any[]) => void) => {
		return {};
	});

	return {
		app: {
			vault: {
				cachedRead,
				on,
			},
		} as unknown as App,
		cachedRead,
		on,
	};
}

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

afterEach(() => {
	cleanup();
	yieldHarness.reset();
});

describe("useFileContentIndex", () => {
	it("builds and destroys index when enabled changes", async () => {
		const file = createMockTFile("notes/alpha.md");
		const query = "body-only-token";
		const { app, cachedRead, on } = createMockApp({
			[file.path]: `title-like text ${query} inside body`,
		});

		const view = render(UseFileContentIndexHarness, {
			props: {
				app,
				files: [file],
				targetFile: file,
				query,
				enabled: false,
			},
		});

		// 無効時はインデックス構築しない
		expect(screen.getByTestId("has-match").textContent).toBe("false");
		expect(cachedRead).not.toHaveBeenCalled();
		expect(on).not.toHaveBeenCalled();

		// 有効化でインデックス構築
		await view.rerender({
			app,
			files: [file],
			targetFile: file,
			query,
			enabled: true,
		});

		await waitFor(() => {
			expect(screen.getByTestId("has-match").textContent).toBe("true");
		});
		expect(cachedRead).toHaveBeenCalled();
		expect(on).toHaveBeenCalledTimes(4);

		// 無効化でインデックス破棄
		await view.rerender({
			app,
			files: [file],
			targetFile: file,
			query,
			enabled: false,
		});

		await waitFor(() => {
			expect(screen.getByTestId("has-match").textContent).toBe("false");
		});
	});

	it("can search body content with hasMatch", async () => {
		const file = createMockTFile("notes/content.md");
		const query = "content-only-token";
		const { app } = createMockApp({
			[file.path]: `This body contains ${query} and no title hint`,
		});

		render(UseFileContentIndexHarness, {
			props: {
				app,
				files: [file],
				targetFile: file,
				query,
				enabled: true,
			},
		});

		await waitFor(() => {
			expect(screen.getByTestId("has-match").textContent).toBe("true");
		});
	});

	it("stores a normalized body snapshot for case-insensitive search", async () => {
		const file = createMockTFile("notes/raw-content.md");
		const rawContent = "MiXeD Case Token";
		const { app } = createMockApp({
			[file.path]: rawContent,
		});

		render(UseFileContentIndexHarness, {
			props: {
				app,
				files: [file],
				targetFile: file,
				query: "token",
				enabled: true,
			},
		});

		await waitFor(() => {
			expect(screen.getByTestId("serialized-content").textContent).toBe(
				rawContent.toLowerCase(),
			);
		});
	});

	it("treats space-separated search terms with AND condition", async () => {
		const file = createMockTFile("notes/and-search.md");
		const { app } = createMockApp({
			[file.path]: "first token appears here and second token appears later",
		});

		const view = render(UseFileContentIndexHarness, {
			props: {
				app,
				files: [file],
				targetFile: file,
				query: "first second",
				enabled: true,
			},
		});

		await waitFor(() => {
			expect(screen.getByTestId("has-match").textContent).toBe("true");
		});

		await view.rerender({
			app,
			files: [file],
			targetFile: file,
			query: "first missing",
			enabled: true,
		});

		await waitFor(() => {
			expect(screen.getByTestId("has-match").textContent).toBe("false");
		});
	});

	it("reflects body matches on each batch completion", async () => {
		const files = Array.from({ length: 11 }, (_unused, index) =>
			createMockTFile(`notes/${String(index).padStart(2, "0")}.md`),
		);
		const query = "batch-token";
		const pendingLoad = createDeferred<string>();
		const pendingPath = files[10].path;
		const cachedRead = vi.fn(async (file: TFile) => {
			if (file.path === pendingPath) {
				return await pendingLoad.promise;
			}

			return file.path === files[0].path ? `contains ${query}` : "no match";
		});
		const on = vi.fn((_eventName: string, _callback: (...args: any[]) => void) => {
			return {};
		});
		const app = {
			vault: {
				cachedRead,
				on,
			},
		} as unknown as App;

		render(UseFileContentIndexHarness, {
			props: {
				app,
				files,
				targetFile: files[0],
				query,
				enabled: true,
			},
		});

		await waitFor(() => {
			expect(cachedRead).toHaveBeenCalledTimes(11);
		});

		await tick();
		expect(screen.getByTestId("has-match").textContent).toBe("true");
		expect(screen.getByTestId("is-loading").textContent).toBe("true");

		pendingLoad.resolve("no match");

		await waitFor(() => {
			expect(screen.getByTestId("is-loading").textContent).toBe("false");
		});
	});

	it("yields between multiple file content load batches", async () => {
		const files = Array.from({ length: 11 }, (_unused, index) =>
			createMockTFile(`notes/yield-${index}.md`),
		);
		const { app, cachedRead } = createMockApp(
			Object.fromEntries(files.map((file) => [file.path, "content"])),
		);

		render(UseFileContentIndexHarness, {
			props: {
				app,
				files,
				targetFile: files[10],
				query: "content",
				enabled: true,
			},
		});

		await waitFor(() => {
			expect(cachedRead).toHaveBeenCalledTimes(11);
		});
		await waitFor(() => {
			expect(screen.getByTestId("is-loading").textContent).toBe("false");
		});

		expect(yieldHarness.calls).toEqual([{ maxDelayMs: 16 }]);
	});

	it("does not apply later batches after cancellation", async () => {
		const files = Array.from({ length: 11 }, (_unused, index) =>
			createMockTFile(`notes/cancel-${index}.md`),
		);
		const yieldGate = createDeferred<void>();
		yieldHarness.setNextYield(() => yieldGate.promise);
		const { app, cachedRead } = createMockApp(
			Object.fromEntries(
				files.map((file, index) => [
					file.path,
					index === 10 ? "second-batch-token" : "first batch",
				]),
			),
		);

		const view = render(UseFileContentIndexHarness, {
			props: {
				app,
				files,
				targetFile: files[10],
				query: "second-batch-token",
				enabled: true,
			},
		});

		await waitFor(() => {
			expect(yieldHarness.calls).toHaveLength(1);
		});
		expect(cachedRead).toHaveBeenCalledTimes(10);

		await view.rerender({
			app,
			files,
			targetFile: files[10],
			query: "second-batch-token",
			enabled: false,
		});
		yieldGate.resolve();

		await waitFor(() => {
			expect(screen.getByTestId("is-loading").textContent).toBe("false");
		});

		expect(cachedRead).toHaveBeenCalledTimes(10);
		expect(screen.getByTestId("has-match").textContent).toBe("false");
	});

	it("isLoading is true until loading completes", async () => {
		const file = createMockTFile("notes/loading.md");
		const query = "loading-token";
		const pendingLoad = createDeferred<string>();
		const cachedRead = vi.fn(async () => await pendingLoad.promise);
		const on = vi.fn((_eventName: string, _callback: (...args: any[]) => void) => {
			return {};
		});
		const app = {
			vault: {
				cachedRead,
				on,
			},
		} as unknown as App;

		render(UseFileContentIndexHarness, {
			props: {
				app,
				files: [file],
				targetFile: file,
				query,
				enabled: true,
			},
		});

		await waitFor(() => {
			expect(cachedRead).toHaveBeenCalledTimes(1);
		});
		await tick();
		expect(screen.getByTestId("is-loading").textContent).toBe("true");

		pendingLoad.resolve(`contains ${query}`);

		await waitFor(() => {
			expect(screen.getByTestId("is-loading").textContent).toBe("false");
		});
		expect(screen.getByTestId("has-match").textContent).toBe("true");
	});

	it("can get match position with getFirstMatchPosition", async () => {
		const file = createMockTFile("notes/position.md");
		const query = "targettoken";
		const { app } = createMockApp({
			[file.path]: "line0\nline1 targettoken here\nline2",
		});

		render(UseFileContentIndexHarness, {
			props: {
				app,
				files: [file],
				targetFile: file,
				query,
				enabled: true,
			},
		});

		await waitFor(() => {
			expect(screen.getByTestId("first-match-line").textContent).toBe("1");
		});
	});
});
