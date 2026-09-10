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
				(item) => item.title === "Relevance",
			),
		).toBe(false);

		await view.rerender({ allowRelevanceSort: true });
		await fireEvent.click(trigger);
		showAtPosition.mock.contexts[1].items
			.find((item) => item.title === "Relevance")
			?.clickHandler?.();
		expect(onSortChange).toHaveBeenLastCalledWith("relevance");
		await view.rerender({ sortOption: "relevance" });
		expect(trigger).toHaveTextContent("Relevance");
		const directionButton = screen.getByRole("button", {
			name: "Highest relevance first (click for lowest first)",
		});
		expect(directionButton).toBeEnabled();
		await fireEvent.click(directionButton);
		expect(onSortChange).toHaveBeenLastCalledWith("relevance-reverse");
		await view.rerender({ sortOption: "relevance-reverse" });
		expect(
			screen.getByRole("button", {
				name: "Lowest relevance first (click for highest first)",
			}),
		).toBeEnabled();
		await fireEvent.click(screen.getByRole("button", { name: "Modified date" }));
		expect(onSortChange).toHaveBeenLastCalledWith("modified-date");
	});

	it("opens an Obsidian menu below the div trigger and marks the current sort field", async () => {
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
		expect(button.tagName).toBe("DIV");
		expect(button).toHaveAttribute("tabindex", "0");
		expect(button).toHaveTextContent("Created date");
		expect(button.querySelector(".twohop-sort-field-icon")).toHaveAttribute(
			"data-icon",
			"calendar-plus",
		);
		expect(
			button.querySelector(".text-button-label + .text-button-icon.mod-aux"),
		).toHaveAttribute("data-icon", "chevrons-up-down");
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
			{ title: "Created date", icon: "calendar-plus", checked: true },
			{ title: "Modified date", icon: "calendar-clock", checked: false },
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
		["Created date", "calendar-plus", "created-date-reverse", "created-date"],
		["Modified date", "calendar-clock", "modified-date-reverse", "modified-date"],
		["File size", "hard-drive", "file-size-reverse", "file-size"],
	] as const)(
		"selects %s while preserving the default/reverse state",
		async (label, icon, defaultOption, reverseOption) => {
			const showAtPosition = vi.spyOn(Menu.prototype, "showAtPosition");
			const onSortChange = vi.fn();
			const view = render(ListControls, {
				props: { sortOption: "alphabetical", onSortChange },
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
			expect(button.querySelector(".twohop-sort-field-icon")).toHaveAttribute(
				"data-icon",
				icon,
			);
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
					name: "Descending (click for ascending)",
				})
				.querySelector('[aria-hidden="true"]'),
		).toHaveAttribute("data-icon", "arrow-down-wide-narrow");
		await fireEvent.click(
			screen.getByRole("button", { name: "Descending (click for ascending)" }),
		);
		expect(onSortChange).toHaveBeenLastCalledWith("file-size");
		await fireEvent.click(screen.getByRole("button", { name: "Modified date" }));
		expect(onSortChange).toHaveBeenLastCalledWith("modified-date-reverse");

		await view.rerender({ sortOption: "file-size" });
		expect(
			screen
				.getByRole("button", {
					name: "Ascending (click for descending)",
				})
				.querySelector('[aria-hidden="true"]'),
		).toHaveAttribute("data-icon", "arrow-up-wide-narrow");
		await fireEvent.click(
			screen.getByRole("button", { name: "Ascending (click for descending)" }),
		);
		expect(onSortChange).toHaveBeenLastCalledWith("file-size-reverse");
		await fireEvent.click(screen.getByRole("button", { name: "Modified date" }));
		expect(onSortChange).toHaveBeenLastCalledWith("modified-date");
	});

	it("renders the modified-date shortcut as an active text-icon button", async () => {
		const onSortChange = vi.fn();
		const view = render(ListControls, {
			props: { sortOption: "modified-date-reverse", onSortChange },
		});
		const shortcut = screen.getByRole("button", { name: "Modified date" });
		const sortMenuTrigger = screen.getByRole("button", {
			name: ARIA_LABELS.SORT_SELECT,
		});

		expect(shortcut.tagName).toBe("DIV");
		expect(shortcut).toHaveClass("text-icon-button", "is-active");
		expect(sortMenuTrigger).not.toHaveClass("is-active");
		expect(shortcut).toHaveAttribute("tabindex", "0");
		expect(shortcut).toHaveAttribute("aria-pressed", "true");
		expect(shortcut.querySelector(".text-button-icon")).toHaveAttribute(
			"data-icon",
			"calendar-clock",
		);
		expect(shortcut.querySelector(".text-button-label")).toHaveTextContent(
			"Modified date",
		);

		await view.rerender({ sortOption: "alphabetical" });
		expect(shortcut).not.toHaveClass("is-active");
		expect(sortMenuTrigger).toHaveClass("is-active");
		expect(shortcut).toHaveAttribute("aria-pressed", "false");

		const defaultAllowed = await fireEvent.keyDown(shortcut, { key: "Enter" });
		expect(defaultAllowed).toBe(false);
		expect(onSortChange).toHaveBeenCalledWith("modified-date-reverse");
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

			const iconElement = screen
				.getByRole("button", {
					name: sortOption === "alphabetical" ? /Ascending/ : /Descending/,
				})
				.querySelector('[aria-hidden="true"]');
			expect(iconElement).toHaveAttribute("data-icon", icon);
			const svg = iconElement?.querySelector("svg");
			expect(svg).toBeInTheDocument();
			expect(svg).toHaveAttribute("width", "100%");
			expect(svg).toHaveAttribute("height", "100%");
			expect(svg).toHaveClass("svg-icon", "lucide", `lucide-${icon}`);
			expect(
				Array.from(iconElement?.querySelectorAll("path") ?? [], (path) =>
					path.getAttribute("d"),
				),
			).toEqual(
				sortOption === "alphabetical-reverse"
					? [
							"m3 8 4-4 4 4",
							"M7 4v16",
							"M20 8h-5",
							"M15 10V6.5a2.5 2.5 0 0 1 5 0V10",
							"M15 14h5l-5 6h5",
						]
					: [
							"m3 16 4 4 4-4",
							"M7 20V4",
							"M20 8h-5",
							"M15 10V6.5a2.5 2.5 0 0 1 5 0V10",
							"M15 14h5l-5 6h5",
						],
			);
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

	it("requests result focus movement on ArrowUp / ArrowDown", async () => {
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
		await fireEvent.keyDown(input, { key: "ArrowDown" });
		await fireEvent.keyDown(input, { key: "ArrowUp" });

		expect(onMoveFocusToResults).toHaveBeenNthCalledWith(1, "down");
		expect(onMoveFocusToResults).toHaveBeenNthCalledWith(2, "up");
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
});
