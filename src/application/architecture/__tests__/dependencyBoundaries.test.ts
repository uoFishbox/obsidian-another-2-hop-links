import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

interface DependencyBoundary {
	readonly directory: string;
	readonly forbids: (specifier: string) => boolean;
}

const SOURCE_ROOT = resolve(process.cwd(), "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".svelte"]);

function collectSourceFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectSourceFiles(path));
			continue;
		}

		const extension = entry.name.endsWith(".svelte")
			? ".svelte"
			: entry.name.slice(entry.name.lastIndexOf("."));
		if (SOURCE_EXTENSIONS.has(extension)) files.push(path);
	}
	return files;
}

function collectModuleSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
		if (match[1]) specifiers.push(match[1]);
	}
	for (const match of source.matchAll(/\bimport\s+["']([^"']+)["']/g)) {
		if (match[1]) specifiers.push(match[1]);
	}
	return specifiers;
}

function findBoundaryViolations(boundary: DependencyBoundary): string[] {
	const directory = resolve(SOURCE_ROOT, boundary.directory);
	return collectSourceFiles(directory).flatMap((file) => {
		const source = readFileSync(file, "utf8");
		return collectModuleSpecifiers(source)
			.filter(boundary.forbids)
			.map(
				(specifier) =>
					`${relative(SOURCE_ROOT, file).split(sep).join("/")} -> ${specifier}`,
			);
	});
}

describe("dependency boundaries", () => {
	it.each<DependencyBoundary>([
		{
			directory: "ui/primitives",
			forbids: (specifier) =>
				specifier === "obsidian" ||
				specifier.startsWith("features/") ||
				specifier.startsWith("application/") ||
				specifier.startsWith("core/") ||
				specifier.startsWith("infrastructure/") ||
				specifier === "ui/stores/ApplicationStore.svelte" ||
				specifier.startsWith("ui/context/") ||
				specifier === "types" ||
				specifier.startsWith("types/"),
		},
		{
			directory: "ui/layout",
			forbids: (specifier) =>
				specifier === "obsidian" || specifier.startsWith("features/settings"),
		},
		{
			directory: "ui/virtualization",
			forbids: (specifier) =>
				specifier === "obsidian" ||
				specifier.startsWith("features/") ||
				specifier === "ui/stores/ApplicationStore.svelte",
		},
		{
			directory: "features/list-view",
			forbids: (specifier) => specifier.startsWith("features/two-hop"),
		},
		{
			directory: "application",
			forbids: (specifier) => specifier.startsWith("features/two-hop"),
		},
		{
			directory: "application/stores",
			forbids: (specifier) => specifier.startsWith("ui/"),
		},
	])("keeps $directory independent", (boundary) => {
		expect(findBoundaryViolations(boundary)).toEqual([]);
	});
});
