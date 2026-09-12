import { readFileSync } from "node:fs";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function formatError(error) {
	return error instanceof Error ? error.message : String(error);
}

function readJson(path) {
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

function validateReleaseMetadata() {
	const packageResult = readJson("package.json");
	if (!packageResult.ok) return packageResult;

	const manifestResult = readJson("manifest.json");
	if (!manifestResult.ok) return manifestResult;

	const versionsResult = readJson("versions.json");
	if (!versionsResult.ok) return versionsResult;

	const packageVersion = packageResult.value.version;
	const manifestVersion = manifestResult.value.version;
	const minAppVersion = manifestResult.value.minAppVersion;
	const releaseTag = process.env.RELEASE_TAG;

	if (typeof manifestVersion !== "string" || !VERSION_PATTERN.test(manifestVersion)) {
		return {
			ok: false,
			message: "manifest.json version must use the x.y.z format.",
		};
	}

	if (packageVersion !== manifestVersion) {
		return {
			ok: false,
			message:
				`Version mismatch: package.json=${String(packageVersion)}, ` +
				`manifest.json=${manifestVersion}.`,
		};
	}

	if (releaseTag !== undefined && releaseTag !== manifestVersion) {
		return {
			ok: false,
			message: `Version mismatch: tag=${releaseTag}, manifest.json=${manifestVersion}.`,
		};
	}

	if (typeof minAppVersion !== "string" || !VERSION_PATTERN.test(minAppVersion)) {
		return {
			ok: false,
			message: "manifest.json minAppVersion must use the x.y.z format.",
		};
	}

	if (versionsResult.value[manifestVersion] !== minAppVersion) {
		return {
			ok: false,
			message: `versions.json must map ${manifestVersion} to ${minAppVersion}.`,
		};
	}

	return { ok: true, version: manifestVersion };
}

const result = validateReleaseMetadata();
if (!result.ok) {
	console.error(result.message);
	process.exitCode = 1;
} else {
	console.log(`Release metadata is valid for ${result.version}.`);
}
