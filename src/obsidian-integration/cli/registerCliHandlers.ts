import { Platform } from "obsidian";
import type { CliFlags } from "obsidian";
import { z } from "zod";
import type { PluginHost } from "obsidian-integration/pluginHost";
import { TwoHopLinksView, TWO_HOP_LINKS_VIEW_TYPE } from "two-hop/ui/TwoHopLinksView";
import { inspectCliPage, runCliQuery, type CliQueryAction } from "./cliQueries";
import { replaceCliLinks } from "./cliReplaceLinks";
import {
	cliBoolean,
	cliFailure,
	findCliFile,
	notePath,
	paginationShape,
	searchShape,
	type CliContext,
	type CliResult,
} from "./cliProtocol";

const pathFlags: CliFlags = {
	path: {
		description: "Exact vault-relative Markdown path",
		value: "<path.md>",
		required: true,
	},
};
const pageFlags: CliFlags = {
	limit: { description: "Maximum results (1–1000, default 100)", value: "<n>" },
	offset: { description: "Result offset (default 0)", value: "<n>" },
	sort: { description: "Sort: title, updated, created", value: "<order>" },
};
const queryFlags: CliFlags = {
	query: {
		description: "Search terms (AND by default)",
		value: "<text>",
		required: true,
	},
	or: { description: "Match any search term" },
};
/** Adds capabilities absent from the core CLI and cancels them when the plugin unloads. */
export function registerCliHandlers(plugin: PluginHost): void {
	if (!Platform.isDesktopApp) return;
	const controller = new AbortController();
	const context: CliContext = { host: plugin, signal: controller.signal };
	plugin.register(() => controller.abort());
	const commands: { command: string; description: string; flags: CliFlags }[] = [];

	function register<T>(
		action: string,
		description: string,
		flags: CliFlags,
		schema: z.ZodType<T>,
		handler: (params: T) => Promise<CliResult>,
	): void {
		const command = `${plugin.manifest.id}:${action}`;
		commands.push({ command, description, flags });
		plugin.registerCliHandler(command, description, flags, async (params) => {
			if (controller.signal.aborted)
				return JSON.stringify(cliFailure("cancelled", "Plugin unloaded"));
			const parsed = schema.safeParse(params);
			if (!parsed.success)
				return JSON.stringify(
					cliFailure("invalid-params", parsed.error.message),
				);
			try {
				return JSON.stringify(await handler(parsed.data));
			} catch (error) {
				return JSON.stringify(
					cliFailure(
						controller.signal.aborted ? "cancelled" : "io-error",
						error instanceof Error ? error.message : String(error),
					),
				);
			}
		});
	}

	const queries: [CliQueryAction, string, boolean][] = [
		[
			"list1hopLinks",
			"Merge incoming/outgoing links with direction and metadata",
			false,
		],
		["list2hopLinks", "List unique two-hop pages with intermediate paths", false],
		["search1hopLinks", "Search only one-hop pages", true],
		["search2hopLinks", "Search only two-hop pages", true],
	];
	for (const [action, description, search] of queries) {
		register(
			action,
			description,
			{ ...pathFlags, ...pageFlags, ...(search ? queryFlags : {}) },
			z.object({
				...paginationShape,
				path: notePath,
				query: search ? searchShape.query : z.undefined().optional(),
				or: cliBoolean,
			}),
			(params) => runCliQuery(context, action, params),
		);
	}
	register(
		"inspectPage",
		"Inspect a page, semantic embeds, and its one-hop/two-hop context",
		{ ...pathFlags, ...pageFlags },
		z.object({ ...paginationShape, path: notePath }),
		(params) => inspectCliPage(context, params),
	);
	register(
		"replaceLinks",
		"Replace link targets without renaming the target page",
		{
			from: {
				description: "Old target path",
				value: "<path.md>",
				required: true,
			},
			to: { description: "New target path", value: "<path.md>", required: true },
			dryRun: { description: "Report affected files without writing" },
		},
		z.object({ from: notePath, to: notePath, dryRun: cliBoolean }),
		(params) => replaceCliLinks(context, params),
	);
	register(
		"openRelatedPagesView",
		"Open the plugin's two-hop card view",
		pathFlags,
		z.object({ path: notePath }),
		async ({ path }) => {
			const found = findCliFile(plugin.app, path);
			if (!found.ok) return found;
			const leaf = plugin.app.workspace.getLeaf("tab");
			await leaf.setViewState({ type: TWO_HOP_LINKS_VIEW_TYPE, active: true });
			if (!(leaf.view instanceof TwoHopLinksView))
				return cliFailure("not-ready", "Two-hop view could not be opened");
			leaf.view.renderForFile(found.file);
			return { ok: true, path };
		},
	);
	plugin.registerCliHandler(
		plugin.manifest.id,
		"Cosense-style card links CLI: list extension commands",
		null,
		() => JSON.stringify({ ok: true, version: plugin.manifest.version, commands }),
	);
}
