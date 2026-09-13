import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARIA_LABELS } from "cards/ariaLabels";
import { Menu } from "testing/__mocks__/obsidianMocks";
import ListControls from "../ListControls.svelte";

describe("ListControls", () => {
	afterEach(() => vi.restoreAllMocks());

	it("uses Japanese labels when Japanese is selected", () => {
		render(ListControls, {
			props: {
				sortOption: "alphabetical",
				onSortChange: vi.fn(),
				language: "ja",
			},
		});

		expect(screen.getByRole("searchbox", { name: "カードを検索" })).toHaveAttribute(
			"placeholder",
			"検索...",
		);
		expect(
			screen.getByRole("button", { name: "ソート方法を選択" }),
		).toHaveTextContent("タイトル");
		expect(screen.getByRole("button", { name: "更新日時" })).toBeEnabled();
	});

	it("offers relevance only when an origin is available and toggles its direction", async () => {
		const showAtPosition = vi.spyOn(Menu.prototype, "showAtPosition");
		const onSortChange = vi.fn();
		const view = render(ListControls, {
			props: { sortOption: "alphabetical", onSortChange },
		});
		const trigger = screen.getByRole("button", { name: ARIA_LABELS.SORT_SELECT });
		await fireEvent.click(trigger);
		expect(
			showAtPosition.mock.contexts[0].items.some(
				(item) => item.title === "Related",
			),
		).toBe(false);

		await view.rerender({ allowRelevanceSort: true });
		await fireEvent.click(trigger);
		showAtPosition.mock.contexts[1].items
			.find((item) => item.title === "Related")
			?.clickHandler?.();
		expect(onSortChange).toHaveBeenLastCalledWith("relevance");
		await view.rerender({ sortOption: "relevance" });
		expect(trigger).toHaveTextContent("Related");
		const directionButton = screen.getByRole("button", {
			name: "Related: highest first (click for lowest first)",
		});
		expect(directionButton).toBeEnabled();
		expect(directionButton).not.toHaveAttribute("title");
		await fireEvent.click(directionButton);
		expect(onSortChange).toHaveBeenLastCalledWith("relevance-reverse");
		await view.rerender({ sortOption: "relevance-reverse" });
		expect(
			screen.getByRole("button", {
				name: "Related: lowest first (click for highest first)",
			}),
		).toBeEnabled();
		await fireEvent.click(screen.getByRole("button", { name: "Modified" }));
		expect(onSortChange).toHaveBeenLastCalledWith("modified-date");
	});

	it("opens an Obsidian menu below the trigger and marks the current sort field", async () => {
		const showAtPosition = vi.spyOn(Menu.prototype, "showAtPosition");
		const onSortChange = vi.fn();
		render(ListControls, {
			props: { sortOption: "created-date-reverse", onSortChange },
		});
		const button = screen.getByRole("button", { name: ARIA_LABELS.SORT_SELECT });
		vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
			new DOMRect(40, 60, 100, 30),
		);

		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
		expect(button).toHaveAttribute("tabindex", "0");
		expect(button).toHaveTextContent("Created");
		// The field icon and the "opens a menu" affordance are addressed by the
		// plugin's own icon contract, not by class names or sibling order.
		expect(button.querySelector('[data-icon="calendar-plus"]')).toBeInTheDocument();
		expect(
			button.querySelector('[data-icon="chevrons-up-down"]'),
		).toBeInTheDocument();
		expect(button).toHaveAttribute("aria-haspopup", "menu");
		expect(button).toHaveAttribute("aria-expanded", "false");

		await fireEvent.click(button);

		expect(showAtPosition).toHaveBeenCalledTimes(1);
		expect(showAtPosition.mock.calls[0][0]).toEqual({ x: 40, y: 90 });
		expect(showAtPosition.mock.calls[0][1]).toBe(button.ownerDocument);
		const menu = showAtPosition.mock.contexts[0];
		expect(
			menu.items.map(({ title, icon, checked }) => ({ title, icon, checked })),
		).toEqual([
			{ title: "Title", icon: "type", checked: false },
			{ title: "Backlinks", icon: "links-coming-in", checked: false },
			{ title: "Created", icon: "calendar-plus", checked: true },
			{ title: "File size", icon: "hard-drive", checked: false },
		]);
		expect(button).toHaveAttribute("aria-expanded", "true");

		menu.hide();
		await tick();
		expect(button).toHaveAttribute("aria-expanded", "false");
		expect(onSortChange).not.toHaveBeenCalled();
	});

	it.each(["Enter", " "])("opens the sort menu with the %j key", async (key) => {
		const showAtPosition = vi.spyOn(Menu.prototype, "showAtPosition");
		render(ListControls, {
			props: { sortOption: "alphabetical", onSortChange: vi.fn() },
		});
		const trigger = screen.getByRole("button", { name: ARIA_LABELS.SORT_SELECT });
		vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(
			new DOMRect(40, 60, 100, 30),
		);

		const defaultAllowed = await fireEvent.keyDown(trigger, { key });

		expect(defaultAllowed).toBe(false);
		expect(showAtPosition).toHaveBeenCalledTimes(1);
		expect(showAtPosition.mock.calls[0][0]).toEqual({ x: 40, y: 90 });
		expect(showAtPosition.mock.calls[0][1]).toBe(trigger.ownerDocument);
		expect(trigger).toHaveAttribute("aria-expanded", "true");
	});

	it("ignores unrelated keys, composing input, and repeated activation keys", async () => {
		const showAtPosition = vi.spyOn(Menu.prototype, "showAtPosition");
		render(ListControls, {
			props: { sortOption: "alphabetical", onSortChange: vi.fn() },
		});
		const trigger = screen.getByRole("button", { name: ARIA_LABELS.SORT_SELECT });

		await fireEvent.keyDown(trigger, { key: "ArrowDown" });
		await fireEvent.keyDown(trigger, { key: "Enter", isComposing: true });
		await fireEvent.keyDown(trigger, { key: "Enter", repeat: true });

		expect(showAtPosition).not.toHaveBeenCalled();
	});

	it.each([
		["Title", "type", "alphabetical", "alphabetical-reverse"],
		["Backlinks", "links-coming-in", "backlink-count-reverse", "backlink-count"],
		["Created", "calendar-plus", "created-date-reverse", "created-date"],
		["Modified", "calendar-clock", "modified-date-reverse", "modified-date"],
		["File size", "hard-drive", "file-size-reverse", "file-size"],
	] as const)(
		"selects %s while preserving the default/reverse state",
		async (label, icon, defaultOption, reverseOption) => {
			const showAtPosition = vi.spyOn(Menu.prototype, "showAtPosition");
			const onSortChange = vi.fn();
			const view = render(ListControls, {
				props: {
					sortOption: "alphabetical",
					onSortChange,
					quickSortFields: ["none"],
				},
			});
			const button = screen.getByRole("button", {
				name: ARIA_LABELS.SORT_SELECT,
			});
			await fireEvent.click(button);
			showAtPosition.mock.contexts[0].items
				.find((item) => item.title === label)
				?.clickHandler?.();
			expect(onSortChange).toHaveBeenNthCalledWith(1, defaultOption);

			await view.rerender({ sortOption: reverseOption });
			expect(button).toHaveTextContent(label);
			expect(button.querySelector(`[data-icon="${icon}"]`)).toBeInTheDocument();
			await fireEvent.click(button);
			const menu = showAtPosition.mock.contexts[1];
			expect(
				menu.items.filter((item) => item.checked).map((item) => item.title),
			).toEqual([label]);
			menu.items.find((item) => item.title === label)?.clickHandler?.();
			expect(onSortChange).toHaveBeenNthCalledWith(2, reverseOption);
		},
	);

	it("closes the previous menu when reopened and the active menu on unmount", async () => {
		const showAtPosition = vi.spyOn(Menu.prototype, "showAtPosition");
		const hide = vi.spyOn(Menu.prototype, "hide");
		const view = render(ListControls, {
			props: { sortOption: "alphabetical", onSortChange: vi.fn() },
		});
		const button = screen.getByRole("button", { name: ARIA_LABELS.SORT_SELECT });
		await fireEvent.click(button);
		await fireEvent.click(button);
		expect(hide.mock.contexts).toEqual([showAtPosition.mock.contexts[0]]);
		expect(button).toHaveAttribute("aria-expanded", "true");

		view.unmount();
		expect(hide.mock.contexts).toEqual(showAtPosition.mock.contexts);
	});

	it("keeps the direction toggle and modified-date shortcut", async () => {
		const onSortChange = vi.fn();
		const view = render(ListControls, {
			props: { sortOption: "file-size-reverse", onSortChange },
		});
		expect(
			screen
				.getByRole("button", {
					name: "File size: largest first (click for smallest first)",
				})
				.querySelector('[data-icon="arrow-down-wide-narrow"]'),
		).toBeInTheDocument();
		await fireEvent.click(
			screen.getByRole("button", {
				name: "File size: largest first (click for smallest first)",
			}),
		);
		expect(onSortChange).toHaveBeenLastCalledWith("file-size");
		await fireEvent.click(screen.getByRole("button", { name: "Modified" }));
		expect(onSortChange).toHaveBeenLastCalledWith("modified-date-reverse");

		await view.rerender({ sortOption: "file-size" });
		expect(
			screen
				.getByRole("button", {
					name: "File size: smallest first (click for largest first)",
				})
				.querySelector('[data-icon="arrow-up-wide-narrow"]'),
		).toBeInTheDocument();
		await fireEvent.click(
			screen.getByRole("button", {
				name: "File size: smallest first (click for largest first)",
			}),
		);
		expect(onSortChange).toHaveBeenLastCalledWith("file-size-reverse");
		await fireEvent.click(screen.getByRole("button", { name: "Modified" }));
		expect(onSortChange).toHaveBeenLastCalledWith("modified-date");
	});

	it("renders the modified-date shortcut as the pressed button that owns the current sort", async () => {
		const onSortChange = vi.fn();
		const view = render(ListControls, {
			props: { sortOption: "modified-date-reverse", onSortChange },
		});
		const shortcut = screen.getByRole("button", { name: "Modified" });
		const sortMenuTrigger = screen.getByRole("button", {
			name: ARIA_LABELS.SORT_SELECT,
		});

		// A pinned sort that owns the current state takes the trigger's place, so
		// the trigger falls back to the generic "Select" label without a field icon.
		expect(sortMenuTrigger).toHaveTextContent("Select");
		expect(
			sortMenuTrigger.querySelector('[data-icon="calendar-clock"]'),
		).not.toBeInTheDocument();
		expect(
			sortMenuTrigger.querySelector('[data-icon="chevrons-up-down"]'),
		).toBeInTheDocument();
		expect(shortcut).toHaveAttribute("tabindex", "0");
		expect(shortcut).toHaveAttribute("aria-pressed", "true");
		expect(shortcut).not.toHaveAttribute("title");
		expect(
			shortcut.querySelector('[data-icon="calendar-clock"]'),
		).toBeInTheDocument();
		expect(shortcut).toHaveTextContent("Modified");

		await view.rerender({ sortOption: "alphabetical" });
		expect(sortMenuTrigger.querySelector('[data-icon="type"]')).toBeInTheDocument();
		expect(sortMenuTrigger).toHaveTextContent("Title");
		expect(shortcut).toHaveAttribute("aria-pressed", "false");

		const defaultAllowed = await fireEvent.keyDown(shortcut, { key: "Enter" });
		expect(defaultAllowed).toBe(false);
		expect(onSortChange).toHaveBeenCalledWith("modified-date-reverse");
	});

	it("renders zero to two configured pinned sorts and removes duplicates", async () => {
		const onSortChange = vi.fn();
		const view = render(ListControls, {
			props: {
				sortOption: "alphabetical-reverse",
				onSortChange,
				quickSortFields: ["title", "file-size"],
			},
		});

		expect(screen.getByRole("button", { name: "Title" })).toBeEnabled();
		expect(screen.getByRole("button", { name: "File size" })).toBeEnabled();
		// Pinned fields render as their own buttons, and the menu trigger stays a
		// separate control that falls back to the generic label while one of them
		// owns the current sort.
		expect(
			screen.getByRole("button", { name: ARIA_LABELS.SORT_SELECT }),
		).toHaveTextContent("Select");
		expect(
			screen.queryByRole("button", { name: "Modified" }),
		).not.toBeInTheDocument();

		await fireEvent.click(screen.getByRole("button", { name: "File size" }));
		expect(onSortChange).toHaveBeenLastCalledWith("file-size");

		await view.rerender({ quickSortFields: ["backlinks", "backlinks"] });
		expect(screen.getAllByRole("button", { name: "Backlinks" })).toHaveLength(1);
		expect(screen.queryByRole("button", { name: "Title" })).not.toBeInTheDocument();

		await view.rerender({ quickSortFields: ["none", "none"] });
		expect(
			screen.queryByRole("button", { name: "Backlinks" }),
		).not.toBeInTheDocument();
	});

	it("excludes pinned sorts from the menu and hides unsupported pinned relevance", async () => {
		const showAtPosition = vi.spyOn(Menu.prototype, "showAtPosition");
		const view = render(ListControls, {
			props: {
				sortOption: "relevance",
				onSortChange: vi.fn(),
				allowRelevanceSort: true,
				quickSortFields: ["relevance", "file-size"],
			},
		});
		const trigger = screen.getByRole("button", { name: ARIA_LABELS.SORT_SELECT });

		expect(screen.getByRole("button", { name: "Related" })).toBeEnabled();
		expect(screen.getByRole("button", { name: "File size" })).toBeEnabled();
		await fireEvent.click(trigger);
		expect(showAtPosition.mock.contexts[0].items.map((item) => item.title)).toEqual(
			["Title", "Backlinks", "Created", "Modified"],
		);

		await view.rerender({ allowRelevanceSort: false });
		expect(
			screen.queryByRole("button", { name: "Related" }),
		).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "File size" })).toBeEnabled();
		await fireEvent.click(trigger);
		expect(showAtPosition.mock.contexts[1].items.map((item) => item.title)).toEqual(
			["Title", "Backlinks", "Created", "Modified"],
		);
	});

	it.each([
		["alphabetical", "arrow-down-a-z"],
		["alphabetical-reverse", "arrow-up-a-z"],
	] as const)(
		"renders the title-specific direction icon for %s",
		(sortOption, icon) => {
			render(ListControls, {
				props: { sortOption, onSortChange: vi.fn() },
			});

			// The direction is identified by the plugin's icon name and the
			// accessible label. How the host renders that icon into SVG is not
			// part of this contract.
			const directionButton = screen.getByRole("button", {
				name:
					sortOption === "alphabetical"
						? "Title: A–Z (click for Z–A)"
						: "Title: Z–A (click for A–Z)",
			});
			const iconElement = directionButton.querySelector(`[data-icon="${icon}"]`);
			expect(iconElement).toBeInTheDocument();
			expect(iconElement?.querySelector("svg")).toBeInTheDocument();
		},
	);

	it("passes latest value to onSearchInput on input", async () => {
		const onSearchInput = vi.fn();

		render(ListControls, {
			props: {
				searchInputValue: "",
				sortOption: "alphabetical",
				onSortChange: vi.fn(),
				onSearchInput,
			},
		});

		const input = screen.getByRole("searchbox");
		await fireEvent.input(input, { target: { value: "alpha" } });

		expect(onSearchInput).toHaveBeenCalledWith("alpha");
	});

	it("requests result focus movement on ArrowDown only", async () => {
		const onMoveFocusToResults = vi.fn();

		render(ListControls, {
			props: {
				searchInputValue: "",
				sortOption: "alphabetical",
				onSortChange: vi.fn(),
				onSearchInput: vi.fn(),
				onMoveFocusToResults,
			},
		});

		const input = screen.getByRole("searchbox");
		await fireEvent.keyDown(input, { key: "ArrowUp" });

		expect(onMoveFocusToResults).not.toHaveBeenCalled();

		await fireEvent.keyDown(input, { key: "ArrowDown" });

		expect(onMoveFocusToResults).toHaveBeenCalledTimes(1);
		expect(onMoveFocusToResults).toHaveBeenNthCalledWith(1, "down");
	});

	it("leaves ArrowUp in the search input unconsumed and without side effects", async () => {
		const onMoveFocusToResults = vi.fn();
		const onMoveFocusToEditor = vi.fn(() => true);

		render(ListControls, {
			props: {
				searchInputValue: "",
				sortOption: "alphabetical",
				onSortChange: vi.fn(),
				onSearchInput: vi.fn(),
				onMoveFocusToResults,
				onMoveFocusToEditor,
			},
		});

		const input = screen.getByRole("searchbox");
		input.focus();
		const notPrevented = await fireEvent.keyDown(input, { key: "ArrowUp" });

		expect(notPrevented).toBe(true);
		expect(onMoveFocusToResults).not.toHaveBeenCalled();
		expect(onMoveFocusToEditor).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(input);
	});

	it("requests editor focus on Escape while the search input is empty", async () => {
		const onMoveFocusToEditor = vi.fn(() => true);

		render(ListControls, {
			props: {
				searchInputValue: "",
				sortOption: "alphabetical",
				onSortChange: vi.fn(),
				onSearchInput: vi.fn(),
				onMoveFocusToEditor,
			},
		});

		const input = screen.getByRole("searchbox");
		const notPrevented = await fireEvent.keyDown(input, { key: "Escape" });

		expect(onMoveFocusToEditor).toHaveBeenCalledTimes(1);
		expect(notPrevented).toBe(false);
	});

	it("keeps Escape for the host app while a search query is present", async () => {
		const onMoveFocusToEditor = vi.fn(() => true);

		render(ListControls, {
			props: {
				searchInputValue: "alpha",
				sortOption: "alphabetical",
				onSortChange: vi.fn(),
				onSearchInput: vi.fn(),
				onMoveFocusToEditor,
			},
		});

		const input = screen.getByRole("searchbox");
		await fireEvent.keyDown(input, { key: "Escape" });

		expect(onMoveFocusToEditor).not.toHaveBeenCalled();
	});

	it("keeps Escape for the host app when no editor can take focus", async () => {
		const onMoveFocusToEditor = vi.fn(() => false);

		render(ListControls, {
			props: {
				searchInputValue: "",
				sortOption: "alphabetical",
				onSortChange: vi.fn(),
				onSearchInput: vi.fn(),
				onMoveFocusToEditor,
			},
		});

		const input = screen.getByRole("searchbox");
		const notPrevented = await fireEvent.keyDown(input, { key: "Escape" });

		expect(onMoveFocusToEditor).toHaveBeenCalledTimes(1);
		expect(notPrevented).toBe(true);
	});

	it("submits the trimmed search value on Ctrl+Enter", async () => {
		const onSearchSubmit = vi.fn();

		render(ListControls, {
			props: {
				searchInputValue: "  alpha  ",
				sortOption: "alphabetical",
				onSortChange: vi.fn(),
				onSearchInput: vi.fn(),
				onSearchSubmit,
			},
		});

		const input = screen.getByRole("searchbox");
		await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

		expect(onSearchSubmit).toHaveBeenCalledWith("alpha");
	});

	it("does not submit an empty search value on Ctrl+Enter", async () => {
		const onSearchSubmit = vi.fn();

		render(ListControls, {
			props: {
				searchInputValue: "   ",
				sortOption: "alphabetical",
				onSortChange: vi.fn(),
				onSearchInput: vi.fn(),
				onSearchSubmit,
			},
		});

		const input = screen.getByRole("searchbox");
		await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

		expect(onSearchSubmit).not.toHaveBeenCalled();
	});

	it("calls handler when full-text search toggle is pressed", async () => {
		const onToggleContentSearch = vi.fn();

		render(ListControls, {
			props: {
				searchInputValue: "",
				sortOption: "alphabetical",
				onSortChange: vi.fn(),
				onSearchInput: vi.fn(),
				contentSearchEnabled: true,
				onToggleContentSearch,
			},
		});

		const toggle = screen.getByRole("button", {
			name: "Disable full-text search",
		});

		await fireEvent.click(toggle);

		expect(onToggleContentSearch).toHaveBeenCalledTimes(1);
	});

	it("hides the content search toggle when disabled and uses the configured placeholder", () => {
		render(ListControls, {
			props: {
				searchInputValue: "",
				sortOption: "alphabetical",
				onSortChange: vi.fn(),
				onSearchInput: vi.fn(),
				showContentSearchToggle: false,
				searchPlaceholder: "Search note titles...",
			},
		});

		expect(
			screen.getByPlaceholderText("Search note titles..."),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Enable full-text search" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Disable full-text search" }),
		).not.toBeInTheDocument();
	});

	it("uses the full-text placeholder while content search is enabled", async () => {
		const view = render(ListControls, {
			props: {
				searchInputValue: "",
				sortOption: "alphabetical",
				onSortChange: vi.fn(),
				searchPlaceholder: "Search note titles...",
				contentSearchPlaceholder: "Search note contents...",
				contentSearchEnabled: false,
			},
		});

		expect(
			screen.getByPlaceholderText("Search note titles..."),
		).toBeInTheDocument();

		await view.rerender({ contentSearchEnabled: true });

		expect(
			screen.getByPlaceholderText("Search note contents..."),
		).toBeInTheDocument();
	});

	it("falls back to the full-text placeholder when no content placeholder is configured", async () => {
		const view = render(ListControls, {
			props: {
				searchInputValue: "",
				sortOption: "alphabetical",
				onSortChange: vi.fn(),
				searchPlaceholder: "Search note titles...",
				contentSearchEnabled: false,
			},
		});

		expect(
			screen.getByPlaceholderText("Search note titles..."),
		).toBeInTheDocument();

		await view.rerender({ contentSearchEnabled: true });

		expect(
			screen.getByPlaceholderText("Search note contents..."),
		).toBeInTheDocument();
		expect(
			screen.queryByPlaceholderText("Search note titles..."),
		).not.toBeInTheDocument();
	});
});
