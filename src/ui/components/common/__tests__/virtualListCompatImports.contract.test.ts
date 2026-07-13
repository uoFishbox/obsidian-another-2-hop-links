import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const commonRoot = join(sourceRoot, "ui", "components", "common");

const compatModules = new Set(
	[
		"virtualGridLinkListLayout.ts",
		"VirtualListCellMount.svelte",
		"virtualListHelpers.svelte.ts",
		"virtualListKeyboard.ts",
		"virtualListMeasurement.ts",
		"virtualListMeasurementState.ts",
		"virtualListRuntime.ts",
		"virtualListScroll.ts",
		"rowRange.ts",
		"VirtualGridLinkListCellMount.svelte",
		"ViewPlanVirtualListCellMount.svelte",
		"ViewPlanVirtualListItemCell.svelte",
		"virtual-list/providers/flatLinkRowProvider.ts",
	].map((fileName) => normalize(join(commonRoot, fileName))),
);

const sourceExtensions = [".ts", ".svelte", ".svelte.ts"];

const importSpecifierPattern =
	/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

const collectSourceFiles = (directory: string): string[] => {
	const files: string[] = [];
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) {
			if (entry === "__tests__") {
				continue;
			}
			files.push(...collectSourceFiles(path));
			continue;
		}

		if (sourceExtensions.some((extension) => path.endsWith(extension))) {
			files.push(normalize(path));
		}
	}
	return files;
};

const resolveImportSpecifier = (importer: string, specifier: string): string | null => {
	if (specifier.startsWith(".")) {
		return resolveWithExtensions(resolve(dirname(importer), specifier));
	}

	if (specifier.startsWith("ui/")) {
		return resolveWithExtensions(
			join(sourceRoot, "ui", specifier.slice("ui/".length)),
		);
	}

	return null;
};

const resolveWithExtensions = (path: string): string | null => {
	const normalizedPath = normalize(path);
	if (existsSync(normalizedPath) && statSync(normalizedPath).isFile()) {
		return normalizedPath;
	}

	for (const extension of sourceExtensions) {
		const candidate = normalize(`${path}${extension}`);
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return null;
};

describe("virtual list compatibility imports", () => {
	it("does not keep deprecated virtual list wrappers", () => {
		const existingWrappers = Array.from(compatModules)
			.filter((modulePath) => existsSync(modulePath))
			.map((modulePath) => relative(sourceRoot, modulePath));

		expect(existingWrappers).toEqual([]);
	});

	it("keeps deprecated virtual list wrappers out of production code", () => {
		const violations: string[] = [];

		for (const sourceFile of collectSourceFiles(sourceRoot)) {
			if (compatModules.has(sourceFile)) {
				continue;
			}

			const source = readFileSync(sourceFile, "utf8");
			for (const match of source.matchAll(importSpecifierPattern)) {
				const resolvedSpecifier = resolveImportSpecifier(sourceFile, match[1]);
				if (resolvedSpecifier && compatModules.has(resolvedSpecifier)) {
					violations.push(
						`${relative(sourceRoot, sourceFile)} -> ${relative(
							sourceRoot,
							resolvedSpecifier,
						)}`,
					);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
