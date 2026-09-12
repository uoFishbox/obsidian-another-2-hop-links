import { readFileSync, writeFileSync } from "node:fs";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function formatError(error) {
	return error instanceof Error ? error.message : String(error);
}

function readJsonObject(path) {
	try {
		const value = JSON.parse(readFileSync(path, "utf8"));
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return { ok: false, message: `${path} must contain a JSON object.` };
		}
		return { ok: true, value };
	} catch (error) {
		return {
			ok: false,
			message: `Failed to read ${path}: ${formatError(error)}`,
		};
	}
}

function prepareVersionUpdate() {
	const targetVersion = process.env.npm_package_version;
	if (typeof targetVersion !== "string" || !VERSION_PATTERN.test(targetVersion)) {
		return {
			ok: false,
			message: "npm_package_version must use the x.y.z format.",
		};
	}

	const manifestResult = readJsonObject("manifest.json");
	if (!manifestResult.ok) return manifestResult;

	const versionsResult = readJsonObject("versions.json");
	if (!versionsResult.ok) return versionsResult;

	const minAppVersion = manifestResult.value.minAppVersion;
	if (typeof minAppVersion !== "string" || !VERSION_PATTERN.test(minAppVersion)) {
		return {
			ok: false,
			message: "manifest.json minAppVersion must use the x.y.z format.",
		};
	}

	return {
		ok: true,
		manifest: { ...manifestResult.value, version: targetVersion },
		versions: { ...versionsResult.value, [targetVersion]: minAppVersion },
	};
}

const result = prepareVersionUpdate();
if (!result.ok) {
	console.error(result.message);
	process.exitCode = 1;
} else {
	writeFileSync("manifest.json", `${JSON.stringify(result.manifest, null, "\t")}\n`);
	writeFileSync("versions.json", `${JSON.stringify(result.versions, null, "\t")}\n`);
}
