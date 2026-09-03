import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARIA_LABELS } from "cards/ariaLabels";
import { Menu } from "testing/__mocks__/obsidianMocks";
import ListControls from "../ListControls.svelte";

describe("ListControls", () => {
	afterEach(() => vi.restoreAllMocks());

	it("offers relevance only when an origin is available and fixes its direction", async () => {
		const showAtPosition = vi.spyOn(Menu.prototype, "showAtPosition");
		const onSortChange = vi.fn();
		const view = render(ListControls, {
			props: { sortOption: "alphabetical", onSortChange },
		});
		const trigger = screen.getByRole("button", { name: ARIA_LABELS.SORT_SELECT });
		await fireEvent.click(trigger);
		expect(
			showAtPosition.mock.contexts[0].items.some(
				(item) => item.title === "関連度",
			),
		).toBe(false);

		await view.rerender({ allowRelevanceSort: true });
		await fireEvent.click(trigger);
		showAtPosition.mock.contexts[1].items
			.find((item) => item.title === "関連度")
			?.clickHandler?.();
		expect(onSortChange).toHaveBeenLastCalledWith("relevance");
		await view.rerender({ sortOption: "relevance" });
		expect(trigger).toHaveTextContent("関連度");
		expect(screen.getByRole("button", { name: "関連度の高い順" })).toBeDisabled();
		await fireEvent.click(screen.getByRole("button", { name: "更新日時" }));
		expect(onSortChange).toHaveBeenLastCalledWith("modified-date-reverse");
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
		expect(button).toHaveTextContent("作成日時");
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
			{ title: "タイトル", icon: "type", checked: false },
			{ title: "被リンク数", icon: "links-coming-in", checked: false },
			{ title: "作成日時", icon: "calendar-plus", checked: true },
			{ title: "更新日時", icon: "clock", checked: false },
			{ title: "ファイルサイズ", icon: "hard-drive", checked: false },
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
		["タイトル", "type", "alphabetical", "alphabetical-reverse"],
		["被リンク数", "links-coming-in", "backlink-count", "backlink-count-reverse"],
		["作成日時", "calendar-plus", "created-date", "created-date-reverse"],
		["更新日時", "clock", "modified-date", "modified-date-reverse"],
		["ファイルサイズ", "hard-drive", "file-size", "file-size-reverse"],
	] as const)(
		"selects %s while preserving the sort direction",
		async (label, icon, asc, desc) => {
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
			expect(onSortChange).toHaveBeenNthCalledWith(1, asc);

			await view.rerender({ sortOption: desc });
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
			expect(onSortChange).toHaveBeenNthCalledWith(2, desc);
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
			props: { sortOption: "file-size", onSortChange },
		});
		await fireEvent.click(
			screen.getByRole("button", { name: "昇順（クリックで降順に切り替え）" }),
		);
		expect(onSortChange).toHaveBeenLastCalledWith("file-size-reverse");
		await fireEvent.click(screen.getByRole("button", { name: "更新日時" }));
		expect(onSortChange).toHaveBeenLastCalledWith("modified-date");

		await view.rerender({ sortOption: "file-size-reverse" });
		await fireEvent.click(
			screen.getByRole("button", { name: "降順（クリックで昇順に切り替え）" }),
		);
		expect(onSortChange).toHaveBeenLastCalledWith("file-size");
		await fireEvent.click(screen.getByRole("button", { name: "更新日時" }));
		expect(onSortChange).toHaveBeenLastCalledWith("modified-date-reverse");
	});

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
});
