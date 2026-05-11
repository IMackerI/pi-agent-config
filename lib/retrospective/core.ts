import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ImageContent, TextContent, ToolCall, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import type { SessionEntry, SessionHeader } from "@mariozechner/pi-coding-agent";

export const DISCOVERY_TOOL_NAMES = ["read", "ls", "find", "grep"] as const;

const DISCOVERY_TOOLS = new Set<string>(DISCOVERY_TOOL_NAMES);

type DiscoveryToolName = (typeof DISCOVERY_TOOL_NAMES)[number];

type ContentBlock =
	| TextContent
	| ImageContent
	| {
			type: "thinking";
			thinking: string;
	  }
	| ToolCall;

export type ConversationItemKind = "user" | "assistant" | "toolResult" | "bashExecution" | "custom" | "summary";

export interface ToolCallRecord {
	toolCallId: string;
	name: string;
	arguments: Record<string, unknown>;
	assistantEntryId: string;
	assistantTimestampMs: number;
	resultEntryId?: string;
	resultTimestampMs?: number;
	latencyMs?: number;
	resultError?: boolean;
}

export interface ConversationItem {
	entryId: string;
	kind: ConversationItemKind;
	role: string;
	timestampMs: number;
	timestampIso: string;
	text: string;
	metadata: Record<string, unknown>;
}

export interface RetrospectiveStats {
	sessionDurationMs: number;
	toolWaitMsTotal: number;
	toolWaitMsWallClock: number;
	toolLatencyAvgMs: number;
	toolLatencyMaxMs: number;
	counts: {
		entries: number;
		userPrompts: number;
		assistantMessages: number;
		toolResultMessages: number;
		toolCalls: number;
		bashCalls: number;
		userBashCalls: number;
		assistantBashToolCalls: number;
		errors: number;
		toolErrors: number;
		assistantErrors: number;
		assistantAborts: number;
		bashNonZeroExits: number;
	};
	toolCallsByName: Record<string, number>;
	discoveryCalls: {
		total: number;
		byTool: Record<DiscoveryToolName, number>;
		percentOfAllToolCalls: number;
	};
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
		cost: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
			total: number;
		};
	};
}

export interface RetrospectiveDataset {
	header: SessionHeader | null;
	leafId: string | null;
	entries: SessionEntry[];
	entriesSinceLastCompaction: SessionEntry[];
	messagesSinceLastCompaction: AgentMessage[];
	conversation: ConversationItem[];
	toolCalls: ToolCallRecord[];
	stats: RetrospectiveStats;
	startTimestampMs: number;
	endTimestampMs: number;
	startTimestampIso: string;
	endTimestampIso: string;
	lastCompactionEntryId?: string;
	lastCompactionSummary?: string;
}

function toIso(ts: number): string {
	return new Date(ts).toISOString();
}

function safeTimestamp(value: number | undefined, fallbackIso: string): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	const parsed = Date.parse(fallbackIso);
	if (Number.isFinite(parsed)) return parsed;
	return Date.now();
}

function normalizeText(value: string): string {
	return value.replace(/\r\n/g, "\n").trim();
}

function stringifyUnknown(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return normalizeText(content);
	if (!Array.isArray(content)) return "";

	const lines: string[] = [];
	for (const block of content as ContentBlock[]) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "text") {
			if (block.text.trim()) lines.push(block.text);
			continue;
		}
		if (block.type === "image") {
			lines.push(`[image ${block.mimeType}]`);
			continue;
		}
		if (block.type === "thinking") {
			if (block.thinking.trim()) lines.push(block.thinking);
			continue;
		}
		if (block.type === "toolCall") {
			const args = Object.keys(block.arguments ?? {}).length > 0 ? stringifyUnknown(block.arguments) : "{}";
			lines.push(`Tool call: ${block.name} ${args}`);
		}
	}
	return normalizeText(lines.join("\n\n"));
}

