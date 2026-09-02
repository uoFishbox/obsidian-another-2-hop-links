interface PreCreationFileWorkflowOptions<TFile> {
	creationPath: string;
	finalPath: string;
	createFile(path: string): Promise<TFile>;
	renameFile(file: TFile, newPath: string): Promise<void>;
	waitForIndexIdle(): Promise<void>;
}

export async function materializePreCreationFile<TFile>(
	options: PreCreationFileWorkflowOptions<TFile>,
): Promise<TFile> {
	const file = await options.createFile(options.creationPath);
	if (options.creationPath === options.finalPath) {
		return file;
	}

	await options.waitForIndexIdle();
	await options.renameFile(file, options.finalPath);
	await options.waitForIndexIdle();
	return file;
}
