import { materializePreCreationFile } from "../preCreationFileWorkflow";

test("creates the original path before renaming after each index transition", async () => {
	const calls: string[] = [];
	const file = { path: "Original.md" };

	const result = await materializePreCreationFile({
		creationPath: "Original.md",
		finalPath: "Renamed.md",
		createFile: async (path) => {
			calls.push(`create:${path}`);
			return file;
		},
		renameFile: async (createdFile, newPath) => {
			calls.push(`rename:${createdFile.path}->${newPath}`);
			createdFile.path = newPath;
		},
		waitForIndexIdle: async () => {
			calls.push("index-idle");
		},
	});

	expect(result).toBe(file);
	expect(calls).toEqual([
		"create:Original.md",
		"index-idle",
		"rename:Original.md->Renamed.md",
		"index-idle",
	]);
});

test("creates directly without index waits when the title is unchanged", async () => {
	const calls: string[] = [];
	const file = { path: "Original.md" };

	await materializePreCreationFile({
		creationPath: "Original.md",
		finalPath: "Original.md",
		createFile: async (path) => {
			calls.push(`create:${path}`);
			return file;
		},
		renameFile: async () => {
			calls.push("rename");
		},
		waitForIndexIdle: async () => {
			calls.push("index-idle");
		},
	});

	expect(calls).toEqual(["create:Original.md"]);
});
