import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
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
}

export interface RetrospectiveAnalysis {
	generatedBy: "heuristic" | "heuristic+notes";
	summary: string;
	incorrectDecisions: AnalysisPoint[];
	unnecessaryEffort: AnalysisPoint[];
	unexpectedFindings: AnalysisPoint[];
	improvements: string[];
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
		improvements.push("Before running potentially brittle commands, verify path/shell assumptions with one quick check command.");
	}
	if (repeatedDiscovery.length > 0) {
		improvements.push("After 1-2 discovery loops, write a short local summary to avoid repeating the same read/search calls.");
	}
	if (dataset.stats.toolWaitMsTotal > 0 && dataset.stats.counts.toolCalls > 0) {
		improvements.push(
			`Tool waiting time totalled ${(dataset.stats.toolWaitMsTotal / 1000).toFixed(1)}s; batch independent lookups where possible.`,
		);
	}

	const summaryParts = [
		`${incorrectDecisions.length} likely incorrect decisions`,
		`${unnecessaryEffort.length} unnecessary-effort pattern(s)`,
		`${unexpectedFindings.length} unexpected event(s)`,
	].join(" · ");

	return {
		generatedBy: "heuristic",
		summary: `Heuristic analysis: ${summaryParts}.`,
		incorrectDecisions,
		unnecessaryEffort,
		unexpectedFindings,
		improvements,
	};
}

export function buildAgentNotesInput(dataset: RetrospectiveDataset, maxChars = 24000): string {
	const llmMessages = convertToLlm(dataset.messagesSinceLastCompaction);
	const serialized = serializeConversation(llmMessages);
	if (serialized.length <= maxChars) return serialized;
	const tail = serialized.slice(serialized.length - maxChars);
	return `[...truncated to last ${maxChars} chars...]\n${tail}`;
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
}

export function parseAgentNotes(rawText: string): AgentNotes | null {
	const trimmed = rawText.trim();
	if (!trimmed) return null;

	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) return null;

	try {
		const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
		return {
			summary:
				typeof parsed.summary === "string"
					? parsed.summary.trim()
					: "Generated notes from conversation since last compaction.",
			incorrectDecisions: toStringArray(parsed.incorrectDecisions),
			unnecessaryEffort: toStringArray(parsed.unnecessaryEffort),
			unexpectedFindings: toStringArray(parsed.unexpectedFindings),
			improvements: toStringArray(parsed.improvements),
		};
	} catch {
		return null;
	}
}

export function mergeAnalysisWithAgentNotes(base: RetrospectiveAnalysis, notes: AgentNotes): RetrospectiveAnalysis {
	const mergedImprovements = [...base.improvements, ...notes.improvements];
	const dedupedImprovements = [...new Set(mergedImprovements.map((value) => value.trim()).filter(Boolean))];

	return {
		...base,
		generatedBy: "heuristic+notes",
		summary: `${base.summary}\n\nAgent notes: ${notes.summary}`,
		agentNotes: notes,
		improvements: dedupedImprovements,
	};
}
