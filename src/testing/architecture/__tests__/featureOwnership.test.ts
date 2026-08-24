import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

interface OwnershipBoundary {
	readonly directory: string;
	readonly forbids: (specifier: string) => boolean;
}

const SOURCE_ROOT = resolve(process.cwd(), "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".svelte"]);
const LEGACY_LAYER_DIRECTORIES = [
	"application",
	"core",
	"features",
	"infrastructure",
	"presentation",
	"types",
	"ui",
] as const;

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

function findBoundaryViolations(boundary: OwnershipBoundary): string[] {
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

describe("feature ownership", () => {
	it("does not recreate generic layer directories", () => {
		const existingDirectories = LEGACY_LAYER_DIRECTORIES.filter((directory) =>
			existsSync(resolve(SOURCE_ROOT, directory)),
		);

		expect(existingDirectories).toEqual([]);
	});

	it("keeps feature constants out of the source root", () => {
		expect(existsSync(resolve(SOURCE_ROOT, "appConstants.ts"))).toBe(false);
	});

	it("does not shadow the external obsidian package", () => {
		expect(existsSync(resolve(SOURCE_ROOT, "obsidian"))).toBe(false);
	});

	it.each<OwnershipBoundary>([
		{
			directory: "cards",
			forbids: (specifier) => specifier.startsWith("two-hop/"),
		},
		{
			directory: "preview",
			forbids: (specifier) => specifier.startsWith("two-hop/"),
		},
		{
			directory: "search",
			forbids: (specifier) => specifier.startsWith("two-hop/"),
		},
		{
			directory: "shared",
			forbids: (specifier) =>
				specifier.startsWith("cards/") ||
				specifier.startsWith("core/") ||
				specifier.startsWith("features/") ||
				specifier.startsWith("indexing/") ||
				specifier.startsWith("obsidian-integration/") ||
				specifier.startsWith("obsidian/") ||
				specifier.startsWith("preview/") ||
				specifier.startsWith("search/") ||
				specifier.startsWith("settings/") ||
				specifier.startsWith("two-hop/") ||
				specifier.startsWith("types/") ||
				specifier.startsWith("ui/"),
		},
		{
			directory: "indexing",
			forbids: (specifier) =>
				specifier.startsWith("cards/") ||
				specifier.startsWith("features/") ||
				specifier.startsWith("preview/") ||
				specifier.startsWith("two-hop/") ||
				specifier.startsWith("ui/"),
		},
	])("keeps $directory owned by its change reason", (boundary) => {
		expect(findBoundaryViolations(boundary)).toEqual([]);
	});
});
