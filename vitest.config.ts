import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tsconfigPaths from "vite-tsconfig-paths";
import * as path from "path";

export default defineConfig({
	plugins: [svelte(), tsconfigPaths()],
	define: {
		"process.env.NODE_ENV": JSON.stringify("test"),
	},
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			exclude: [
				"node_modules/",
				"**/__tests__/**",
				"**/__mocks__/**",
				"esbuild.config.mjs",
				"version-bump.mjs",
			],
		},
		projects: [
			{
				extends: true,
				test: {
					name: "node",
					globals: true,
					environment: "node",
					include: ["src/**/__tests__/**/*.test.ts"],
					exclude: [
						"**/*.dom.test.ts",
						"**/*.jsdom.test.ts",
						"**/*.perf.test.ts",
						"**/*.perf-contract.test.ts",
					],
					setupFiles: ["src/testing/setupNodeTests.ts"],
					pool: "threads",
				},
			},
			{
				extends: true,
				test: {
					name: "dom-unit",
					globals: true,
					environment: "jsdom",
					isolate: true,
					include: ["src/**/__tests__/**/*.dom.test.ts"],
					exclude: [
						"**/*.svelte.dom.test.ts",
						"**/*.jsdom.test.ts",
						"**/*.perf.test.ts",
						"**/*.perf-contract.test.ts",
					],
					setupFiles: ["src/testing/setupBrowserDomTests.ts"],
					pool: "threads",
				},
			},
			{
				extends: true,
				test: {
					name: "dom-svelte",
					globals: true,
					environment: "jsdom",
					include: ["src/**/__tests__/**/*.svelte.dom.test.ts"],
					exclude: ["**/*.perf.test.ts", "**/*.perf-contract.test.ts"],
					setupFiles: ["src/testing/setupSvelteDomTests.ts"],
					pool: "threads",
				},
			},
			{
				extends: true,
				test: {
					name: "jsdom",
					globals: true,
					environment: "jsdom",
					include: ["src/**/__tests__/**/*.jsdom.test.ts"],
					exclude: ["**/*.perf.test.ts", "**/*.perf-contract.test.ts"],
					setupFiles: ["src/testing/setupBrowserDomTests.ts"],
					pool: "threads",
				},
			},
			{
				extends: true,
				test: {
					name: "perf",
					globals: true,
					environment: "jsdom",
					include: ["**/*.perf.test.ts", "**/*.perf-contract.test.ts"],
					setupFiles: ["src/testing/setupBrowserDomTests.ts"],
					pool: "threads",
				},
			},
		],
	},
	resolve: {
		conditions: ["browser"],
		alias: [
			{
				find: /^obsidian$/,
				replacement: path.resolve(
					__dirname,
					"src/testing/__mocks__/obsidianMocks.ts",
				),
			},
			{
				find: "@/",
				replacement: new URL("./src/", import.meta.url).pathname,
			},
		],
	},
});
