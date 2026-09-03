import { Platform } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexedLink } from "indexing/model";
import { registerCliHandlers } from "../registerCliHandlers";
import { createCliTestVault } from "./cliTestVault";
import { TwoHopLinksView } from "two-hop/ui/TwoHopLinksView";
import type { LinkCache, WorkspaceLeaf } from "obsidian";

vi.mock("two-hop/ui/TwoHopLinksView", () => ({
	TwoHopLinksView: vi.fn(),
	TWO_HOP_LINKS_VIEW_TYPE: "test-two-hop",
}));

const vaults: ReturnType<typeof createCliTestVault>[] = [];
function setup(contents: Record<string, string> = {}) {
	const vault = createCliTestVault(contents);
	vaults.push(vault);
	registerCliHandlers(vault.host);
	return vault;
}

function embedReference(
	original: string,
	link: string,
	offset: number,
	displayText?: string,
): LinkCache {
	return {
		original,
		link,
		displayText,
		position: {
			start: { line: 0, col: offset, offset },
			end: {
				line: 0,
				col: offset + original.length,
				offset: offset + original.length,
			},
		},
	};
}

afterEach(() => {
	vaults.splice(0).forEach((vault) => vault.destroy());
	vi.restoreAllMocks();
	Object.assign(Platform, { isDesktopApp: true });
});

