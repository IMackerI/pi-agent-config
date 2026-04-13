import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolCall, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import type { RetrospectiveDataset, ToolCallRecord } from "./core";

export interface AnalysisEvidence {
	entryId: string;
	timestampIso?: string;
	toolName?: string;
	note?: string;
}

export interface AnalysisPoint {
	title: string;
	description: string;
	evidence: AnalysisEvidence[];
}

export interface AgentNotes {
	summary: string;
	incorrectDecisions: string[];
	unnecessaryEffort: string[];
	unexpectedFindings: string[];
	improvements: string[];
	doDifferentlyAgain: string[];
}

export interface RetrospectiveAnalysis {
	generatedBy: "heuristic" | "heuristic+notes";
	summary: string;
	incorrectDecisions: AnalysisPoint[];
	unnecessaryEffort: AnalysisPoint[];
	unexpectedFindings: AnalysisPoint[];
	improvements: string[];
	doDifferentlyAgain: string[];
	modeNote?: string;
	agentNotes?: AgentNotes;
}

function makeEvidence(entryId: string, timestampIso: string | undefined, toolName?: string, note?: string): AnalysisEvidence {
	return { entryId, timestampIso, toolName, note };
}

function textIncludesAny(text: string, patterns: string[]): boolean {
	const lower = text.toLowerCase();
	return patterns.some((pattern) => lower.includes(pattern));
}

function summarizeToolCall(record: ToolCallRecord): string {
	const args = record.arguments ?? {};
	const pathLike = typeof args.path === "string" ? args.path : undefined;
	const commandLike = typeof args.command === "string" ? args.command : undefined;
	if (pathLike) return `${record.name}(${pathLike})`;
	if (commandLike) return `${record.name}(${commandLike})`;
	return `${record.name}(${Object.keys(args).join(",")})`;
}

function findRepeatedDiscoveryCalls(dataset: RetrospectiveDataset): AnalysisPoint[] {
	const discoveryCalls = dataset.toolCalls.filter((call) => ["read", "ls", "find", "grep"].includes(call.name));
	const bySignature = new Map<string, ToolCallRecord[]>();

	for (const call of discoveryCalls) {
		const args = call.arguments ?? {};
		const signatureKey =
			(typeof args.path === "string" && args.path) ||
			(typeof args.pattern === "string" && args.pattern) ||
			(typeof args.command === "string" && args.command) ||
			JSON.stringify(args);
		const signature = `${call.name}:${signatureKey}`;
		const existing = bySignature.get(signature);
		if (existing) existing.push(call);
		else bySignature.set(signature, [call]);
	}

	const findings: AnalysisPoint[] = [];
	for (const calls of bySignature.values()) {
		if (calls.length < 3) continue;
		const sample = calls[0];
		findings.push({
			title: `Repeated discovery calls: ${summarizeToolCall(sample)}`,
			description: `This same discovery operation ran ${calls.length} times. Consider caching findings in notes before continuing.`,
			evidence: calls.slice(0, 4).map((call) =>
				makeEvidence(call.assistantEntryId, new Date(call.assistantTimestampMs).toISOString(), call.name),
			),
		});
	}

	return findings;
}

