import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import UseBookmarksHarness from "./UseBookmarksHarness.svelte";
import UseBookmarksPairHarness from "./UseBookmarksPairHarness.svelte";

vi.mock("obsidian", () => {
	class MockComponent {
		registerEvent(_eventRef: unknown) {}
		unload() {}
	}

	return {
		Component: MockComponent,
		normalizePath: (path: string) =>
			path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, ""),
	};
});

type BookmarksUpdateCallback = () => void;

function createMockApp(options?: {
	initialContent?: string;
	exists?: boolean;
	readError?: Error | null;
}) {
	let bookmarksExists = options?.exists ?? true;
	let bookmarksContent = options?.initialContent ?? '{"items":[]}';
	let readError = options?.readError ?? null;
	let onBookmarksUpdated: BookmarksUpdateCallback | undefined;

	const app = {
		vault: {
			configDir: ".obsidian",
			adapter: {
				exists: vi.fn(async () => bookmarksExists),
				read: vi.fn(async () => {
					if (readError) {
						throw readError;
					}
					return bookmarksContent;
				}),
			},
		},
		workspace: {
			on: vi.fn((eventName: string, callback: BookmarksUpdateCallback) => {
				if (eventName === "cosense-card-links:bookmarks-updated") {
					onBookmarksUpdated = callback;
				}
				return {};
			}),
		},
	} as unknown as App;

	return {
		app,
		setExists(value: boolean) {
			bookmarksExists = value;
		},
		setContent(value: string) {
			bookmarksContent = value;
		},
		setReadError(value: Error | null) {
			readError = value;
		},
		emitBookmarksUpdated() {
			onBookmarksUpdated?.();
		},
	};
}

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("useBookmarks", () => {
	it("reflects initial load content in bookmark status", async () => {
		const { app } = createMockApp({
			initialContent: JSON.stringify({
				items: [{ type: "file", path: "notes/alpha.md" }],
			}),
		});

		render(UseBookmarksHarness, {
			props: {
				app,
				path: "notes/alpha.md",
			},
		});

		await waitFor(() => {
			expect(screen.getByTestId("is-bookmarked").textContent).toBe("true");
		});
		expect(screen.getByTestId("bookmark-count").textContent).toBe("1");
	});

	it("orderedFilePaths preserves order from bookmarks.json", async () => {
		const { app } = createMockApp({
			initialContent: JSON.stringify({
				items: [
					{ type: "file", path: "notes/gamma.md" },
					{ type: "file", path: "notes/alpha.md" },
					{ type: "file", path: "notes/beta.md" },
				],
			}),
		});

		render(UseBookmarksHarness, {
			props: {
				app,
				path: "notes/alpha.md",
			},
		});

		await waitFor(() => {
			expect(screen.getByTestId("bookmark-count").textContent).toBe("3");
		});
		expect(screen.getByTestId("ordered-file-paths").textContent).toBe(
			"notes/gamma.md,notes/alpha.md,notes/beta.md",
		);
	});

	it("isBookmarked is re-evaluated after bookmarks update event", async () => {
		vi.useFakeTimers();
		const mockApp = createMockApp({
			initialContent: JSON.stringify({
				items: [{ type: "file", path: "notes/alpha.md" }],
			}),
		});

		render(UseBookmarksHarness, {
			props: {
				app: mockApp.app,
				path: "notes/alpha.md",
			},
		});

		await waitFor(() => {
			expect(screen.getByTestId("is-bookmarked").textContent).toBe("true");
		});

		mockApp.setContent(
			JSON.stringify({
				items: [{ type: "file", path: "notes/beta.md" }],
			}),
		);
		mockApp.emitBookmarksUpdated();
		await vi.advanceTimersByTimeAsync(120);

		await waitFor(() => {
			expect(screen.getByTestId("is-bookmarked").textContent).toBe("false");
		});
		expect(screen.getByTestId("bookmark-count").textContent).toBe("1");
	});

	it("shares bookmarks.json read and watch across multiple hooks of same app", async () => {
		vi.useFakeTimers();
		const mockApp = createMockApp({
			initialContent: JSON.stringify({
				items: [
					{ type: "file", path: "notes/alpha.md" },
					{ type: "file", path: "notes/beta.md" },
				],
			}),
		});

		render(UseBookmarksPairHarness, {
			props: {
				app: mockApp.app,
				firstPath: "notes/alpha.md",
				secondPath: "notes/beta.md",
			},
		});
		await waitFor(() => {
			expect(screen.getByTestId("first-is-bookmarked").textContent).toBe("true");
			expect(screen.getByTestId("second-is-bookmarked").textContent).toBe("true");
		});

		const readMock = mockApp.app.vault.adapter.read as unknown as {
			mock: { calls: unknown[] };
		};
		const workspaceOnMock = mockApp.app.workspace.on as unknown as {
			mock: { calls: unknown[] };
		};
		const initialReadCount = readMock.mock.calls.length;
		const initialWorkspaceOnCount = workspaceOnMock.mock.calls.length;
		expect(readMock.mock.calls.length).toBe(initialReadCount);
		expect(workspaceOnMock.mock.calls.length).toBe(initialWorkspaceOnCount);

		mockApp.setContent(
			JSON.stringify({
				items: [{ type: "file", path: "notes/beta.md" }],
			}),
		);
		mockApp.emitBookmarksUpdated();
		await vi.advanceTimersByTimeAsync(120);

		await waitFor(() => {
			expect(screen.getByTestId("first-is-bookmarked").textContent).toBe("false");
			expect(screen.getByTestId("second-is-bookmarked").textContent).toBe("true");
		});
		expect(readMock.mock.calls.length).toBe(initialReadCount + 1);
		expect(workspaceOnMock.mock.calls.length).toBe(initialWorkspaceOnCount);
	});

	it("falls back to empty set when bookmarks file is missing", async () => {
		vi.useFakeTimers();
		const mockApp = createMockApp({
			initialContent: JSON.stringify({
				items: [{ type: "file", path: "notes/alpha.md" }],
			}),
		});

		render(UseBookmarksHarness, {
			props: {
				app: mockApp.app,
				path: "notes/alpha.md",
			},
		});

		await waitFor(() => {
			expect(screen.getByTestId("bookmark-count").textContent).toBe("1");
		});

		mockApp.setExists(false);
		mockApp.emitBookmarksUpdated();
		await vi.advanceTimersByTimeAsync(120);

		await waitFor(() => {
			expect(screen.getByTestId("bookmark-count").textContent).toBe("0");
		});
		expect(screen.getByTestId("is-bookmarked").textContent).toBe("false");
	});

	it("falls back to empty set on read error", async () => {
		vi.useFakeTimers();
		const mockApp = createMockApp({
			initialContent: JSON.stringify({
				items: [{ type: "file", path: "notes/alpha.md" }],
			}),
		});

		render(UseBookmarksHarness, {
			props: {
				app: mockApp.app,
				path: "notes/alpha.md",
			},
		});

		await waitFor(() => {
			expect(screen.getByTestId("bookmark-count").textContent).toBe("1");
		});

		mockApp.setReadError(new Error("read failed"));
		mockApp.emitBookmarksUpdated();
		await vi.advanceTimersByTimeAsync(120);

		await waitFor(() => {
			expect(screen.getByTestId("bookmark-count").textContent).toBe("0");
		});
		expect(screen.getByTestId("is-bookmarked").textContent).toBe("false");
	});
});
