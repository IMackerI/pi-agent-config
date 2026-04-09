import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const extensionsDir = join(process.cwd(), "extensions");
const external = [
	"@mariozechner/pi-coding-agent",
	"@mariozechner/pi-ai",
	"@mariozechner/pi-tui",
	"@sinclair/typebox",
];

const tempOutDir = await mkdtemp(join(tmpdir(), "pi-agent-lint-"));

try {
	const files = (await readdir(extensionsDir))
		.filter((name) => name.endsWith(".ts"))
		.map((name) => join(extensionsDir, name));

	if (files.length === 0) {
		console.log("No extension files found.");
		process.exit(0);
	}

	let hasError = false;
	for (const file of files) {
		const result = await Bun.build({
			entrypoints: [file],
			outdir: tempOutDir,
			target: "node",
			format: "esm",
			sourcemap: "none",
			external,
		});

		if (!result.success) {
			hasError = true;
			console.error(`Build check failed: ${file}`);
			for (const log of result.logs) {
				console.error(log.message);
			}
		} else {
			console.log(`OK ${file}`);
		}
	}

	if (hasError) process.exit(1);
} finally {
	await rm(tempOutDir, { recursive: true, force: true });
}
