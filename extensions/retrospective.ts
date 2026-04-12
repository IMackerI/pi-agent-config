import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { buildAgentNotesInput, buildHeuristicAnalysis, mergeAnalysisWithAgentNotes, parseAgentNotes } from "../lib/retrospective/analysis";
import { buildRetrospectiveDataset } from "../lib/retrospective/core";
import { renderRetrospectiveHtml } from "../lib/retrospective/render";

function hasFlag(args: string, flag: string): boolean {
	return args
		.split(/\s+/)
		.map((part) => part.trim())
		.filter(Boolean)
		.includes(flag);
}

function stampForFileName(date: Date): string {
	return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function tryOpenRetrospective(pi: ExtensionAPI, filePath: string): Promise<{ ok: boolean; error?: string }> {
	try {
		if (process.platform === "darwin") {
			const result = await pi.exec("open", [filePath]);
			if (result.code !== 0) return { ok: false, error: result.stderr || result.stdout || `exit ${result.code}` };
			return { ok: true };
		}
		if (process.platform === "win32") {
			const result = await pi.exec("cmd", ["/c", "start", "", filePath]);
			if (result.code !== 0) return { ok: false, error: result.stderr || result.stdout || `exit ${result.code}` };
			return { ok: true };
		}

		const result = await pi.exec("xdg-open", [filePath]);
		if (result.code !== 0) return { ok: false, error: result.stderr || result.stdout || `exit ${result.code}` };
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

async function maybeGenerateAgentNotes(dataset: ReturnType<typeof buildRetrospectiveDataset>, ctx: ExtensionCommandContext) {
	if (!ctx.model) return null;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok || !auth.apiKey) return null;

	const conversationExcerpt = buildAgentNotesInput(dataset);
	if (!conversationExcerpt.trim()) return null;

	const prompt = [
		"Write retrospective self-notes for an AI coding assistant.",
		"Only use the provided conversation excerpt (since last compaction).",
		"Return JSON only, no markdown, with this exact schema:",
		'{"summary":"string","incorrectDecisions":["..."],"unnecessaryEffort":["..."],"unexpectedFindings":["..."],"improvements":["..."]}',
		"Constraints:",
		"- Keep summary <= 120 words",
		"- Each list max 8 items",
		"- Focus on concrete wrong decisions and unnecessary time",
		"- Be specific and actionable",
		"Conversation excerpt:",
		"<conversation>",
		conversationExcerpt,
		"</conversation>",
	].join("\n");

	const message: Message = {
		role: "user",
		content: [{ type: "text", text: prompt }],
		timestamp: Date.now(),
	};

	const response = await complete(
		ctx.model,
		{ messages: [message] },
		{ apiKey: auth.apiKey, headers: auth.headers, reasoningEffort: "minimal" },
	);

	const text = response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();

	if (!text) return null;
	return parseAgentNotes(text);
}

export default function retrospectiveExtension(pi: ExtensionAPI) {
	pi.registerCommand("retrospective", {
		description: "Generate an HTML retrospective report for the current branch",
		handler: async (args, ctx) => {
			const noOpen = hasFlag(args, "--no-open");
			const noNotes = hasFlag(args, "--no-notes");

			const branch = ctx.sessionManager.getBranch();
			if (branch.length === 0) {
				ctx.ui.notify("No session entries to analyze.", "warning");
				return;
			}

			const dataset = buildRetrospectiveDataset(
				branch,
				ctx.sessionManager.getHeader(),
				ctx.sessionManager.getLeafId(),
			);

			let analysis = buildHeuristicAnalysis(dataset);
			if (!noNotes) {
				try {
					const notes = await maybeGenerateAgentNotes(dataset, ctx);
					if (notes) {
						analysis = mergeAnalysisWithAgentNotes(analysis, notes);
					}
				} catch (error) {
					ctx.ui.notify(
						`Retrospective notes fallback to heuristics (${error instanceof Error ? error.message : String(error)}).`,
						"warning",
					);
				}
			}

			const now = new Date();
			const title = `Conversation retrospective · ${dataset.header?.id ?? "session"}`;
			const html = renderRetrospectiveHtml({
				title,
				generatedAtIso: now.toISOString(),
				dataset,
				analysis,
			});

			const outputDir = resolve(ctx.cwd, ".pi", "conversation-retrospectives");
			const outputPath = join(outputDir, `retrospective-${stampForFileName(now)}.html`);
			await mkdir(outputDir, { recursive: true });
			await writeFile(outputPath, html, "utf8");

			const fileUrl = pathToFileURL(outputPath).toString();

			let openStatus = "";
			if (!noOpen) {
				const openResult = await tryOpenRetrospective(pi, outputPath);
				if (!openResult.ok) {
					openStatus = `\n- Open status: failed (${openResult.error ?? "unknown error"})`;
				}
			}

			pi.sendMessage({
				customType: "retrospective-report",
				display: true,
				content: [
					{
						type: "text",
						text:
							`Retrospective report generated.\n- Path: ${outputPath}\n- Link: ${fileUrl}\n- Analysis mode: ${analysis.generatedBy}${openStatus}`,
					},
				],
			});

			ctx.ui.notify("Retrospective generated.", "info");
		},
	});
}
