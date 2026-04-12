import type { RetrospectiveAnalysis } from "./analysis";
import type { ConversationItem, RetrospectiveDataset } from "./core";

export interface RetrospectiveReport {
	title: string;
	generatedAtIso: string;
	dataset: RetrospectiveDataset;
	analysis: RetrospectiveAnalysis;
}

const LARGE_BLOCK_PREVIEW_CHARS = 1800;

interface ConversationTurn {
	index: number;
	user?: ConversationItem;
	between: ConversationItem[];
}

function escapeHtml(input: string): string {
	return input
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function formatMs(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
	if (ms < 1000) return `${Math.round(ms)} ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)} s`;
	const minutes = Math.floor(seconds / 60);
	const rem = Math.round(seconds % 60);
	return `${minutes}m ${rem}s`;
}

function formatCurrency(value: number): string {
	if (!Number.isFinite(value)) return "$0.0000";
	return `$${value.toFixed(4)}`;
}

function timestampLabel(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function prettyJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function renderLargeTextBlock(text: string): string {
	if (text.length <= LARGE_BLOCK_PREVIEW_CHARS) {
		return `<pre class="content-block">${escapeHtml(text || "(empty)")}</pre>`;
	}

	const preview = text.slice(0, LARGE_BLOCK_PREVIEW_CHARS);
	return [
		`<pre class="content-block">${escapeHtml(preview)}\n\n… (${text.length - LARGE_BLOCK_PREVIEW_CHARS} more chars)</pre>`,
		"<details class=\"nested-expand\">",
		"<summary>Show full output</summary>",
		`<pre class="content-block">${escapeHtml(text)}</pre>`,
		"</details>",
	].join("\n");
}

function searchIndexText(item: ConversationItem): string {
	const textPart = item.text.slice(0, 1800);
	const metadataPart = prettyJson(item.metadata).slice(0, 1200);
	return `${item.kind} ${item.role} ${textPart} ${metadataPart}`.toLowerCase();
}

function metadataBadges(item: ConversationItem): string {
	const badges: string[] = [];
	badges.push(`<span class="badge">${escapeHtml(item.role)}</span>`);

	if (item.kind === "assistant") {
		const outputTokens = Number(item.metadata.outputTokens ?? 0);
		const toolCallCount = Number(item.metadata.toolCallCount ?? 0);
		const toolWaitMs = Number(item.metadata.toolWaitMs ?? 0);
		if (outputTokens > 0) badges.push(`<span class="badge">output ${outputTokens} tok</span>`);
		if (toolCallCount > 0) badges.push(`<span class="badge">${toolCallCount} tool call(s)</span>`);
		if (toolWaitMs > 0) badges.push(`<span class="badge">tool wait ${formatMs(toolWaitMs)}</span>`);
		const stopReason = String(item.metadata.stopReason ?? "");
		if (stopReason && stopReason !== "stop" && stopReason !== "toolUse") {
			badges.push(`<span class="badge badge-error">${escapeHtml(stopReason)}</span>`);
		}
	}

	if (item.kind === "toolResult") {
		const toolName = String(item.metadata.toolName ?? "unknown");
		badges.push(`<span class="badge">${escapeHtml(toolName)}</span>`);
		if (item.metadata.isError === true) badges.push('<span class="badge badge-error">error</span>');
		if (typeof item.metadata.latencyMs === "number") {
			badges.push(`<span class="badge">latency ${formatMs(item.metadata.latencyMs)}</span>`);
		}
	}

	if (item.kind === "bashExecution") {
		const exitCode = item.metadata.exitCode;
		if (typeof exitCode === "number") {
			const cls = exitCode === 0 ? "badge" : "badge badge-error";
			badges.push(`<span class="${cls}">exit ${exitCode}</span>`);
		}
	}

	return badges.join(" ");
}

function renderUserItem(item: ConversationItem): string {
	const searchText = escapeHtml(searchIndexText(item));
	const heading = `USER · ${timestampLabel(item.timestampIso)}`;
	const metadata = metadataBadges(item);
	return [
		`<article class="timeline-item user timeline-entry" data-kind="user" data-search="${searchText}">`,
		`<header><h4>${escapeHtml(heading)}</h4><div class="meta">${metadata}</div></header>`,
		renderLargeTextBlock(item.text || "(empty)"),
		"</article>",
	].join("\n");
}

function renderNonUserItem(item: ConversationItem): string {
	const searchText = escapeHtml(searchIndexText(item));
	const heading = `${item.kind.toUpperCase()} · ${timestampLabel(item.timestampIso)}`;
	const metadata = metadataBadges(item);
	const metadataJson = prettyJson(item.metadata);

	if (item.kind === "assistant") {
		const thinking = typeof item.metadata.thinking === "string" ? item.metadata.thinking : "";
		return [
			`<details class="timeline-item assistant timeline-entry" data-kind="${item.kind}" data-search="${searchText}">`,
			`<summary><span>${escapeHtml(heading)}</span><span class="meta">${metadata}</span></summary>`,
			renderLargeTextBlock(item.text || "(no assistant text output)"),
			thinking
				? [
					"<details class=\"nested-expand\">",
					"<summary>Thinking (collapsed)</summary>",
					renderLargeTextBlock(thinking),
					"</details>",
				].join("\n")
				: "",
			`<details class="nested-expand"><summary>Metadata</summary><pre class="content-block">${escapeHtml(metadataJson)}</pre></details>`,
			"</details>",
		].join("\n");
	}

	return [
		`<details class="timeline-item ${item.kind} timeline-entry" data-kind="${item.kind}" data-search="${searchText}">`,
		`<summary><span>${escapeHtml(heading)}</span><span class="meta">${metadata}</span></summary>`,
		renderLargeTextBlock(item.text || "(empty)"),
		`<details class="nested-expand"><summary>Metadata</summary><pre class="content-block">${escapeHtml(metadataJson)}</pre></details>`,
		"</details>",
	].join("\n");
}

function buildConversationTurns(conversation: ConversationItem[]): ConversationTurn[] {
	const turns: ConversationTurn[] = [];
	let current: ConversationTurn | undefined;

	for (const item of conversation) {
		if (item.kind === "user") {
			current = { index: turns.length, user: item, between: [] };
			turns.push(current);
			continue;
		}

		if (!current) {
			current = { index: turns.length, between: [] };
			turns.push(current);
		}
		current.between.push(item);
	}

	return turns;
}

function summarizeTurnGroup(items: ConversationItem[]): {
	title: string;
	badges: string;
	searchText: string;
} {
	let assistantCount = 0;
	let toolResultCount = 0;
	let bashCount = 0;
	let customCount = 0;
	let errorCount = 0;
	let toolWaitMs = 0;
	const searchParts: string[] = [];

	for (const item of items) {
		searchParts.push(searchIndexText(item));
		if (item.kind === "assistant") {
			assistantCount += 1;
			toolWaitMs += Number(item.metadata.toolWaitMs ?? 0);
			const stopReason = String(item.metadata.stopReason ?? "");
			if (stopReason && stopReason !== "stop" && stopReason !== "toolUse") errorCount += 1;
		} else if (item.kind === "toolResult") {
			toolResultCount += 1;
			if (item.metadata.isError === true) errorCount += 1;
		} else if (item.kind === "bashExecution") {
			bashCount += 1;
			const exitCode = item.metadata.exitCode;
			if (typeof exitCode === "number" && exitCode !== 0) errorCount += 1;
		} else if (item.kind === "custom") {
			customCount += 1;
		}
	}

	const title = `Assistant activity until next user message (${items.length} item${items.length === 1 ? "" : "s"})`;
	const badges: string[] = [];
	if (assistantCount > 0) badges.push(`<span class="badge">assistant ${assistantCount}</span>`);
	if (toolResultCount > 0) badges.push(`<span class="badge">tool results ${toolResultCount}</span>`);
	if (bashCount > 0) badges.push(`<span class="badge">bash ${bashCount}</span>`);
	if (customCount > 0) badges.push(`<span class="badge">custom ${customCount}</span>`);
	if (toolWaitMs > 0) badges.push(`<span class="badge">tool wait ${formatMs(toolWaitMs)}</span>`);
	if (errorCount > 0) badges.push(`<span class="badge badge-error">errors ${errorCount}</span>`);

	return {
		title,
		badges: badges.join(" "),
		searchText: searchParts.join(" ").slice(0, 5000),
	};
}

function renderTurn(turn: ConversationTurn): string {
	const blocks: string[] = [];
	if (turn.user) blocks.push(renderUserItem(turn.user));

	if (turn.between.length > 0) {
		const group = summarizeTurnGroup(turn.between);
		const children = turn.between.map((item) => renderNonUserItem(item)).join("\n");
		blocks.push([
			`<details class="turn-group" data-search="${escapeHtml(group.searchText)}">`,
			`<summary><span>${escapeHtml(group.title)}</span><span class="meta">${group.badges}</span></summary>`,
			`<div class="turn-group-items">${children}</div>`,
			"</details>",
		].join("\n"));
	}

	if (!turn.user && turn.between.length === 0) return "";
	return `<section class="timeline-turn" data-turn="${turn.index}">${blocks.join("\n")}</section>`;
}

function renderAnalysisPoints(title: string, points: { title: string; description: string; evidence: any[] }[]): string {
	if (points.length === 0) {
		return `<section class="panel"><h3>${escapeHtml(title)}</h3><p class="muted">No items detected.</p></section>`;
	}

	const items = points
		.map((point) => {
			const evidence = point.evidence
				.map((item) => `• ${escapeHtml(item.entryId)}${item.note ? ` — ${escapeHtml(item.note)}` : ""}`)
				.join("<br>");
			return [
				"<article class=\"analysis-item\">",
				`<h4>${escapeHtml(point.title)}</h4>`,
				`<p>${escapeHtml(point.description)}</p>`,
				evidence ? `<div class="muted evidence">${evidence}</div>` : "",
				"</article>",
			].join("\n");
		})
		.join("\n");

	return `<section class="panel"><h3>${escapeHtml(title)}</h3>${items}</section>`;
}

function renderStatsSection(dataset: RetrospectiveDataset): string {
	const stats = dataset.stats;

	return [
		"<section class=\"panel\" style=\"margin-bottom: 14px;\">",
		"<h2>Session stats</h2>",
		"<div class=\"stats-groups\" style=\"margin-top: 10px;\">",
		"<section class=\"stats-group\">",
		"<h3>Session overview</h3>",
		"<div class=\"grid\">",
		`<div class=\"card\"><div class=\"muted\">Duration</div><div class=\"value\">${escapeHtml(formatMs(stats.sessionDurationMs))}</div></div>`,
		`<div class=\"card\"><div class=\"muted\">Entries</div><div class=\"value\">${stats.counts.entries}</div></div>`,
		`<div class=\"card\"><div class=\"muted\">User prompts</div><div class=\"value\">${stats.counts.userPrompts}</div></div>`,
		`<div class=\"card\"><div class=\"muted\">Assistant messages</div><div class=\"value\">${stats.counts.assistantMessages}</div></div>`,
		"</div>",
		"</section>",
		"<section class=\"stats-group\">",
		"<h3>Tooling & discovery</h3>",
		"<div class=\"grid\">",
		`<div class=\"card\"><div class=\"muted\">Tool calls</div><div class=\"value\">${stats.counts.toolCalls}</div></div>`,
		`<div class=\"card\"><div class=\"muted\">Discovery calls</div><div class=\"value\">${stats.discoveryCalls.total}</div><div class=\"muted\">${stats.discoveryCalls.percentOfAllToolCalls}% of all tool calls</div></div>`,
		`<div class=\"card\"><div class=\"muted\">Discovery breakdown</div><div class=\"value\">read ${stats.discoveryCalls.byTool.read} · ls ${stats.discoveryCalls.byTool.ls} · find ${stats.discoveryCalls.byTool.find} · grep ${stats.discoveryCalls.byTool.grep}</div></div>`,
		`<div class=\"card\"><div class=\"muted\">Bash calls</div><div class=\"value\">${stats.counts.bashCalls}</div><div class=\"muted\">user ${stats.counts.userBashCalls} · assistant tool ${stats.counts.assistantBashToolCalls}</div></div>`,
		"</div>",
		"</section>",
		"<section class=\"stats-group\">",
		"<h3>Latency & reliability</h3>",
		"<div class=\"grid\">",
		`<div class=\"card\"><div class=\"muted\">Tool wait (sum)</div><div class=\"value\">${escapeHtml(formatMs(stats.toolWaitMsTotal))}</div></div>`,
		`<div class=\"card\"><div class=\"muted\">Tool wait (wall)</div><div class=\"value\">${escapeHtml(formatMs(stats.toolWaitMsWallClock))}</div></div>`,
		`<div class=\"card\"><div class=\"muted\">Tool latency</div><div class=\"value\">avg ${escapeHtml(formatMs(stats.toolLatencyAvgMs))} · max ${escapeHtml(formatMs(stats.toolLatencyMaxMs))}</div></div>`,
		`<div class=\"card\"><div class=\"muted\">Errors</div><div class=\"value\">${stats.counts.errors}</div><div class=\"muted\">tool ${stats.counts.toolErrors} · assistant ${stats.counts.assistantErrors + stats.counts.assistantAborts} · bash non-zero ${stats.counts.bashNonZeroExits}</div></div>`,
		"</div>",
		"</section>",
		"<section class=\"stats-group\">",
		"<h3>Token usage & cost</h3>",
		"<div class=\"grid\">",
		`<div class=\"card\"><div class=\"muted\">Input tokens</div><div class=\"value\">${stats.tokens.input}</div></div>`,
		`<div class=\"card\"><div class=\"muted\">Output tokens</div><div class=\"value\">${stats.tokens.output}</div></div>`,
		`<div class=\"card\"><div class=\"muted\">Total tokens</div><div class=\"value\">${stats.tokens.total}</div><div class=\"muted\">cache read ${stats.tokens.cacheRead} · cache write ${stats.tokens.cacheWrite}</div></div>`,
		`<div class=\"card\"><div class=\"muted\">Total cost</div><div class=\"value\">${escapeHtml(formatCurrency(stats.tokens.cost.total))}</div></div>`,
		"</div>",
		"</section>",
		"</div>",
		"</section>",
	].join("\n");
}

export function renderRetrospectiveHtml(report: RetrospectiveReport): string {
	const { dataset, analysis } = report;
	const turns = buildConversationTurns(dataset.conversation);
	const conversationHtml = turns.map((turn) => renderTurn(turn)).join("\n");
	const improvements =
		analysis.improvements.length > 0
			? `<ul>${analysis.improvements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
			: '<p class="muted">No improvement recommendations generated.</p>';

	const notesSection =
		analysis.agentNotes &&
		[
			"<section class=\"panel\">",
			"<h3>Agent notes (since last compaction)</h3>",
			`<p>${escapeHtml(analysis.agentNotes.summary)}</p>`,
			analysis.agentNotes.incorrectDecisions.length
				? `<h4>Remembered wrong decisions</h4><ul>${analysis.agentNotes.incorrectDecisions
						.map((item) => `<li>${escapeHtml(item)}</li>`)
						.join("")}</ul>`
				: "",
			analysis.agentNotes.unnecessaryEffort.length
				? `<h4>Unnecessary effort</h4><ul>${analysis.agentNotes.unnecessaryEffort
						.map((item) => `<li>${escapeHtml(item)}</li>`)
						.join("")}</ul>`
				: "",
			analysis.agentNotes.unexpectedFindings.length
				? `<h4>Unexpected findings</h4><ul>${analysis.agentNotes.unexpectedFindings
						.map((item) => `<li>${escapeHtml(item)}</li>`)
						.join("")}</ul>`
				: "",
			"</section>",
		].join("\n");

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${escapeHtml(report.title)}</title>
	<style>
		:root {
			--bg: #060b17;
			--bg-soft: #0e1730;
			--panel: rgba(19, 29, 54, 0.78);
			--panel-2: rgba(24, 37, 67, 0.86);
			--text: #e8ecf5;
			--muted: #aab7d5;
			--accent: #79b8ff;
			--accent-2: #8de7ff;
			--danger: #ff7b7b;
			--success: #79f2c0;
			--border: rgba(129, 161, 214, 0.32);
			--border-strong: rgba(144, 178, 237, 0.54);
		}
		* { box-sizing: border-box; }
		body {
			margin: 0;
			font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
			background:
				radial-gradient(1200px 700px at 10% -5%, #1a3169 0%, transparent 55%),
				radial-gradient(1000px 600px at 95% -10%, #29356a 0%, transparent 52%),
				linear-gradient(180deg, var(--bg-soft) 0%, var(--bg) 45%);
			color: var(--text);
			line-height: 1.55;
		}
		main {
			max-width: 1280px;
			margin: 0 auto;
			padding: 28px 22px 48px;
		}
		h1, h2, h3, h4 { margin: 0 0 8px; }
		h1 {
			font-size: clamp(1.45rem, 2.7vw, 2.2rem);
			line-height: 1.2;
			background: linear-gradient(110deg, #dbe9ff 10%, var(--accent) 52%, var(--accent-2) 92%);
			-webkit-background-clip: text;
			background-clip: text;
			color: transparent;
		}
		h2 {
			font-size: 1.2rem;
			letter-spacing: 0.01em;
		}
		h3 {
			font-size: 0.98rem;
			text-transform: uppercase;
			letter-spacing: 0.09em;
			color: #c8d9ff;
		}
		p { margin: 0 0 10px; }
		ul { margin: 8px 0 0; padding-left: 20px; }
		li + li { margin-top: 4px; }
		.muted { color: var(--muted); }
		.panel {
			position: relative;
			background: linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%);
			border: 1px solid var(--border);
			border-radius: 16px;
			padding: 18px;
			box-shadow:
				0 10px 35px rgba(0, 0, 0, 0.34),
				inset 0 1px 0 rgba(255, 255, 255, 0.06);
			backdrop-filter: blur(5px);
		}
		.panel::after {
			content: "";
			position: absolute;
			inset: 0;
			border-radius: inherit;
			pointer-events: none;
			background: linear-gradient(135deg, rgba(146, 188, 255, 0.05), transparent 40%);
		}
		.stats-groups { display: grid; gap: 12px; }
		.stats-group {
			padding: 13px;
			border-radius: 12px;
			border: 1px dashed rgba(143, 173, 227, 0.36);
			background: linear-gradient(180deg, rgba(10, 16, 30, 0.7), rgba(8, 13, 25, 0.56));
		}
		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
			gap: 12px;
		}
		.card {
			position: relative;
			background: linear-gradient(165deg, rgba(20, 30, 56, 0.85), rgba(11, 18, 34, 0.72));
			border: 1px solid var(--border);
			border-radius: 12px;
			padding: 12px;
			transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
		}
		.card::before {
			content: "";
			position: absolute;
			left: 10px;
			right: 10px;
			top: 0;
			height: 2px;
			background: linear-gradient(90deg, transparent, rgba(136, 193, 255, 0.75), transparent);
			border-radius: 999px;
		}
		.card:hover {
			transform: translateY(-1px);
			border-color: var(--border-strong);
			box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
		}
		.value {
			font-size: 1.12rem;
			font-weight: 700;
			line-height: 1.3;
		}
		.badge {
			display: inline-block;
			padding: 2px 9px;
			border-radius: 999px;
			background: linear-gradient(180deg, rgba(127, 189, 255, 0.2), rgba(127, 189, 255, 0.09));
			border: 1px solid rgba(124, 184, 255, 0.42);
			font-size: 0.76rem;
			margin-right: 6px;
			margin-top: 4px;
		}
		.badge-error {
			background: linear-gradient(180deg, rgba(255, 123, 123, 0.24), rgba(255, 123, 123, 0.11));
			border-color: rgba(255, 123, 123, 0.52);
			color: #ffd6d6;
		}
		.controls {
			display: flex;
			gap: 10px;
			flex-wrap: wrap;
			align-items: center;
		}
		.controls label {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 5px 9px;
			border-radius: 999px;
			border: 1px solid var(--border);
			background: rgba(9, 14, 27, 0.7);
			font-size: 0.85rem;
			color: var(--muted);
		}
		.controls input[type="search"] {
			flex: 1;
			min-width: 220px;
			background: rgba(6, 10, 20, 0.86);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: 10px;
			padding: 9px 11px;
			outline: none;
			transition: border-color 140ms ease, box-shadow 140ms ease;
		}
		.controls input[type="search"]:focus {
			border-color: var(--border-strong);
			box-shadow: 0 0 0 3px rgba(121, 184, 255, 0.17);
		}
		.timeline { display: grid; gap: 12px; margin-top: 14px; }
		.timeline-turn {
			display: grid;
			gap: 8px;
			padding-left: 9px;
			border-left: 2px solid rgba(125, 168, 238, 0.2);
		}
		.timeline-item,
		.turn-group {
			border: 1px solid var(--border);
			border-radius: 12px;
			background: linear-gradient(175deg, rgba(10, 16, 31, 0.82), rgba(8, 13, 23, 0.67));
			overflow: hidden;
		}
		details > summary { list-style: none; }
		details > summary::-webkit-details-marker { display: none; }
		.timeline-item > summary,
		.timeline-item > header,
		.turn-group > summary,
		.nested-expand > summary {
			position: relative;
			padding: 12px;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			cursor: pointer;
		}
		.timeline-item > summary::before,
		.turn-group > summary::before,
		.nested-expand > summary::before {
			content: "▸";
			margin-right: 8px;
			font-size: 0.8rem;
			color: #9ec6ff;
			transition: transform 120ms ease;
		}
		.timeline-item[open] > summary::before,
		.turn-group[open] > summary::before,
		.nested-expand[open] > summary::before {
			transform: rotate(90deg);
		}
		.timeline-item > summary > span:first-child,
		.turn-group > summary > span:first-child {
			display: inline-flex;
			align-items: center;
			font-weight: 600;
		}
		.meta {
			text-align: right;
			max-width: 62%;
		}
		.timeline-item.user {
			border-left: 4px solid var(--success);
			background: linear-gradient(170deg, rgba(18, 45, 44, 0.44), rgba(10, 18, 20, 0.62));
		}
		.timeline-item.assistant { border-left: 4px solid var(--accent); }
		.timeline-item.toolResult { border-left: 4px solid #d2a8ff; }
		.timeline-item.bashExecution { border-left: 4px solid #ffe08a; }
		.turn-group {
			border-left: 4px solid #98b1ff;
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
		}
		.turn-group-items {
			display: grid;
			gap: 8px;
			padding: 8px;
			border-top: 1px solid var(--border);
			background: rgba(7, 12, 22, 0.72);
		}
		.content-block {
			margin: 0;
			padding: 12px;
			white-space: pre-wrap;
			font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
			font-size: 0.88rem;
			border-top: 1px solid rgba(123, 157, 214, 0.25);
			background: linear-gradient(180deg, rgba(6, 10, 18, 0.84), rgba(4, 8, 14, 0.78));
		}
		.nested-expand {
			border-top: 1px dashed rgba(132, 165, 222, 0.25);
		}
		.nested-expand > summary {
			padding: 10px 12px;
			color: var(--muted);
			font-size: 0.9rem;
		}
		.analysis-columns {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
			gap: 12px;
		}
		.analysis-item {
			padding: 10px;
			border-radius: 10px;
			border: 1px solid rgba(129, 161, 214, 0.22);
			background: rgba(8, 13, 25, 0.62);
		}
		.analysis-item + .analysis-item {
			margin-top: 10px;
		}
		.evidence {
			font-size: 0.8rem;
			line-height: 1.45;
			padding-top: 4px;
		}
		.hidden { display: none !important; }
		@media (max-width: 900px) {
			main { padding: 20px 14px 36px; }
			.meta { max-width: 100%; }
			.timeline-item > summary,
			.timeline-item > header,
			.turn-group > summary { flex-direction: column; align-items: flex-start; }
		}
	</style>
</head>
<body>
	<main>
		<section class="panel" style="margin-bottom: 14px;">
			<h1>${escapeHtml(report.title)}</h1>
			<p class="muted">Generated ${escapeHtml(timestampLabel(report.generatedAtIso))} · Session ${escapeHtml(dataset.header?.id ?? "in-memory")}</p>
			<p class="muted">Range: ${escapeHtml(timestampLabel(dataset.startTimestampIso))} → ${escapeHtml(timestampLabel(dataset.endTimestampIso))}</p>
		</section>

		${renderStatsSection(dataset)}

		<section class="panel" style="margin-bottom: 14px;">
			<h2>Analysis</h2>
			<p>${escapeHtml(analysis.summary)}</p>
			<div class="analysis-columns" style="margin-top: 12px;">
				${renderAnalysisPoints("Incorrect decisions", analysis.incorrectDecisions)}
				${renderAnalysisPoints("Unnecessary effort", analysis.unnecessaryEffort)}
				${renderAnalysisPoints("Unexpected findings", analysis.unexpectedFindings)}
			</div>
			<section class="panel" style="margin-top: 12px;">
				<h3>What to do better</h3>
				${improvements}
			</section>
			${notesSection ?? ""}
		</section>

		<section class="panel">
			<h2>Conversation timeline</h2>
			<p class="muted">Everything between user prompts is grouped into one collapsible activity block.</p>
			<div class="controls" style="margin-top: 10px;">
				<input id="search" type="search" placeholder="Search timeline..." />
				<label><input id="toggle-tools" type="checkbox" checked /> tool results</label>
				<label><input id="toggle-bash" type="checkbox" checked /> bash</label>
				<label><input id="toggle-custom" type="checkbox" /> custom</label>
			</div>
			<div id="timeline" class="timeline">${conversationHtml}</div>
		</section>
	</main>
	<script>
		(() => {
			const search = document.getElementById('search');
			const tools = document.getElementById('toggle-tools');
			const bash = document.getElementById('toggle-bash');
			const custom = document.getElementById('toggle-custom');
			const turns = Array.from(document.querySelectorAll('.timeline-turn'));

			const update = () => {
				const q = (search.value || '').toLowerCase().trim();

				for (const turn of turns) {
					const user = turn.querySelector('.timeline-entry[data-kind="user"]');
					const group = turn.querySelector('.turn-group');
					const entries = Array.from(turn.querySelectorAll('.turn-group .timeline-entry'));

					let hasVisibleEntry = false;
					let hasSearchVisibleEntry = false;

					for (const entry of entries) {
						const kind = entry.dataset.kind || '';
						const hay = entry.dataset.search || '';

						let visibleByKind = true;
						if (kind === 'toolResult' && !tools.checked) visibleByKind = false;
						if (kind === 'bashExecution' && !bash.checked) visibleByKind = false;
						if (kind === 'custom' && !custom.checked) visibleByKind = false;

						const searchMatch = !q || hay.includes(q);
						const visible = visibleByKind && searchMatch;
						entry.classList.toggle('hidden', !visible);

						if (visible) {
							hasVisibleEntry = true;
							if (searchMatch) hasSearchVisibleEntry = true;
						}
					}

					if (group) {
						group.classList.toggle('hidden', !hasVisibleEntry);
					}

					const userHay = user ? (user.dataset.search || '') : '';
					const userMatch = user ? (!q || userHay.includes(q)) : false;
					if (user) {
						const showUser = q ? (userMatch || hasVisibleEntry) : true;
						user.classList.toggle('hidden', !showUser);
					}

					const showTurn = q ? (userMatch || hasSearchVisibleEntry) : Boolean(user || hasVisibleEntry);
					turn.classList.toggle('hidden', !showTurn);
				}
			};

			search.addEventListener('input', update);
			tools.addEventListener('change', update);
			bash.addEventListener('change', update);
			custom.addEventListener('change', update);
			update();
		})();
	</script>
</body>
</html>`;
}