function textBlocksFromAssistant(content: unknown): { text: string; thinking: string; toolCalls: ToolCall[] } {
	if (!Array.isArray(content)) {
		return { text: "", thinking: "", toolCalls: [] };
	}

	const textParts: string[] = [];
	const thinkingParts: string[] = [];
	const toolCalls: ToolCall[] = [];

	for (const block of content as ContentBlock[]) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "text" && block.text.trim()) textParts.push(block.text);
		if (block.type === "thinking" && block.thinking.trim()) thinkingParts.push(block.thinking);
		if (block.type === "toolCall") toolCalls.push(block);
	}

	return {
		text: normalizeText(textParts.join("\n\n")),
		thinking: normalizeText(thinkingParts.join("\n\n")),
		toolCalls,
	};
}

function emptyStats(): RetrospectiveStats {
	return {
		sessionDurationMs: 0,
		toolWaitMsTotal: 0,
		toolWaitMsWallClock: 0,
		toolLatencyAvgMs: 0,
		toolLatencyMaxMs: 0,
		counts: {
			entries: 0,
			userPrompts: 0,
			assistantMessages: 0,
			toolResultMessages: 0,
			toolCalls: 0,
			bashCalls: 0,
			userBashCalls: 0,
			assistantBashToolCalls: 0,
			errors: 0,
			toolErrors: 0,
			assistantErrors: 0,
			assistantAborts: 0,
			bashNonZeroExits: 0,
		},
		toolCallsByName: {},
		discoveryCalls: {
			total: 0,
			byTool: {
				read: 0,
				ls: 0,
				find: 0,
				grep: 0,
			},
			percentOfAllToolCalls: 0,
		},
		tokens: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
	};
}

function ensurePositiveNumber(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0;
	if (value < 0) return 0;
	return value;
}

function isMessageEntry(entry: SessionEntry): entry is SessionEntry & { type: "message"; message: AgentMessage } {
	return entry.type === "message";
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return typeof message === "object" && message !== null && (message as AssistantMessage).role === "assistant";
}

function isUserMessage(message: AgentMessage): message is UserMessage {
	return typeof message === "object" && message !== null && (message as UserMessage).role === "user";
}

function isToolResultMessage(message: AgentMessage): message is ToolResultMessage {
	return typeof message === "object" && message !== null && (message as ToolResultMessage).role === "toolResult";
}

function isBashExecutionMessage(
	message: AgentMessage,
): message is AgentMessage & {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode?: number;
	cancelled?: boolean;
	excludeFromContext?: boolean;
} {
	return typeof message === "object" && message !== null && (message as { role?: string }).role === "bashExecution";
}

function isCustomMessage(
	message: AgentMessage,
): message is AgentMessage & {
	role: "custom";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	display: boolean;
} {
	return typeof message === "object" && message !== null && (message as { role?: string }).role === "custom";
}