export function buildHeuristicAnalysis(dataset: RetrospectiveDataset): RetrospectiveAnalysis {
	const incorrectDecisions: AnalysisPoint[] = [];
	const unnecessaryEffort: AnalysisPoint[] = [];
	const unexpectedFindings: AnalysisPoint[] = [];
	const improvements: string[] = [];
	const doDifferentlyAgain: string[] = [];

	for (const item of dataset.conversation) {
		if (item.kind === "toolResult") {
			const isError = item.metadata.isError === true;
			if (isError) {
				incorrectDecisions.push({
					title: `Tool error in ${String(item.metadata.toolName ?? "unknown")}`,
					description: item.text.slice(0, 280) || "Tool returned an error without textual output.",
					evidence: [
						makeEvidence(item.entryId, item.timestampIso, typeof item.metadata.toolName === "string" ? item.metadata.toolName : undefined),
					],
				});

				if (textIncludesAny(item.text, ["enoent", "no such file or directory", "not found"])) {
					incorrectDecisions.push({
						title: "Path/context assumption was incorrect",
						description:
							"A command assumed a file/path existed but it did not. Prefer checking with ls/find before direct file reads in uncertain paths.",
						evidence: [
							makeEvidence(
								item.entryId,
								item.timestampIso,
								typeof item.metadata.toolName === "string" ? item.metadata.toolName : undefined,
							),
						],
					});
				}

				if (textIncludesAny(item.text, ["unsupported use of '='", "in fish, please use 'set'", "fish:"])) {
					incorrectDecisions.push({
						title: "Shell syntax mismatch (fish vs POSIX)",
						description:
							"A command used shell syntax incompatible with fish. Prefer fish-native syntax or isolate commands to a known shell.",
						evidence: [
							makeEvidence(
								item.entryId,
								item.timestampIso,
								typeof item.metadata.toolName === "string" ? item.metadata.toolName : undefined,
							),
						],
					});
				}
			}
		}

		if (item.kind === "assistant") {
			const stopReason = String(item.metadata.stopReason ?? "");
			if (stopReason === "error" || stopReason === "aborted") {
				unexpectedFindings.push({
					title: `Assistant stop reason: ${stopReason}`,
					description:
						typeof item.metadata.errorMessage === "string" && item.metadata.errorMessage
							? item.metadata.errorMessage
							: "Assistant turn ended unexpectedly.",
					evidence: [makeEvidence(item.entryId, item.timestampIso)],
				});
			}
		}
	}

	const repeatedDiscovery = findRepeatedDiscoveryCalls(dataset);
	if (repeatedDiscovery.length > 0) {
		unnecessaryEffort.push(...repeatedDiscovery);
	}

	if (dataset.stats.discoveryCalls.percentOfAllToolCalls >= 60) {
		unnecessaryEffort.push({
			title: "High discovery/tooling ratio",
			description: `Discovery tools accounted for ${dataset.stats.discoveryCalls.percentOfAllToolCalls}% of tool calls. Consider summarizing findings sooner and switching to implementation earlier.`,
			evidence: [],
		});
	}

	if (dataset.stats.counts.toolErrors > 0) {
		improvements.push("Before running brittle commands, do one fast sanity check for shell, cwd, or path assumptions.");
		doDifferentlyAgain.push(
			"I would spend the first minute reducing uncertainty instead of improvising inside it. A single explicit sanity check for shell behavior, current directory, or expected files would likely prevent a whole mini-loop of correction later.",
		);
	}
	if (repeatedDiscovery.length > 0) {
		improvements.push("After 1-2 discovery loops, write a short local summary instead of repeating the same read/search pattern.");
		doDifferentlyAgain.push(
			"Once the basic shape of the problem is visible, both of us should switch from more searching to a short shared summary and then execution. That keeps momentum high and stops the work from dissolving into another discovery lap.",
		);
	}
	if (dataset.stats.toolWaitMsTotal > 0 && dataset.stats.counts.toolCalls > 0) {
		improvements.push(
			`Tool waiting time totalled ${(dataset.stats.toolWaitMsTotal / 1000).toFixed(1)}s; independent lookups should be batched earlier.`,
		);
		doDifferentlyAgain.push(
			"I would organize the work in bigger chunks: gather the minimum facts, commit to an approach, and only then widen the search if something genuinely blocks us. The report should feel like a clear narrative, not a replay of every little probe.",
		);
	}
	if (doDifferentlyAgain.length === 0) {
		doDifferentlyAgain.push(
			"Even in a smoother session, I would still aim to externalize the plan earlier, keep a running summary of what we already learned, and make the transition from exploration to implementation more deliberate. That usually leads to a calmer session and a more readable retrospective.",
		);
	}

	const summaryParts = [
		`${incorrectDecisions.length} wrong-turn signal${incorrectDecisions.length === 1 ? "" : "s"}`,
		`${unnecessaryEffort.length} place${unnecessaryEffort.length === 1 ? "" : "s"} where time probably leaked`,
		`${unexpectedFindings.length} unexpected moment${unexpectedFindings.length === 1 ? "" : "s"}`,
	].join(" · ");

	return {
		generatedBy: "heuristic",
		summary: `This pass is based on heuristics rather than memory notes. It looks like there were ${summaryParts}. Read it as a thoughtful first draft: useful for spotting patterns, but not the final word on what mattered most.`,
		incorrectDecisions,
		unnecessaryEffort,
		unexpectedFindings,
		improvements,
		doDifferentlyAgain: [...new Set(doDifferentlyAgain)],
	};
}

