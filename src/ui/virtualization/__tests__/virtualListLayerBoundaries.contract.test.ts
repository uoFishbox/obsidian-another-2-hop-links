import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface SourceFile {
	path: string;
	relativePath: string;
	content: string;
}

const virtualListRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const readProductionTsFiles = (directory: string): SourceFile[] => {
	const files: SourceFile[] = [];

	function walk(currentDirectory: string): void {
		for (const entry of readdirSync(currentDirectory)) {
			if (entry === "__tests__") continue;

			const path = join(currentDirectory, entry);
			const stats = statSync(path);

			if (stats.isDirectory()) {
				walk(path);
				continue;
			}

			if (!entry.endsWith(".ts")) continue;
			if (entry.endsWith(".test.ts") || entry.endsWith(".dom.test.ts")) {
				continue;
			}

			files.push({
				path,
				relativePath: relative(virtualListRoot, path).split(sep).join("/"),
				content: readFileSync(path, "utf-8"),
			});
		}
	}

	walk(directory);
	return files;
};

const findMatches = (
	files: readonly SourceFile[],
	predicate: (file: SourceFile) => boolean,
): string[] =>
	files
		.filter(predicate)
		.map((file) => file.relativePath)
		.sort();

const importPattern =
	/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

const collectImportSpecifiers = (content: string): string[] =>
	Array.from(content.matchAll(importPattern), (match) => match[1] ?? "");

const importsVirtualListLayer = (
	file: SourceFile,
	layer: "core" | "dom" | "svelte",
): boolean =>
	collectImportSpecifiers(file.content).some((specifier) => {
		const normalized = specifier.split("\\").join("/");
		return (
			normalized === `../${layer}` ||
			normalized.startsWith(`../${layer}/`) ||
			normalized.includes(`/virtualization/${layer}/`) ||
			normalized.includes(`/virtualization/${layer}`)
		);
	});

const importsSvelteRuntime = (file: SourceFile): boolean =>
	collectImportSpecifiers(file.content).some((specifier) => {
		const normalized = specifier.split("\\").join("/");
		return (
			normalized === "svelte" ||
			normalized.startsWith("svelte/") ||
			normalized.endsWith(".svelte") ||
			normalized.includes(".svelte.")
		);
	});

describe("virtual-list layer boundaries", () => {
	const productionFiles = readProductionTsFiles(virtualListRoot);
	const coreFiles = readProductionTsFiles(join(virtualListRoot, "core"));
	const domFiles = readProductionTsFiles(join(virtualListRoot, "dom"));
	const svelteFiles = readProductionTsFiles(join(virtualListRoot, "svelte"));

	it("keeps core independent from DOM and Svelte layers", () => {
		expect(
			findMatches(
				coreFiles,
				(file) =>
					importsVirtualListLayer(file, "dom") ||
					importsVirtualListLayer(file, "svelte") ||
					importsSvelteRuntime(file),
			),
		).toEqual([]);
	});

	it("keeps DOM globals out of core source files", () => {
		expect(
			findMatches(coreFiles, (file) =>
				/\b(?:HTMLElement|Window|Document|ResizeObserver|MutationObserver)\b/.test(
					file.content,
				),
			),
		).toEqual([]);
	});

	it("keeps dom independent from Svelte", () => {
		expect(
			findMatches(
				domFiles,
				(file) =>
					importsVirtualListLayer(file, "svelte") ||
					importsSvelteRuntime(file),
			),
		).toEqual([]);
	});

	it("keeps non-svelte production TypeScript independent from Svelte runtime files", () => {
		expect(
			findMatches(
				productionFiles,
				(file) =>
					!file.relativePath.startsWith("svelte/") &&
					importsSvelteRuntime(file),
			),
		).toEqual([]);
	});

	it("keeps scroll-window range resolution out of the Svelte layer", () => {
		expect(
			findMatches(svelteFiles, (file) =>
				/\bfindVisibleRanges?(?:FromMounted)?Into\b/.test(file.content),
			),
		).toEqual([]);
	});

	it("keeps DOM observer and scroll-container cache implementations in the DOM layer", () => {
		expect(
			findMatches(
				productionFiles,
				(file) =>
					!file.relativePath.startsWith("dom/") &&
					/\b(?:ResizeObserver|MutationObserver|findNearestScrollContainerCached|invalidateNearestScrollContainerCache|nearestScrollContainerCache)\b/.test(
						file.content,
					),
			),
		).toEqual([]);
	});
});
