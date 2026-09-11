import { Platform } from "obsidian";
import type { CliFlags } from "obsidian";
import type { PluginHost } from "obsidian-integration/pluginHost";
import type { CliAction } from "./executeCliHandler";

interface CliCommandDefinition {
	readonly action: CliAction;
	readonly description: string;
	readonly flags: CliFlags;
}

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
const commandDefinitions: readonly CliCommandDefinition[] = [
	{
		action: "list1hopLinks",
		description: "Merge incoming/outgoing links with direction and metadata",
		flags: { ...pathFlags, ...pageFlags },
	},
	{
		action: "list2hopLinks",
		description: "List unique two-hop pages with intermediate paths",
		flags: { ...pathFlags, ...pageFlags },
	},
	{
		action: "search1hopLinks",
		description: "Search only one-hop pages",
		flags: { ...pathFlags, ...pageFlags, ...queryFlags },
	},
	{
		action: "search2hopLinks",
		description: "Search only two-hop pages",
		flags: { ...pathFlags, ...pageFlags, ...queryFlags },
	},
	{
		action: "inspectPage",
		description: "Inspect a page, semantic embeds, and its one-hop/two-hop context",
		flags: { ...pathFlags, ...pageFlags },
	},
	{
		action: "replaceLinks",
		description: "Replace link targets without renaming the target page",
		flags: {
			from: {
				description: "Old target path",
				value: "<path.md>",
				required: true,
			},
			to: {
				description: "New target path",
				value: "<path.md>",
				required: true,
			},
			dryRun: { description: "Report affected files without writing" },
		},
	},
	{
		action: "openRelatedPagesView",
		description: "Open the plugin's two-hop card view",
		flags: pathFlags,
	},
];

/** Registers lightweight CLI entry points and loads implementations on demand. */
export function registerCliHandlers(plugin: PluginHost): void {
	if (!Platform.isDesktopApp) return;

	const controller = new AbortController();
	plugin.register(() => controller.abort());

	for (const definition of commandDefinitions) {
		const command = `${plugin.manifest.id}:${definition.action}`;
		plugin.registerCliHandler(
			command,
			definition.description,
			definition.flags,
			async (params) => {
				if (controller.signal.aborted) {
					return serializeFailure("cancelled", "Plugin unloaded");
				}

				try {
					const { executeCliHandler } = await import("./executeCliHandler");
					return JSON.stringify(
						await executeCliHandler(
							plugin,
							controller.signal,
							definition.action,
							params,
						),
					);
				} catch (error) {
					return serializeFailure(
						controller.signal.aborted ? "cancelled" : "io-error",
						error instanceof Error ? error.message : String(error),
					);
				}
			},
		);
	}

	plugin.registerCliHandler(
		plugin.manifest.id,
		"Cosense-style card links CLI: list extension commands",
		null,
		() =>
			JSON.stringify({
				ok: true,
				version: plugin.manifest.version,
				commands: commandDefinitions.map(({ action, description, flags }) => ({
					command: `${plugin.manifest.id}:${action}`,
					description,
					flags,
				})),
			}),
	);
}

function serializeFailure(code: "cancelled" | "io-error", message: string): string {
	return JSON.stringify({ ok: false, error: { code, message } });
}
