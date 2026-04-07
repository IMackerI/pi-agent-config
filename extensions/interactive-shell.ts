import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const FISH = "/usr/bin/fish";

function getFishHistoryPath(): string | null {
	const dataHome = process.env.XDG_DATA_HOME;
	if (dataHome) return path.join(dataHome, "fish", "fish_history");

	const home = process.env.HOME;
	if (!home) return null;
	return path.join(home, ".local", "share", "fish", "fish_history");
}

function readFishHistoryCommands(historyPath: string | null): string[] {
	if (!historyPath) return [];
	try {
		const content = fs.readFileSync(historyPath, "utf8");
		return [...content.matchAll(/^- cmd: (.*)$/gm)].map((m) => m[1]);
	} catch {
		return [];
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("user_bash", async (event, ctx) => {
		if (event.command.trim() !== "fish") return;

		if (!ctx.hasUI) {
			return {
				result: {
					output: "(interactive fish requires TUI mode)",
					exitCode: 1,
					cancelled: false,
					truncated: false,
				},
			};
		}

		const shouldCaptureCommands = !event.excludeFromContext;
		const fishHistoryPath = shouldCaptureCommands ? getFishHistoryPath() : null;
		const beforeCommands = shouldCaptureCommands ? readFishHistoryCommands(fishHistoryPath) : [];

		const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
			tui.stop();
			process.stdout.write("\x1b[2J\x1b[H");

			const result = spawnSync(FISH, [], { stdio: "inherit", env: process.env });

			tui.start();
			tui.requestRender(true);
			done(result.status);

			return { render: () => [], invalidate: () => {} };
		});

		const finalExitCode = exitCode ?? 1;
		const outputLines: string[] = [];
		if (finalExitCode === 0) outputLines.push("(interactive fish session completed successfully)");
		else outputLines.push(`(interactive fish exited with code ${finalExitCode})`);

		if (shouldCaptureCommands) {
			const afterCommands = readFishHistoryCommands(fishHistoryPath);
			const capturedCommands =
				afterCommands.length >= beforeCommands.length ? afterCommands.slice(beforeCommands.length) : [];

			if (capturedCommands.length > 0) {
				outputLines.push("", "commands executed in fish:", ...capturedCommands.map((cmd) => `- ${cmd}`));
			} else {
				outputLines.push("", "(no fish commands captured)");
			}
		}

		return {
			result: {
				output: outputLines.join("\n"),
				exitCode: finalExitCode,
				cancelled: false,
				truncated: false,
			},
		};
	});
}
