import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("user_bash", async (event, ctx) => {
		let command = event.command.trim();
		let forceInteractive = false;

		if (command.startsWith("i ") || command.startsWith("i\t")) {
			forceInteractive = true;
			command = command.slice(2).trim();
		}

		const isFishShellCommand = command === "fish" || command.startsWith("fish ");
		if (!forceInteractive && !isFishShellCommand) return;

		if (!ctx.hasUI) {
			return {
				result: {
					output: "(interactive commands require TUI mode)",
					exitCode: 1,
					cancelled: false,
					truncated: false,
				},
			};
		}

		const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
			tui.stop();
			process.stdout.write("\x1b[2J\x1b[H");

			const shell = process.env.SHELL || "/usr/bin/fish";
			const result = spawnSync(shell, ["-ic", command], {
				stdio: "inherit",
				env: process.env,
			});

			tui.start();
			tui.requestRender(true);
			done(result.status);

			return { render: () => [], invalidate: () => {} };
		});

		return {
			result: {
				output:
					exitCode === 0
						? "(interactive command completed successfully)"
						: `(interactive command exited with code ${exitCode})`,
				exitCode: exitCode ?? 1,
				cancelled: false,
				truncated: false,
			},
		};
	});
}
