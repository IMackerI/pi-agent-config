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

	const title = `Everything that happened after this message (${items.length} item${items.length === 1 ? "" : "s"})`;
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

function renderIdeaBlocks(items: string[], emptyText: string): string {
	if (items.length === 0) return `<p class="muted">${escapeHtml(emptyText)}</p>`;
	return items
		.map((item) => `<article class="idea-block"><p>${escapeHtml(item)}</p></article>`)
		.join("");
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

function renderNotePointCards(title: string, items: string[]): string {
	if (items.length === 0) {
		return `<section class="panel"><h3>${escapeHtml(title)}</h3><p class="muted">No note items captured.</p></section>`;
	}

	return `<section class="panel"><h3>${escapeHtml(title)}</h3>${items
		.map((item) => `<article class="analysis-item"><p>${escapeHtml(item)}</p></article>`)
		.join("\n")}</section>`;
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
	const conversationHtml = [...turns].reverse().map((turn) => renderTurn(turn)).join("\n");
	const improvements =
		analysis.improvements.length > 0
			? `<ul>${analysis.improvements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
			: '<p class="muted">No improvement recommendations generated.</p>';
	const doDifferentlyAgain = renderIdeaBlocks(
		analysis.doDifferentlyAgain,
		"No bigger-picture redo notes generated yet.",
	);

	const hasRenderableNotes =
		!!analysis.agentNotes &&
		(
			!!analysis.agentNotes.summary ||
			analysis.agentNotes.incorrectDecisions.length > 0 ||
			analysis.agentNotes.unnecessaryEffort.length > 0 ||
			analysis.agentNotes.unexpectedFindings.length > 0 ||
			analysis.agentNotes.improvements.length > 0
		);

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${escapeHtml(report.title)}</title>
	<style>
		:root {
			--bg: #fbf6ee;
			--bg-soft: #fffdf8;
			--ink: #1f2533;
			--muted: #5d6475;
			--accent: #49b6e5;
			--accent-2: #ffd166;
			--accent-3: #ff8fab;
			--success: #16a34a;
			--danger: #dc2626;
			--surface: #fffef9;
			--surface-2: #fff8e8;
			--border: #263d5b;
		}
		* { box-sizing: border-box; }
		body {
			margin: 0;
			font-family: "Trebuchet MS", "Comic Sans MS", "Segoe Print", system-ui, sans-serif;
			background:
				radial-gradient(circle at 10% 0%, rgba(73, 182, 229, 0.22), transparent 26%),
				radial-gradient(circle at 92% 8%, rgba(255, 209, 102, 0.24), transparent 24%),
				linear-gradient(180deg, var(--bg-soft) 0%, var(--bg) 100%);
			color: var(--ink);
			line-height: 1.6;
		}
		body::before,
		body::after {
			content: "";
			position: fixed;
			pointer-events: none;
			z-index: 0;
			border: 3px dashed rgba(38, 61, 91, 0.09);
			border-radius: 26px;
		}
		body::before {
			width: 120px;
			height: 70px;
			top: 28px;
			left: 22px;
			transform: rotate(-7deg);
		}
		body::after {
			width: 100px;
			height: 100px;
			bottom: 24px;
			right: 30px;
			transform: rotate(12deg);
		}
		main {
			position: relative;
			z-index: 1;
			max-width: 1240px;
			margin: 0 auto;
			padding: 26px 18px 44px;
		}
		h1, h2, h3, h4 { margin: 0 0 8px; }
		h1 {
			font-size: clamp(1.7rem, 3vw, 2.5rem);
			line-height: 1.12;
			font-family: "Comic Sans MS", "Segoe Print", cursive;
			letter-spacing: 0.01em;
			color: var(--border);
			text-shadow: 2px 2px 0 rgba(73, 182, 229, 0.18);
		}
		h2 {
			font-size: 1.25rem;
			font-family: "Comic Sans MS", "Segoe Print", cursive;
			color: var(--border);
		}
		h3 {
			font-size: 0.96rem;
			text-transform: uppercase;
			letter-spacing: 0.08em;
			color: var(--muted);
		}
		p { margin: 0 0 10px; }
		ul { margin: 8px 0 0; padding-left: 20px; }
		li + li { margin-top: 5px; }
		.muted { color: var(--muted); }
		.panel {
			position: relative;
			background: var(--surface);
			border: 3px solid var(--border);
			border-radius: 22px 18px 24px 16px;
			padding: 18px;
			box-shadow: 6px 8px 0 rgba(38, 61, 91, 0.12);
		}
		.panel::before {
			content: "";
			position: absolute;
			inset: 8px;
			border: 2px dashed rgba(38, 61, 91, 0.12);
			border-radius: 18px 14px 19px 13px;
			pointer-events: none;
		}
		.hero-panel {
			background: linear-gradient(180deg, rgba(255, 254, 249, 0.98), rgba(255, 250, 240, 0.98));
		}
		.hero-panel::after {
			content: "✦   ◌   ✦";
			position: absolute;
			right: 20px;
			top: 16px;
			font-size: 1rem;
			letter-spacing: 10px;
			color: rgba(73, 182, 229, 0.55);
			pointer-events: none;
		}
		.stats-groups { display: grid; gap: 12px; }
		.stats-group {
			padding: 13px;
			border-radius: 18px 16px 20px 14px;
			border: 2px dashed rgba(38, 61, 91, 0.35);
			background: rgba(255, 248, 232, 0.65);
		}
		.stats-group:nth-child(4n + 1) { background: rgba(238, 249, 255, 0.78); }
		.stats-group:nth-child(4n + 2) { background: rgba(255, 244, 221, 0.82); }
		.stats-group:nth-child(4n + 3) { background: rgba(255, 239, 244, 0.82); }
		.stats-group:nth-child(4n + 4) { background: rgba(240, 249, 235, 0.82); }
		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
			gap: 12px;
		}
		.card {
			position: relative;
			background: linear-gradient(180deg, #ffffff 0%, #fff7eb 100%);
			border: 2px solid var(--border);
			border-radius: 16px 12px 18px 14px;
			padding: 12px;
			box-shadow: 3px 4px 0 rgba(38, 61, 91, 0.09);
		}
		.card:nth-child(3n) { transform: rotate(-0.4deg); }
		.card:nth-child(3n + 1) { transform: rotate(0.5deg); }
		.card:nth-child(3n + 2) { transform: rotate(-0.2deg); }
		.value {
			font-size: 1.12rem;
			font-weight: 700;
			line-height: 1.3;
			color: var(--border);
		}
		.badge {
			display: inline-block;
			padding: 3px 10px;
			border-radius: 999px;
			background: #eef9ff;
			border: 2px solid var(--accent);
			font-size: 0.76rem;
			margin-right: 6px;
			margin-top: 4px;
			color: var(--border);
		}
		.badge-error {
			background: #fff0f0;
			border-color: var(--danger);
			color: var(--danger);
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
			border: 2px solid var(--border);
			background: #fffef9;
			font-size: 0.85rem;
			color: var(--muted);
			box-shadow: 2px 3px 0 rgba(38, 61, 91, 0.06);
		}
		.controls label:nth-of-type(1) { background: #eef9ff; }
		.controls label:nth-of-type(2) { background: #fff7df; }
		.controls label:nth-of-type(3) { background: #fff0f6; }
		.controls input[type="search"] {
			flex: 1;
			min-width: 220px;
			background: #fffef9;
			color: var(--ink);
			border: 2px solid var(--border);
			border-radius: 14px;
			padding: 9px 11px;
			outline: none;
			box-shadow: 2px 3px 0 rgba(38, 61, 91, 0.08);
		}
		.controls input[type="search"]:focus {
			box-shadow: 0 0 0 4px rgba(73, 182, 229, 0.18);
		}
		.timeline { display: grid; gap: 14px; margin-top: 14px; }
		.timeline-turn {
			display: grid;
			gap: 8px;
			padding-left: 12px;
			border-left: 4px dashed rgba(38, 61, 91, 0.18);
		}
		.timeline-item,
		.turn-group {
			border: 2px solid var(--border);
			border-radius: 18px 14px 18px 12px;
			background: var(--surface);
			overflow: hidden;
			box-shadow: 3px 4px 0 rgba(38, 61, 91, 0.08);
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
			content: "✎";
			margin-right: 8px;
			font-size: 0.85rem;
			color: var(--accent);
			transition: transform 120ms ease;
		}
		.timeline-item[open] > summary::before,
		.turn-group[open] > summary::before,
		.nested-expand[open] > summary::before {
			transform: rotate(18deg) scale(1.08);
		}
		.timeline-item > summary > span:first-child,
		.turn-group > summary > span:first-child {
			display: inline-flex;
			align-items: center;
			font-weight: 700;
			color: var(--border);
		}
		.meta {
			text-align: right;
			max-width: 62%;
		}
		.timeline-item.user {
			border-left: 7px solid var(--success);
			background: linear-gradient(180deg, #ffffff 0%, #f4fff8 100%);
		}
		.timeline-item.assistant {
			border-left: 7px solid var(--accent);
			background: linear-gradient(180deg, #ffffff 0%, #f5fbff 100%);
		}
		.timeline-item.toolResult {
			border-left: 7px solid #b38ef3;
			background: linear-gradient(180deg, #fffefe 0%, #fbf7ff 100%);
		}
		.timeline-item.bashExecution {
			border-left: 7px solid var(--accent-2);
			background: linear-gradient(180deg, #fffefa 0%, #fff8e8 100%);
		}
		.turn-group {
			border-left: 7px solid var(--accent-3);
			background: linear-gradient(180deg, #fffefd 0%, #fff5f8 100%);
		}
		.turn-group-items {
			display: grid;
			gap: 8px;
			padding: 8px;
			border-top: 2px dashed rgba(38, 61, 91, 0.2);
			background: rgba(255, 255, 255, 0.55);
		}
		.content-block {
			margin: 0;
			padding: 12px;
			white-space: pre-wrap;
			font-family: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
			font-size: 0.88rem;
			border-top: 2px dashed rgba(38, 61, 91, 0.18);
			background: rgba(255, 255, 255, 0.62);
		}
		.nested-expand {
			border-top: 2px dashed rgba(38, 61, 91, 0.18);
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
		.analysis-columns > .panel:nth-child(1) {
			background: rgba(255, 228, 236, 0.92);
		}
		.analysis-columns > .panel:nth-child(2) {
			background: rgba(255, 243, 199, 0.95);
		}
		.analysis-columns > .panel:nth-child(3) {
			background: rgba(214, 241, 255, 0.94);
		}
		.analysis-item {
			padding: 10px;
			border-radius: 15px 12px 16px 13px;
			border: 2px solid rgba(38, 61, 91, 0.22);
			background: rgba(255, 255, 255, 0.82);
		}
		.analysis-columns > .panel:nth-child(1) .analysis-item { background: rgba(255, 239, 244, 0.98); }
		.analysis-columns > .panel:nth-child(2) .analysis-item { background: rgba(255, 248, 221, 0.98); }
		.analysis-columns > .panel:nth-child(3) .analysis-item { background: rgba(233, 248, 255, 0.98); }
		.idea-block {
			margin-top: 10px;
			padding: 14px 16px;
			border: 2px solid var(--border);
			border-radius: 18px 14px 18px 12px;
			background: linear-gradient(180deg, #fff7df 0%, #fff0f6 100%);
			box-shadow: 3px 4px 0 rgba(38, 61, 91, 0.08);
		}
		.idea-block:nth-child(2n) {
			background: linear-gradient(180deg, #eef9ff 0%, #fff7df 100%);
		}
		.idea-block p {
			margin: 0;
			font-size: 0.98rem;
			line-height: 1.7;
		}
		.analysis-item + .analysis-item { margin-top: 10px; }
		.analysis-label {
			display: flex;
			align-items: center;
			gap: 10px;
			margin: 14px 0 10px;
		}
		.analysis-label::after {
			content: "";
			flex: 1;
			height: 2px;
			border-top: 2px dashed rgba(38, 61, 91, 0.22);
		}
		.analysis-note-copy {
			margin-top: 12px;
			padding: 12px 14px;
			border: 2px dashed rgba(38, 61, 91, 0.28);
			border-radius: 18px 14px 18px 12px;
			background: rgba(255, 255, 255, 0.66);
		}
		.evidence {
			font-size: 0.8rem;
			line-height: 1.45;
			padding-top: 4px;
		}
		.sketch-note {
			display: inline-block;
			padding: 4px 10px;
			margin-bottom: 10px;
			border: 2px dashed var(--border);
			border-radius: 999px;
			background: linear-gradient(90deg, #fff8e8, #eef9ff, #fff0f6);
			font-size: 0.83rem;
			color: var(--muted);
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
		<section class="panel hero-panel" style="margin-bottom: 14px;">
			<div class="sketch-note">a friendlier way to look back at the session</div>
			<h1>${escapeHtml(report.title)}</h1>
			<p class="muted">Generated ${escapeHtml(timestampLabel(report.generatedAtIso))} · Session ${escapeHtml(dataset.header?.id ?? "in-memory")}</p>
			<p class="muted">Range: ${escapeHtml(timestampLabel(dataset.startTimestampIso))} → ${escapeHtml(timestampLabel(dataset.endTimestampIso))}</p>
		</section>

		${renderStatsSection(dataset)}

		<section class="panel" style="margin-bottom: 14px;">
			<h2>Analysis</h2>
			<p>${escapeHtml(analysis.summary)}</p>
			${analysis.modeNote ? `<p class="muted">${escapeHtml(analysis.modeNote)}</p>` : ""}
			${hasRenderableNotes ? `<div class="analysis-note-copy"><div class="sketch-note">Agent notes since last compaction</div>${analysis.agentNotes?.summary ? `<p>${escapeHtml(analysis.agentNotes.summary)}</p>` : `<p class="muted">Structured notes were available, but only the section lists were useful enough to keep.</p>`}</div>` : ""}
			${hasRenderableNotes ? `<div class="analysis-label"><div class="sketch-note">From the notes model</div></div>` : ""}
			${hasRenderableNotes ? `<div class="analysis-columns" style="margin-top: 12px;">${renderNotePointCards("Incorrect decisions", analysis.agentNotes?.incorrectDecisions ?? [])}${renderNotePointCards("Unnecessary effort", analysis.agentNotes?.unnecessaryEffort ?? [])}${renderNotePointCards("Unexpected findings", analysis.agentNotes?.unexpectedFindings ?? [])}</div>` : ""}
			<div class="analysis-label"><div class="sketch-note">Heuristic signals</div></div>
			<div class="analysis-columns" style="margin-top: 12px;">
				${renderAnalysisPoints("Incorrect decisions", analysis.incorrectDecisions)}
				${renderAnalysisPoints("Unnecessary effort", analysis.unnecessaryEffort)}
				${renderAnalysisPoints("Unexpected findings", analysis.unexpectedFindings)}
			</div>
			<section class="panel" style="margin-top: 12px;">
				<h3>What would help next time</h3>
				<p class="muted">Smaller adjustments that would probably make the session cleaner or faster.</p>
				${improvements}
			</section>
			<section class="panel" style="margin-top: 12px;">
				<h3>If we did this again</h3>
				<p class="muted">Bigger-picture changes: how I would approach it differently, and what both of us could do to make the collaboration smoother from the start.</p>
				${doDifferentlyAgain}
			</section>
		</section>

		<section class="panel">
			<h2>Conversation timeline</h2>
			<p class="muted">Newest at the top. Everything that happened between user messages is bundled into one expandable activity block.</p>
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