describe("registered CLI read and graph commands", () => {
	it("opens and renders the requested page in the plugin card view", async () => {
		const vault = setup({ "A.md": "" });
		const view = Object.create(TwoHopLinksView.prototype) as TwoHopLinksView;
		view.renderForFile = vi.fn();
		const setViewState = vi.fn().mockResolvedValue(undefined);
		vi.spyOn(vault.host.app.workspace, "getLeaf").mockReturnValue({
			view,
			setViewState,
		} as unknown as WorkspaceLeaf);
		expect(
			await vault.call("openRelatedPagesView", { path: "A.md" }),
		).toMatchObject({
			ok: true,
		});
		expect(setViewState).toHaveBeenCalledWith({
			type: "test-two-hop",
			active: true,
		});
		expect(view.renderForFile).toHaveBeenCalledWith(vault.files.get("A.md"));
	});

	it("expands local and remote embeds into semantic inspection objects", async () => {
		const localEmbed = "![[attachments/architecture.png]]";
		const remoteEmbed = "![System](https://cdn.example.com/system.svg?revision=1)";
		const content = `# Foo\n${localEmbed}\n${remoteEmbed}\n\`![[ignored.png]]\``;
		const vault = setup({
			"Foo.md": content,
			"attachments/architecture.png": "",
		});
		vault.metadata.set("Foo.md", {
			embeds: [
				embedReference(
					localEmbed,
					"attachments/architecture.png",
					content.indexOf(localEmbed),
				),
			],
		});

		expect(await vault.call("inspectPage", { path: "Foo.md" })).toMatchObject({
			ok: true,
			page: {
				content:
					'# Foo\n<obsidian:file type="image/png" path="attachments/architecture.png" embeddedFrom="Foo.md" />\n' +
					'<obsidian:url type="image/svg+xml" url="https://cdn.example.com/system.svg?revision=1" embeddedFrom="Foo.md" displayText="System" />\n' +
					"`![[ignored.png]]`",
				embeds: [
					{
						kind: "file",
						type: "image/png",
						path: "attachments/architecture.png",
						embeddedFrom: "Foo.md",
						original: localEmbed,
						resolved: true,
					},
					{
						kind: "url",
						type: "image/svg+xml",
						url: "https://cdn.example.com/system.svg?revision=1",
						embeddedFrom: "Foo.md",
						original: remoteEmbed,
					},
				],
			},
		});
	});

	it("detects extensionless remote images without reading code examples as embeds", async () => {
		const remoteEmbed = "![Gyazo](https://gyazo.com/example/max_size/1000)";
		const content = [
			`inline \`${remoteEmbed}\``,
			"```md",
			remoteEmbed,
			"```",
			remoteEmbed,
		].join("\n");
		const vault = setup({ "Remote.md": content });

		expect(await vault.call("inspectPage", { path: "Remote.md" })).toMatchObject({
			ok: true,
			page: {
				content:
					[`inline \`${remoteEmbed}\``, "```md", remoteEmbed, "```"].join(
						"\n",
					) +
					'\n<obsidian:url type="image/*" url="https://gyazo.com/example/max_size/1000" embeddedFrom="Remote.md" displayText="Gyazo" />',
				embeds: [
					{
						kind: "url",
						type: "image/*",
						url: "https://gyazo.com/example/max_size/1000",
						original: remoteEmbed,
					},
				],
			},
		});
	});
	it("registers namespaced commands with host help flags", async () => {
		const vault = setup();
		expect(vault.handlers.size).toBe(8);
		expect(
			vault.handlers.get("test-plugin:list2hopLinks")?.flags?.path.required,
		).toBe(true);
		for (const action of [
			"readPage",
			"listPages",
			"searchFullText",
			"readFileInfo",
			"uploadFile",
			"downloadFile",
			"deleteFile",
			"browsePage",
			"previewEdit",
			"previewDelete",
			"submitEdit",
		])
			expect(vault.handlers.has(`test-plugin:${action}`)).toBe(false);
		expect(vault.handlers.has("test-plugin:browseRelatedPages")).toBe(false);
		expect(await vault.call("")).toMatchObject({
			ok: true,
			version: "1.0.0",
			commands: expect.any(Array),
		});
		vault.destroy();
		expect(await vault.call("list2hopLinks")).toMatchObject({
			ok: false,
			error: { code: "cancelled" },
		});
	});

	it("does not register desktop CLI commands on mobile", () => {
		Object.assign(Platform, { isDesktopApp: false });
		const vault = setup();
		expect(vault.handlers.size).toBe(0);
	});

	it("requires an exact path without falling back to a same-named page", async () => {
		const vault = setup({ "notes/A.md": "first\r\n日本語\r\n" });
		expect(await vault.call("list2hopLinks", { path: "A.md" })).toMatchObject({
			ok: false,
			error: { code: "not-found" },
		});
	});

	it.each([
		"../A.md",
		"/A.md",
		"C:/A.md",
		".obsidian/settings.md",
		"a/../b.md",
		"a\\b.md",
		"A.txt",
	])("rejects invalid note path %s", async (path) => {
		expect(await setup().call("list2hopLinks", { path })).toMatchObject({
			ok: false,
			error: { code: "invalid-params" },
		});
	});

	it("paginates deterministically and rejects invalid limits and empty searches", async () => {
		const vault = setup({ "Origin.md": "", "C.md": "", "A.md": "", "B.md": "" });
		expect(
			await vault.call("list1hopLinks", {
				path: "Origin.md",
				limit: "1",
				offset: "1",
			}),
		).toMatchObject({
			ok: true,
			count: 3,
			links1hop: [{ path: "B.md" }],
			pagination: { nextOffset: 2 },
		});
		for (const limit of ["0", "1001", "1.5", "-1", "abc"]) {
			expect(
				await vault.call("list1hopLinks", { path: "Origin.md", limit }),
			).toMatchObject({ ok: false, error: { code: "invalid-params" } });
		}
		expect(
			await vault.call("search1hopLinks", { path: "Origin.md", query: " " }),
		).toMatchObject({ ok: false, error: { code: "invalid-params" } });
	});

	it("reports bidirectional one-hop links and unique two-hop pages through missing targets", async () => {
		const vault = setup({
			"A.md": "# A\n本文",
			"B.md": "",
			"C.md": "",
			"D.md": "",
			"E.md": "",
		});
		const origin = vault.files.get("A.md")!;
		const link = (
			source: string,
			path: string,
			unresolved = false,
		): IndexedLink => ({
			sourceFile: vault.files.get(source)!,
			path: unresolved ? undefined : path,
			lookupPath: path,
			rawText: path,
			isUnresolved: unresolved,
		});
		vault.getTwoHopLinkResult.mockResolvedValue({
			originFile: origin,
			taggedNotes: [],
			backlinks: [
				link("B.md", "A.md"),
				link("B.md", "A.md"),
				link("D.md", "A.md"),
			],
			branches: [
				{
					hop1: link("A.md", "B.md"),
					hop2: [
						link("C.md", "B.md"),
						link("D.md", "B.md"),
						link("A.md", "B.md"),
					],
				},
				{
					hop1: link("A.md", "Missing.md", true),
					hop2: [link("C.md", "Missing.md"), link("E.md", "Missing.md")],
				},
			],
		});
		expect(await vault.call("list1hopLinks", { path: "A.md" })).toMatchObject({
			count: 3,
			links1hop: [
				{ path: "B.md", relation: "bidirectional" },
				{ path: "D.md", relation: "incoming" },
				{ path: "Missing.md", persistent: false, relation: "outgoing" },
			],
		});
		expect(await vault.call("list2hopLinks", { path: "A.md" })).toMatchObject({
			count: 2,
			links2hop: [
				{ path: "C.md", via: ["B.md", "Missing.md"] },
				{ path: "E.md", via: ["Missing.md"] },
			],
		});
		expect(
			await vault.call("inspectPage", { path: "A.md", limit: "1" }),
		).toMatchObject({
			ok: true,
			path: "A.md",
			page: { path: "A.md", content: "# A\n本文" },
			relatedPages: {
				oneHop: {
					count: 3,
					items: [{ path: "B.md", relation: "bidirectional" }],
					pagination: { nextOffset: 1 },
				},
				twoHop: {
					count: 2,
					items: [{ path: "C.md", via: ["B.md", "Missing.md"] }],
					pagination: { nextOffset: 1 },
				},
			},
		});
		expect(vault.read).toHaveBeenCalledWith(origin);
		expect(vault.host.app.workspace.getLeaf).not.toHaveBeenCalled();
		expect(vault.getTwoHopLinkResult).toHaveBeenCalledWith(origin, undefined, {
			includeTaggedNotes: false,
			signal: expect.any(AbortSignal),
		});
	});

	it("searches full content with AND/OR and reads each candidate once", async () => {
		const vault = setup({
			"Origin.md": "",
			"Alpha.md": "beta",
			"Other.md": "alpha only",
			"None.md": "none",
		});
		expect(
			await vault.call("search1hopLinks", {
				path: "Origin.md",
				query: "alpha beta",
			}),
		).toMatchObject({
			count: 1,
			links1hop: [
				{ path: "Alpha.md", search: { contentMatched: true, offset: 0 } },
			],
		});
		vault.read.mockClear();
		expect(
			await vault.call("search1hopLinks", {
				path: "Origin.md",
				query: "alpha beta",
				or: "true",
			}),
		).toMatchObject({ count: 2 });
		expect(vault.read).toHaveBeenCalledTimes(2);
	});

	it("returns a cancellation instead of a partial search when unloaded during IO", async () => {
		const vault = setup({ "Origin.md": "", "A.md": "needle" });
		vault.read.mockImplementationOnce(async () => {
			vault.destroy();
			return "needle";
		});
		expect(
			await vault.call("search1hopLinks", { path: "Origin.md", query: "needle" }),
		).toMatchObject({ ok: false, error: { code: "cancelled" } });
	});

	it("converts host IO exceptions into a JSON failure", async () => {
		const vault = setup({ "A.md": "" });
		vault.getTwoHopLinkResult.mockRejectedValueOnce(new Error("unreadable"));
		expect(await vault.call("list2hopLinks", { path: "A.md" })).toMatchObject({
			ok: false,
			error: { code: "io-error", message: "unreadable" },
		});
	});
});
