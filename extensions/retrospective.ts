import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { completeSimple, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
	buildAgentNotesInput,
	buildHeuristicAnalysis,
	isAgentNotesUseful,
	mergeAnalysisWithAgentNotes,
	parseAgentNotes,
} from "../lib/retrospective/analysis";
import { buildRetrospectiveDataset } from "../lib/retrospective/core";
import { renderRetrospectiveHtml } from "../lib/retrospective/render";

const NOTES_SYSTEM_PROMPT = [
	"You write reflective notes for an AI coding retrospective.",
	"Be concrete, observant, and human.",
	"Use only the supplied conversation excerpt.",
	"Do not invent facts outside the excerpt.",
	"Focus on the project and product being built, not generic shell hygiene, unless it clearly changed the work.",
	"Return XML only, with no prose before or after it.",
	"Use this exact structure and never omit a tag:",
	"<retrospective>",
	"<summary>one short paragraph</summary>",
	"<incorrect_decisions>",
	"- item",
	"</incorrect_decisions>",
	"<unnecessary_effort>",
	"- item",
	"</unnecessary_effort>",
	"<unexpected_findings>",
	"- item",
	"</unexpected_findings>",
	"<improvements>",
	"- item",
	"</improvements>",
	"<do_differently_again>",
	"- item",
	"</do_differently_again>",
	"</retrospective>",
	"Rules:",
	"- summary must be one short paragraph",
	"- every list max 6 items",
	"- if a list has nothing useful, write '- none'",
	"- use concrete project nouns from the excerpt when possible",
	"- do_differently_again must be ambitious and project-level: different product shape, architecture, workflow, or feature strategy is good",
	"- do not fill do_differently_again with minor communication tweaks or generic shell hygiene",
	"- improvements is where small process tweaks belong",
].join("\n");

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

function notesTextFromResponse(response: Awaited<ReturnType<typeof completeSimple>>): string {
	return response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

async function runNotesCompletion(
	ctx: ExtensionCommandContext,
	message: Message,
	apiKey: string,
	headers: Record<string, string> | undefined,
) {
	return completeSimple(ctx.model!, { systemPrompt: NOTES_SYSTEM_PROMPT, messages: [message] }, {
		apiKey,
		headers,
		reasoning: "low",
		maxTokens: 1800,
	});
}

async function maybeGenerateAgentNotes(
	dataset: ReturnType<typeof buildRetrospectiveDataset>,
	ctx: ExtensionCommandContext,
): Promise<{ notes: ReturnType<typeof parseAgentNotes>; reason?: string }> {
	if (!ctx.model) return { notes: null, reason: "no current model selected" };

	const modelLabel = `${ctx.model.provider}/${ctx.model.id}`;
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) {
		const authError = "error" in auth ? auth.error : "auth lookup failed";
		return { notes: null, reason: `${modelLabel}: auth lookup failed: ${authError}` };
	}
	if (!auth.apiKey) return { notes: null, reason: `${modelLabel}: no API key available` };

	const conversationExcerpt = buildAgentNotesInput(dataset);
	const excerptChars = conversationExcerpt.length;
	if (!conversationExcerpt.trim()) return { notes: null, reason: `${modelLabel}: no post-compaction conversation excerpt available` };

	const prompt = [
		"Here is the conversation excerpt to analyze:",
		"<conversation>",
		conversationExcerpt,
		"</conversation>",
		"Now produce the retrospective in the exact XML format from the system instructions. As a reminder the format is:",
		"<retrospective>",
		"<summary>one short paragraph</summary>",
		"<incorrect_decisions>",
		"- item",
		"</incorrect_decisions>",
		"<unnecessary_effort>",
		"- item",
		"</unnecessary_effort>",
		"<unexpected_findings>",
		"- item",
		"</unexpected_findings>",
		"<improvements>",
		"- item",
		"</improvements>",
		"<do_differently_again>",
		"- item",
		"</do_differently_again>",
		"</retrospective>",
	].join("\n");

	const message: Message = {
		role: "user",
		content: [{ type: "text", text: prompt }],
		timestamp: Date.now(),
	};

	const response = await runNotesCompletion(ctx, message, auth.apiKey, auth.headers);

	if (response.stopReason === "error" || response.stopReason === "aborted") {
		const errorMessage = response.errorMessage?.trim();
		return {
			notes: null,
			reason: `${modelLabel}: notes generation ended with stopReason=${response.stopReason}${errorMessage ? `, error=${errorMessage}` : ""}, excerptChars=${excerptChars}`,
		};
	}

	const text = notesTextFromResponse(response);
	if (!text) return { notes: null, reason: `${modelLabel}: notes model returned no text, excerptChars=${excerptChars}` };

	let notes = parseAgentNotes(text);
	if (!isAgentNotesUseful(notes)) {
		const repairPrompt = [
			"The previous answer did not fully follow the required XML contract.",
			"Rewrite the draft below into the exact XML format from the system instructions.",
			"Do not add commentary.",
			"Keep the content grounded in the original excerpt.",
			"If a list is weak, write '- none'.",
			"Draft:",
			"<draft>",
			text,
			"</draft>",
		].join("\n");

		const repairResponse = await runNotesCompletion(
			ctx,
			{ role: "user", content: [{ type: "text", text: repairPrompt }], timestamp: Date.now() },
			auth.apiKey,
			auth.headers,
		);

		if (repairResponse.stopReason !== "error" && repairResponse.stopReason !== "aborted") {
			const repairedText = notesTextFromResponse(repairResponse);
			if (repairedText) notes = parseAgentNotes(repairedText);
		}
	}

	if (!isAgentNotesUseful(notes)) {
		const preview = text.replace(/\s+/g, " ").slice(0, 220);
		return {
			notes: null,
			reason: `${modelLabel}: notes response was incomplete, excerptChars=${excerptChars}, preview=${JSON.stringify(preview)}`,
		};
	}
	return { notes, reason: undefined };
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
			let modeReason: string | undefined = noNotes ? "notes disabled via --no-notes" : undefined;
			if (!noNotes) {
				try {
					const noteResult = await maybeGenerateAgentNotes(dataset, ctx);
					if (noteResult.notes) {
						analysis = mergeAnalysisWithAgentNotes(analysis, noteResult.notes);
					} else {
						modeReason = noteResult.reason ?? "notes unavailable for unknown reason";
					}
				} catch (error) {
					modeReason = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Retrospective notes fallback to heuristics (${modeReason}).`, "warning");
				}
			}
			if (analysis.generatedBy === "heuristic" && modeReason) {
				analysis.modeNote = `Using heuristic-only analysis because ${modeReason}.`;
			}

			const now = new Date();
			const title = "Conversation retrospective";
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

			const analysisModeLabel =
				analysis.generatedBy === "heuristic" && modeReason
					? `${analysis.generatedBy} (${modeReason})`
					: analysis.generatedBy;

			pi.sendMessage({
				customType: "retrospective-report",
				display: true,
				content: [
					{
						type: "text",
						text:
							`Retrospective report generated.\n- Path: ${outputPath}\n- Link: ${fileUrl}\n- Analysis mode: ${analysisModeLabel}${openStatus}`,
					},
				],
			});

			ctx.ui.notify("Retrospective generated.", "info");
		},
	});
}
