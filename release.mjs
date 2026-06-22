import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const RELEASE_ASSETS = ["main.js", "styles.css", "manifest.json"];

function readJson(path) {
	try {
		return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) };
	} catch (error) {
		return {
			ok: false,
			message: `Failed to read ${path}: ${formatError(error)}`,
		};
	}
}

function formatError(error) {
	return error instanceof Error ? error.message : String(error);
}

function resolveVersion() {
	const manifestResult = readJson("manifest.json");
	if (!manifestResult.ok) return manifestResult;

	const packageResult = readJson("package.json");
	if (!packageResult.ok) return packageResult;

	const manifestVersion = manifestResult.value.version;
	const packageVersion = packageResult.value.version;

	if (typeof manifestVersion !== "string" || manifestVersion.length === 0) {
		return { ok: false, message: "manifest.json has no valid version." };
	}

	if (manifestVersion !== packageVersion) {
		return {
			ok: false,
			message:
				`Version mismatch: manifest.json=${manifestVersion}, ` +
				`package.json=${String(packageVersion)}.`,
		};
	}

	return { ok: true, value: manifestVersion };
}

function findMissingAssets() {
	return RELEASE_ASSETS.filter((asset) => !existsSync(asset));
}

function runGitHubRelease(version) {
	return spawnSync(
		"gh",
		[
			"release",
			"create",
			version,
			...RELEASE_ASSETS,
			"--title",
			version,
			"--generate-notes",
		],
		{ stdio: "inherit" },
	);
}

function main() {
	const versionResult = resolveVersion();
	if (!versionResult.ok) {
		console.error(versionResult.message);
		return 1;
	}

	const missingAssets = findMissingAssets();
	if (missingAssets.length > 0) {
		console.error(`Missing release assets: ${missingAssets.join(", ")}`);
		return 1;
	}

	const result = runGitHubRelease(versionResult.value);
	if (result.error) {
		console.error(`Failed to start GitHub CLI: ${formatError(result.error)}`);
		return 1;
	}

	return result.status ?? 1;
}

process.exitCode = main();