function shorten(text: string, maxChars: number): string {
	const trimmed = text.replace(/\r\n/g, "\n").trim();
	if (!trimmed) return "";
	if (trimmed.length <= maxChars) return trimmed;
	return `${trimmed.slice(0, Math.max(0, maxChars - 18)).trimEnd()}\n[…truncated]`;
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const block of content as Array<{ type?: string; text?: string; thinking?: string }>) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "text" && typeof block.text === "string" && block.text.trim()) parts.push(block.text.trim());
	}
	return parts.join("\n\n").trim();
}

function toolCallSummary(toolCalls: ToolCall[]): string {
	if (toolCalls.length === 0) return "";
	return toolCalls
		.slice(0, 6)
		.map((call) => {
			const args = Object.entries(call.arguments ?? {})
				.slice(0, 3)
				.map(([key, value]) => `${key}=${typeof value === "string" ? JSON.stringify(shorten(value, 120)) : JSON.stringify(value)}`)
				.join(", ");
			return args ? `${call.name}(${args})` : `${call.name}()`;
		})
		.join("; ");
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return typeof message === "object" && message !== null && (message as { role?: string }).role === "assistant";
}

function isUserMessage(message: AgentMessage): message is UserMessage {
	return typeof message === "object" && message !== null && (message as { role?: string }).role === "user";
}

function isToolResultMessage(message: AgentMessage): message is ToolResultMessage {
	return typeof message === "object" && message !== null && (message as { role?: string }).role === "toolResult";
}

export function buildAgentNotesInput(dataset: RetrospectiveDataset, maxChars = 16000): string {
	const lines: string[] = [];

	for (const message of dataset.messagesSinceLastCompaction) {
		if (isUserMessage(message)) {
			const text = shorten(contentText(message.content), 1400);
			if (text) lines.push(`<user>\n${text}\n</user>`);
			continue;
		}

		if (isAssistantMessage(message)) {
			const text = shorten(contentText(message.content), 1800);
			const calls = toolCallSummary(message.content.filter((block): block is ToolCall => block.type === "toolCall"));
			const body = [text, calls ? `Tool calls: ${calls}` : ""].filter(Boolean).join("\n\n");
			if (body) lines.push(`<assistant>\n${body}\n</assistant>`);
			continue;
		}

		if (isToolResultMessage(message)) {
			const toolName = message.toolName || "tool";
			const text = shorten(contentText(message.content), message.isError ? 1000 : 260);
			if (message.isError) {
				lines.push(`<tool_result tool="${toolName}" error="true">\n${text || "Tool returned an error without text."}\n</tool_result>`);
				continue;
			}
			if (toolName === "write" || toolName === "edit") {
				lines.push(`<tool_result tool="${toolName}">Updated project files successfully.</tool_result>`);
				continue;
			}
			if (["read", "ls", "find", "grep", "glob"].includes(toolName)) {
				lines.push(`<tool_result tool="${toolName}">Discovery result captured.</tool_result>`);
				continue;
			}
			if (text) lines.push(`<tool_result tool="${toolName}">\n${text}\n</tool_result>`);
			continue;
		}
	}

	let serialized = lines.join("\n\n").trim();
	if (!serialized) return "";
	if (serialized.length <= maxChars) return serialized;
	serialized = serialized.slice(serialized.length - maxChars);
	return `[...truncated to last ${maxChars} chars of condensed conversation...]\n${serialized}`;
}

