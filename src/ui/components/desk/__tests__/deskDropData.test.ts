import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { CANVAS_NOTE_DRAG_FORMAT } from "../../../../appConstants";
import {
	canAcceptDeskDrop,
	DESK_CARD_DRAG_FORMAT,
	resolveDeskDropFile,
} from "../deskDropData";

function getPathBasename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

function createFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = getPathBasename(path);
	file.basename = file.name.replace(/\.[^.]+$/, "");
	file.extension = file.name.split(".").pop() ?? "";
	return file;
}

function createApp(
	paths: string[],
	basePath = "J:/vault",
	draggable?: unknown,
) {
	const files = new Map(paths.map((path) => [path, createFile(path)]));
	const vault = {
		adapter: {
			getBasePath: vi.fn(() => basePath),
		},
		getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
	};
	const metadataCache = {
		getFirstLinkpathDest: vi.fn((path: string) => {
			const normalized = path.endsWith(".md") ? path : `${path}.md`;
			return files.get(normalized) ?? files.get(path) ?? null;
		}),
	};

	return {
		app: { vault, metadataCache, dragManager: { draggable } } as never,
		files,
		vault,
		metadataCache,
	};
}

function createDataTransfer(
	data: Record<string, string>,
	files?: Array<File & { path?: string }>,
): DataTransfer {
	return {
		types: Object.keys(data).concat(files?.length ? ["Files"] : []),
		files: files as unknown as FileList,
		getData: vi.fn((type: string) => data[type] ?? ""),
	} as unknown as DataTransfer;
}

function nativeFile(path: string): File & { path?: string } {
	return { path } as unknown as File & { path?: string };
}

describe("deskDropData", () => {
	it("accepts custom, text, URI, and native file drop formats", () => {
		expect(
			canAcceptDeskDrop(
				createDataTransfer({ [DESK_CARD_DRAG_FORMAT]: "A.md" }),
			),
		).toBe(true);
		expect(
			canAcceptDeskDrop(createDataTransfer({ "text/plain": "[[A]]" })),
		).toBe(true);
		expect(
			canAcceptDeskDrop(
				createDataTransfer({ "text/uri-list": "obsidian://open" }),
			),
		).toBe(true);
		expect(
			canAcceptDeskDrop(
				createDataTransfer({}, [nativeFile("J:/vault/A.md")]),
			),
		).toBe(true);
		expect(
			canAcceptDeskDrop(createDataTransfer({ "text/html": "<p>A</p>" })),
		).toBe(false);
	});

	it("resolves custom desk and canvas paths before text data", () => {
		const { app, files } = createApp(["Folder/Note.md", "Other.md"]);
		const dataTransfer = createDataTransfer({
			[CANVAS_NOTE_DRAG_FORMAT]: "Folder/Note.md",
			"text/plain": "[[Other]]",
		});

		expect(resolveDeskDropFile(app, dataTransfer)).toBe(
			files.get("Folder/Note.md"),
		);
	});

	it("resolves wiki links and markdown links from text/plain", () => {
		const { app, files } = createApp(["Folder/Note.md"]);

		expect(
			resolveDeskDropFile(
				app,
				createDataTransfer({ "text/plain": "![[Folder/Note|Alias]]" }),
			),
		).toBe(files.get("Folder/Note.md"));
		expect(
			resolveDeskDropFile(
				app,
				createDataTransfer({ "text/plain": "[Note](Folder/Note.md)" }),
			),
		).toBe(files.get("Folder/Note.md"));
	});

	it("resolves obsidian URLs and file URLs to vault files", () => {
		const { app, files } = createApp(["Folder/Note.md"], "J:/vault");

		expect(
			resolveDeskDropFile(
				app,
				createDataTransfer({
					"text/uri-list":
						"obsidian://open?vault=vault&file=Folder%2FNote.md",
				}),
			),
		).toBe(files.get("Folder/Note.md"));
		expect(
			resolveDeskDropFile(
				app,
				createDataTransfer({
					"text/uri-list": "file:///J:/vault/Folder/Note.md",
				}),
			),
		).toBe(files.get("Folder/Note.md"));
	});

	it("resolves native files only when they are inside the vault", () => {
		const { app, files } = createApp(["Folder/Note.md"], "J:/vault");

		expect(
			resolveDeskDropFile(
				app,
				createDataTransfer({}, [
					nativeFile("J:\\vault\\Folder\\Note.md"),
				]),
			),
		).toBe(files.get("Folder/Note.md"));
		expect(
			resolveDeskDropFile(
				app,
				createDataTransfer({}, [
					nativeFile("J:\\outside\\Folder\\Note.md"),
				]),
			),
		).toBeNull();
	});

	it("accepts and resolves editor link drags with a resolved file", () => {
		const file = createFile("Folder/Note.md");
		const { app } = createApp(["Folder/Note.md"], "J:/vault", {
			type: "link",
			linktext: "Folder/Note",
			sourcePath: "Source.md",
			file,
		});
		const dataTransfer = createDataTransfer({});

		expect(canAcceptDeskDrop(dataTransfer, app)).toBe(true);
		expect(resolveDeskDropFile(app, dataTransfer, "Fallback.md")).toBe(
			file,
		);
	});

	it("resolves editor link drags from linktext and sourcePath when file is missing", () => {
		const { app, files, metadataCache } = createApp(
			["Folder/Note.md"],
			"J:/vault",
			{
				type: "link",
				linktext: "Folder/Note#Heading",
				sourcePath: "Source.md",
				file: null,
			},
		);

		expect(
			resolveDeskDropFile(app, createDataTransfer({}), "Fallback.md"),
		).toBe(files.get("Folder/Note.md"));
		expect(metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
			"Folder/Note",
			"Source.md",
		);
	});

	it("accepts and resolves File Explorer single file drags", () => {
		const file = createFile("Folder/Note.md");
		const { app } = createApp(["Folder/Note.md"], "J:/vault", {
			type: "file",
			file,
		});
		const dataTransfer = createDataTransfer({
			"text/plain": "obsidian://open?vault=vault&file=Folder%2FNote.md",
		});

		expect(canAcceptDeskDrop(dataTransfer, app)).toBe(true);
		expect(resolveDeskDropFile(app, dataTransfer)).toBe(file);
	});

	it("accepts and resolves the first file from File Explorer multi-select drags", () => {
		const folder = { path: "Folder", name: "Folder" };
		const firstFile = createFile("Folder/A.md");
		const secondFile = createFile("Folder/B.md");
		const { app } = createApp(["Folder/A.md", "Folder/B.md"], "J:/vault", {
			type: "files",
			files: [folder, firstFile, secondFile],
		});

		expect(canAcceptDeskDrop(createDataTransfer({}), app)).toBe(true);
		expect(resolveDeskDropFile(app, createDataTransfer({}))).toBe(
			firstFile,
		);
	});
});