export function buildRetrospectiveDataset(
	entries: SessionEntry[],
	header: SessionHeader | null,
	leafId: string | null,
): RetrospectiveDataset {
	const stats = emptyStats();
	stats.counts.entries = entries.length;

	const toolCalls: ToolCallRecord[] = [];
	const toolCallById = new Map<string, ToolCallRecord>();
	const assistantItemsByEntryId = new Map<string, ConversationItem>();
	const assistantWaitMaxByEntryId = new Map<string, number>();
	const toolLatencies: number[] = [];
	const conversation: ConversationItem[] = [];

	let startTimestampMs = Number.POSITIVE_INFINITY;
	let endTimestampMs = 0;
	let lastCompactionEntryId: string | undefined;
	let lastCompactionSummary: string | undefined;
	let lastCompactionIndex = -1;

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.type === "compaction") {
			lastCompactionEntryId = entry.id;
			lastCompactionSummary = entry.summary;
			lastCompactionIndex = i;
		}

		const entryTimestampMs = safeTimestamp(undefined, entry.timestamp);
		if (entryTimestampMs < startTimestampMs) startTimestampMs = entryTimestampMs;
		if (entryTimestampMs > endTimestampMs) endTimestampMs = entryTimestampMs;

		if (!isMessageEntry(entry)) continue;

		const msg = entry.message;
		const messageTimestampMs = safeTimestamp((msg as { timestamp?: number }).timestamp, entry.timestamp);
		if (messageTimestampMs < startTimestampMs) startTimestampMs = messageTimestampMs;
		if (messageTimestampMs > endTimestampMs) endTimestampMs = messageTimestampMs;

		if (isUserMessage(msg)) {
			stats.counts.userPrompts += 1;
			const text = textFromContent(msg.content);
			conversation.push({
				entryId: entry.id,
				kind: "user",
				role: "user",
				timestampMs: messageTimestampMs,
				timestampIso: toIso(messageTimestampMs),
				text,
				metadata: {
					charCount: text.length,
				},
			});
			continue;
		}

		if (isAssistantMessage(msg)) {
			stats.counts.assistantMessages += 1;

			const { text, thinking, toolCalls: assistantToolCalls } = textBlocksFromAssistant(msg.content);

			if (msg.stopReason === "error") stats.counts.assistantErrors += 1;
			if (msg.stopReason === "aborted") stats.counts.assistantAborts += 1;

			stats.tokens.input += ensurePositiveNumber(msg.usage?.input);
			stats.tokens.output += ensurePositiveNumber(msg.usage?.output);
			stats.tokens.cacheRead += ensurePositiveNumber(msg.usage?.cacheRead);
			stats.tokens.cacheWrite += ensurePositiveNumber(msg.usage?.cacheWrite);
			stats.tokens.total += ensurePositiveNumber(msg.usage?.totalTokens);
			stats.tokens.cost.input += ensurePositiveNumber(msg.usage?.cost?.input);
			stats.tokens.cost.output += ensurePositiveNumber(msg.usage?.cost?.output);
			stats.tokens.cost.cacheRead += ensurePositiveNumber(msg.usage?.cost?.cacheRead);
			stats.tokens.cost.cacheWrite += ensurePositiveNumber(msg.usage?.cost?.cacheWrite);
			stats.tokens.cost.total += ensurePositiveNumber(msg.usage?.cost?.total);

			for (const toolCall of assistantToolCalls) {
				stats.counts.toolCalls += 1;
				stats.toolCallsByName[toolCall.name] = (stats.toolCallsByName[toolCall.name] ?? 0) + 1;

				if (toolCall.name === "bash") stats.counts.assistantBashToolCalls += 1;
				if (DISCOVERY_TOOLS.has(toolCall.name)) {
					stats.discoveryCalls.total += 1;
					const key = toolCall.name as DiscoveryToolName;
					stats.discoveryCalls.byTool[key] += 1;
				}

				const record: ToolCallRecord = {
					toolCallId: toolCall.id,
					name: toolCall.name,
					arguments: (toolCall.arguments as Record<string, unknown>) ?? {},
					assistantEntryId: entry.id,
					assistantTimestampMs: messageTimestampMs,
				};
				toolCalls.push(record);
				toolCallById.set(toolCall.id, record);
			}

			const assistantItem: ConversationItem = {
				entryId: entry.id,
				kind: "assistant",
				role: "assistant",
				timestampMs: messageTimestampMs,
				timestampIso: toIso(messageTimestampMs),
				text,
				metadata: {
					thinking,
					model: msg.model,
					provider: msg.provider,
					stopReason: msg.stopReason,
					errorMessage: msg.errorMessage,
					toolCallCount: assistantToolCalls.length,
					outputTokens: ensurePositiveNumber(msg.usage?.output),
					totalTokens: ensurePositiveNumber(msg.usage?.totalTokens),
					toolWaitMs: 0,
				},
			};
			conversation.push(assistantItem);
			assistantItemsByEntryId.set(entry.id, assistantItem);
			continue;
		}

		if (isToolResultMessage(msg)) {
			stats.counts.toolResultMessages += 1;
			if (msg.isError) stats.counts.toolErrors += 1;

			const text = textFromContent(msg.content);
			let latencyMs: number | undefined;
			const linkedToolCall = toolCallById.get(msg.toolCallId);
			if (linkedToolCall) {
				linkedToolCall.resultEntryId = entry.id;
				linkedToolCall.resultTimestampMs = messageTimestampMs;
				linkedToolCall.resultError = msg.isError;
				latencyMs = Math.max(0, messageTimestampMs - linkedToolCall.assistantTimestampMs);
				linkedToolCall.latencyMs = latencyMs;
				toolLatencies.push(latencyMs);
				stats.toolWaitMsTotal += latencyMs;
				const currentMax = assistantWaitMaxByEntryId.get(linkedToolCall.assistantEntryId) ?? 0;
				if (latencyMs > currentMax) assistantWaitMaxByEntryId.set(linkedToolCall.assistantEntryId, latencyMs);
			}

			conversation.push({
				entryId: entry.id,
				kind: "toolResult",
				role: "toolResult",
				timestampMs: messageTimestampMs,
				timestampIso: toIso(messageTimestampMs),
				text,
				metadata: {
					toolCallId: msg.toolCallId,
					toolName: msg.toolName,
					isError: msg.isError,
					latencyMs,
					contentLength: text.length,
				},
			});
			continue;
		}

		if (isBashExecutionMessage(msg)) {
			stats.counts.userBashCalls += 1;
			if (typeof msg.exitCode === "number" && msg.exitCode !== 0) stats.counts.bashNonZeroExits += 1;
			conversation.push({
				entryId: entry.id,
				kind: "bashExecution",
				role: "bashExecution",
				timestampMs: messageTimestampMs,
				timestampIso: toIso(messageTimestampMs),
				text: normalizeText(msg.output ?? ""),
				metadata: {
					command: msg.command,
					exitCode: msg.exitCode,
					cancelled: msg.cancelled,
					excludeFromContext: msg.excludeFromContext === true,
				},
			});
			continue;
		}

		if (isCustomMessage(msg)) {
			conversation.push({
				entryId: entry.id,
				kind: "custom",
				role: "custom",
				timestampMs: messageTimestampMs,
				timestampIso: toIso(messageTimestampMs),
				text: textFromContent(msg.content),
				metadata: {
					customType: msg.customType,
					display: msg.display,
				},
			});
			continue;
		}

		conversation.push({
			entryId: entry.id,
			kind: "summary",
			role: (msg as { role?: string }).role ?? "unknown",
			timestampMs: messageTimestampMs,
			timestampIso: toIso(messageTimestampMs),
			text: textFromContent((msg as { content?: unknown }).content),
			metadata: {},
		});
	}

	for (const [assistantEntryId, waitMs] of assistantWaitMaxByEntryId) {
		stats.toolWaitMsWallClock += waitMs;
		const assistantItem = assistantItemsByEntryId.get(assistantEntryId);
		if (assistantItem) assistantItem.metadata.toolWaitMs = waitMs;
	}

	stats.counts.bashCalls = stats.counts.userBashCalls + stats.counts.assistantBashToolCalls;
	stats.counts.errors =
		stats.counts.toolErrors + stats.counts.assistantErrors + stats.counts.assistantAborts + stats.counts.bashNonZeroExits;
	stats.sessionDurationMs = Math.max(0, endTimestampMs - (Number.isFinite(startTimestampMs) ? startTimestampMs : endTimestampMs));

	if (toolLatencies.length > 0) {
		const latencySum = toolLatencies.reduce((acc, value) => acc + value, 0);
		stats.toolLatencyAvgMs = Math.round(latencySum / toolLatencies.length);
		stats.toolLatencyMaxMs = Math.max(...toolLatencies);
	}

	if (stats.counts.toolCalls > 0) {
		stats.discoveryCalls.percentOfAllToolCalls = Number(
			((stats.discoveryCalls.total / stats.counts.toolCalls) * 100).toFixed(2),
		);
	}

	let entriesSinceLastCompaction =
		lastCompactionIndex >= 0 ? entries.slice(lastCompactionIndex + 1) : entries.slice();
	if (entriesSinceLastCompaction.length === 0) entriesSinceLastCompaction = entries.slice();

	const messagesSinceLastCompaction = entriesSinceLastCompaction
		.filter((entry): entry is SessionEntry & { type: "message"; message: AgentMessage } => entry.type === "message")
		.map((entry) => entry.message);

	if (!Number.isFinite(startTimestampMs)) {
		startTimestampMs = endTimestampMs || Date.now();
	}

	const startTimestampIso = toIso(startTimestampMs);
	const endTimestampIso = toIso(endTimestampMs || startTimestampMs);

	return {
		header,
		leafId,
		entries,
		entriesSinceLastCompaction,
		messagesSinceLastCompaction,
		conversation,
		toolCalls,
		stats,
		startTimestampMs,
		endTimestampMs,
		startTimestampIso,
		endTimestampIso,
		lastCompactionEntryId,
		lastCompactionSummary,
	};
}