function parseTaggedListBlock(value: string): string[] {
	return value
		.split(/\n+/)
		.map((line) => line.replace(/^[-*•]\s*/, "").trim())
		.filter(Boolean);
}

function extractRetrospectiveXml(rawText: string): string {
	const match = rawText.match(/<retrospective>[\s\S]*?<\/retrospective>/i);
	return match?.[0]?.trim() ?? rawText.trim();
}

function parseXmlSection(rawText: string, tag: string): string {
	const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const regex = new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`, "i");
	const match = rawText.match(regex);
	return match?.[1]?.trim() ?? "";
}

function normalizeList(items: string[]): string[] {
	return items
		.map((item) => item.replace(/^\d+[.)]\s*/, "").trim())
		.filter((item) => item && !/^none\b/i.test(item));
}

export function isAgentNotesUseful(notes: AgentNotes | null): notes is AgentNotes {
	if (!notes) return false;
	const hasSummary = !!notes.summary.trim() && notes.summary.trim() !== "Generated notes from conversation since last compaction.";
	const hasProjectfulContent =
		notes.doDifferentlyAgain.length > 0 ||
		notes.improvements.length > 0 ||
		notes.incorrectDecisions.length > 0 ||
		notes.unnecessaryEffort.length > 0 ||
		notes.unexpectedFindings.length > 0;
	return hasSummary && hasProjectfulContent;
}

export function parseAgentNotes(rawText: string): AgentNotes | null {
	const trimmed = rawText.trim();
	if (!trimmed) return null;

	const xml = extractRetrospectiveXml(trimmed);
	const summary = parseXmlSection(xml, "summary");
	const incorrectDecisions = normalizeList(parseTaggedListBlock(parseXmlSection(xml, "incorrect_decisions")));
	const unnecessaryEffort = normalizeList(parseTaggedListBlock(parseXmlSection(xml, "unnecessary_effort")));
	const unexpectedFindings = normalizeList(parseTaggedListBlock(parseXmlSection(xml, "unexpected_findings")));
	const improvements = normalizeList(parseTaggedListBlock(parseXmlSection(xml, "improvements")));
	const doDifferentlyAgain = normalizeList(parseTaggedListBlock(parseXmlSection(xml, "do_differently_again")));

	if (!summary && incorrectDecisions.length === 0 && unnecessaryEffort.length === 0 && unexpectedFindings.length === 0 && improvements.length === 0 && doDifferentlyAgain.length === 0) {
		return null;
	}

	return {
		summary,
		incorrectDecisions,
		unnecessaryEffort,
		unexpectedFindings,
		improvements,
		doDifferentlyAgain,
	};
}

export function mergeAnalysisWithAgentNotes(base: RetrospectiveAnalysis, notes: AgentNotes): RetrospectiveAnalysis {
	const mergedImprovements = [...base.improvements, ...notes.improvements];
	const dedupedImprovements = [...new Set(mergedImprovements.map((value) => value.trim()).filter(Boolean))];
	const mergedRedo = notes.doDifferentlyAgain.length > 0 ? notes.doDifferentlyAgain : base.doDifferentlyAgain;
	const dedupedRedo = [...new Set(mergedRedo.map((value) => value.trim()).filter(Boolean))];

	return {
		...base,
		generatedBy: "heuristic+notes",
		summary: base.summary,
		agentNotes: notes,
		improvements: dedupedImprovements,
		doDifferentlyAgain: dedupedRedo,
	};
}
