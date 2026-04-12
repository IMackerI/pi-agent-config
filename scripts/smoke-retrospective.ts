import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { buildHeuristicAnalysis } from "../lib/retrospective/analysis";
import { buildRetrospectiveDataset } from "../lib/retrospective/core";
import { renderRetrospectiveHtml } from "../lib/retrospective/render";

async function collectJsonlFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectJsonlFiles(fullPath)));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(fullPath);
	}
	return files;
}

async function findLatestSessionFile(rootDir: string): Promise<string | null> {
	try {
		const files = await collectJsonlFiles(rootDir);
		if (files.length === 0) return null;

		let latest: { path: string; mtimeMs: number } | null = null;
		for (const file of files) {
			const stat = await Bun.file(file).stat();
			if (!latest || stat.mtimeMs > latest.mtimeMs) latest = { path: file, mtimeMs: stat.mtimeMs };
		}
		return latest?.path ?? null;
	} catch {
		return null;
	}
}

function buildFromSessionFile(filePath: string) {
	const sm = SessionManager.open(filePath);
	const dataset = buildRetrospectiveDataset(sm.getBranch(), sm.getHeader(), sm.getLeafId());
	const analysis = buildHeuristicAnalysis(dataset);
	return { dataset, analysis };
}

function buildFallbackFixture() {
	const now = Date.now();
	const entries: any[] = [
		{
			type: "message",
			id: "u1",
			parentId: null,
			timestamp: new Date(now - 5000).toISOString(),
			message: { role: "user", content: [{ type: "text", text: "Generate a report." }], timestamp: now - 5000 },
		},
		{
			type: "message",
			id: "a1",
			parentId: "u1",
			timestamp: new Date(now - 4000).toISOString(),
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "I will inspect files." },
					{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "README.md" } },
				],
				api: "openai-responses",
				provider: "openai",
				model: "gpt-5.2",
				usage: {
					input: 100,
					output: 40,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 140,
					cost: { input: 0.001, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.002 },
				},
				stopReason: "toolUse",
				timestamp: now - 4000,
			},
		},
		{
			type: "message",
			id: "t1",
			parentId: "a1",
			timestamp: new Date(now - 3500).toISOString(),
			message: {
				role: "toolResult",
				toolCallId: "tc1",
				toolName: "read",
				content: [{ type: "text", text: "# Title" }],
				isError: false,
				timestamp: now - 3500,
			},
		},
		{
			type: "message",
			id: "b1",
			parentId: "t1",
			timestamp: new Date(now - 3000).toISOString(),
			message: {
				role: "bashExecution",
				command: "fish",
				output: "(interactive fish session completed successfully)",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: now - 3000,
			},
		},
	];

	const dataset = buildRetrospectiveDataset(entries as any, null, "b1");
	const analysis = buildHeuristicAnalysis(dataset);
	return { dataset, analysis };
}

const sessionDir = resolve(process.cwd(), "sessions");
const latestSession = await findLatestSessionFile(sessionDir);
const source = latestSession ? buildFromSessionFile(latestSession) : buildFallbackFixture();

const outputDir = resolve(process.cwd(), ".pi", "conversation-retrospectives");
await mkdir(outputDir, { recursive: true });
const outputPath = join(outputDir, "smoke-retrospective.html");

const html = renderRetrospectiveHtml({
	title: "Retrospective Smoke",
	generatedAtIso: new Date().toISOString(),
	dataset: source.dataset,
	analysis: source.analysis,
});

await writeFile(outputPath, html, "utf8");

await access(outputPath);
const written = await readFile(outputPath, "utf8");
const expectedSnippets = ["Session stats", "Analysis", "Conversation timeline"];
for (const snippet of expectedSnippets) {
	if (!written.includes(snippet)) {
		throw new Error(`Retrospective smoke failed: missing '${snippet}' in ${outputPath}`);
	}
}

console.log(`Retrospective smoke OK: ${outputPath}`);
if (latestSession) console.log(`Source session: ${latestSession}`);
else console.log("Source session: fallback fixture");
