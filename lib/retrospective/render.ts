import type { RetrospectiveAnalysis } from "./analysis";
import type { ConversationItem, RetrospectiveDataset } from "./core";

export interface RetrospectiveReport {
	title: string;
	generatedAtIso: string;
	dataset: RetrospectiveDataset;
	analysis: RetrospectiveAnalysis;
}

const LARGE_BLOCK_PREVIEW_CHARS = 1800;

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

function renderConversationItem(item: ConversationItem): string {
	const searchText = escapeHtml(`${item.role} ${item.text} ${prettyJson(item.metadata)}`.toLowerCase());
	const heading = `${item.kind.toUpperCase()} · ${timestampLabel(item.timestampIso)}`;
	const metadata = metadataBadges(item);
	const metadataJson = prettyJson(item.metadata);

	if (item.kind === "user") {
		return [
			`<article class="timeline-item user" data-kind="${item.kind}" data-search="${searchText}">`,
			`<header><h4>${escapeHtml(heading)}</h4><div class="meta">${metadata}</div></header>`,
			renderLargeTextBlock(item.text || "(empty)"),
			"</article>",
		].join("\n");
	}

	if (item.kind === "assistant") {
		const thinking = typeof item.metadata.thinking === "string" ? item.metadata.thinking : "";
		return [
			`<details class="timeline-item assistant" data-kind="${item.kind}" data-search="${searchText}">`,
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
		`<details class="timeline-item ${item.kind}" data-kind="${item.kind}" data-search="${searchText}">`,
		`<summary><span>${escapeHtml(heading)}</span><span class="meta">${metadata}</span></summary>`,
		renderLargeTextBlock(item.text || "(empty)"),
		`<details class="nested-expand"><summary>Metadata</summary><pre class="content-block">${escapeHtml(metadataJson)}</pre></details>`,
		"</details>",
	].join("\n");
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

export function renderRetrospectiveHtml(report: RetrospectiveReport): string {
	const { dataset, analysis } = report;
	const stats = dataset.stats;
	const conversationHtml = dataset.conversation.map((item) => renderConversationItem(item)).join("\n");
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
			--bg: #0b1020;
			--panel: #131a2e;
			--panel-2: #1a2440;
			--text: #e8ecf5;
			--muted: #9fb0d1;
			--accent: #7cb8ff;
			--danger: #ff7b7b;
			--border: #2a385e;
		}
		* { box-sizing: border-box; }
		body {
			margin: 0;
			font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
			background: radial-gradient(circle at top, #132041 0%, var(--bg) 45%);
			color: var(--text);
			line-height: 1.5;
		}
		main { max-width: 1200px; margin: 0 auto; padding: 24px; }
		h1, h2, h3, h4 { margin: 0 0 8px; }
		p { margin: 0 0 10px; }
		.muted { color: var(--muted); }
		.panel {
			background: linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%);
			border: 1px solid var(--border);
			border-radius: 14px;
			padding: 16px;
			box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25);
		}
		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
			gap: 12px;
		}
		.card {
			background: rgba(9, 14, 28, 0.55);
			border: 1px solid var(--border);
			border-radius: 12px;
			padding: 12px;
		}
		.value { font-size: 1.3rem; font-weight: 700; }
		.badge {
			display: inline-block;
			padding: 2px 8px;
			border-radius: 999px;
			background: rgba(124, 184, 255, 0.15);
			border: 1px solid rgba(124, 184, 255, 0.35);
			font-size: 0.78rem;
			margin-right: 6px;
			margin-top: 4px;
		}
		.badge-error {
			background: rgba(255, 123, 123, 0.16);
			border-color: rgba(255, 123, 123, 0.45);
		}
		.controls {
			display: flex;
			gap: 12px;
			flex-wrap: wrap;
			align-items: center;
		}
		.controls input[type="search"] {
			flex: 1;
			min-width: 220px;
			background: #0a0f1e;
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: 8px;
			padding: 8px 10px;
		}
		.timeline { display: grid; gap: 12px; margin-top: 14px; }
		.timeline-item {
			border: 1px solid var(--border);
			border-radius: 12px;
			background: rgba(6, 10, 19, 0.6);
			overflow: hidden;
		}
		.timeline-item > summary,
		.timeline-item > header {
			padding: 12px;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			cursor: pointer;
		}
		.timeline-item.user { border-left: 4px solid #7cf0ce; }
		.timeline-item.assistant { border-left: 4px solid #7cb8ff; }
		.timeline-item.toolResult { border-left: 4px solid #d2a8ff; }
		.timeline-item.bashExecution { border-left: 4px solid #ffe08a; }
		.content-block {
			margin: 0;
			padding: 12px;
			white-space: pre-wrap;
			font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
			font-size: 0.88rem;
			border-top: 1px solid var(--border);
			background: rgba(4, 8, 16, 0.68);
		}
		.nested-expand {
			border-top: 1px dashed var(--border);
		}
		.nested-expand > summary {
			padding: 10px 12px;
			cursor: pointer;
			color: var(--muted);
		}
		.analysis-columns {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
			gap: 12px;
		}
		.analysis-item + .analysis-item {
			margin-top: 10px;
			padding-top: 10px;
			border-top: 1px dashed var(--border);
		}
		.evidence { font-size: 0.8rem; }
		.hidden { display: none !important; }
	</style>
</head>
<body>
	<main>
		<section class="panel" style="margin-bottom: 14px;">
			<h1>${escapeHtml(report.title)}</h1>
			<p class="muted">Generated ${escapeHtml(timestampLabel(report.generatedAtIso))} · Session ${escapeHtml(dataset.header?.id ?? "in-memory")}</p>
			<p class="muted">Range: ${escapeHtml(timestampLabel(dataset.startTimestampIso))} → ${escapeHtml(timestampLabel(dataset.endTimestampIso))}</p>
		</section>

		<section class="panel" style="margin-bottom: 14px;">
			<h2>Session stats</h2>
			<div class="grid" style="margin-top: 10px;">
				<div class="card"><div class="muted">Duration</div><div class="value">${escapeHtml(formatMs(stats.sessionDurationMs))}</div></div>
				<div class="card"><div class="muted">Tool calls</div><div class="value">${stats.counts.toolCalls}</div></div>
				<div class="card"><div class="muted">Discovery calls</div><div class="value">${stats.discoveryCalls.total} (${stats.discoveryCalls.percentOfAllToolCalls}%)</div></div>
				<div class="card"><div class="muted">Errors</div><div class="value">${stats.counts.errors}</div></div>
				<div class="card"><div class="muted">Tool wait (sum)</div><div class="value">${escapeHtml(formatMs(stats.toolWaitMsTotal))}</div></div>
				<div class="card"><div class="muted">Tool wait (wall)</div><div class="value">${escapeHtml(formatMs(stats.toolWaitMsWallClock))}</div></div>
				<div class="card"><div class="muted">Output tokens</div><div class="value">${stats.tokens.output}</div></div>
				<div class="card"><div class="muted">Total tokens</div><div class="value">${stats.tokens.total}</div></div>
				<div class="card"><div class="muted">Cost</div><div class="value">${escapeHtml(formatCurrency(stats.tokens.cost.total))}</div></div>
				<div class="card"><div class="muted">Bash calls</div><div class="value">${stats.counts.bashCalls}</div><div class="muted">user ${stats.counts.userBashCalls} · assistant tool ${stats.counts.assistantBashToolCalls}</div></div>
			</div>
		</section>

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
			const items = Array.from(document.querySelectorAll('.timeline-item'));

			const update = () => {
				const q = (search.value || '').toLowerCase().trim();
				for (const item of items) {
					const kind = item.dataset.kind || '';
					const hay = item.dataset.search || '';
					let visible = true;
					if (kind === 'toolResult' && !tools.checked) visible = false;
					if (kind === 'bashExecution' && !bash.checked) visible = false;
					if (kind === 'custom' && !custom.checked) visible = false;
					if (visible && q && !hay.includes(q)) visible = false;
					item.classList.toggle('hidden', !visible);
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
