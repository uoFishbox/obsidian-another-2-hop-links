import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ListControls from "../ListControls.svelte";

describe("ListControls", () => {
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

		expect(screen.getByPlaceholderText("Search note titles...")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Enable full-text search" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Disable full-text search" }),
		).not.toBeInTheDocument();
	});
});
