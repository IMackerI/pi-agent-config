import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const helperPath = join(extensionDir, "jupyter_notebook_kernel_helper.py");

type Notebook = { cells: any[]; metadata?: any; nbformat?: number; nbformat_minor?: number; [key: string]: any };
type CellRef = number | string;
type KernelProc = {
	key: string;
	process: ChildProcessWithoutNullStreams;
	pending: Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>;
	buffer: string;
	stderr: string;
	startupError?: string;
};

const kernels = new Map<string, KernelProc>();

function makeToolResult(text: string, details: any = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

function makeToolError(text: string, details: any = {}) {
	return { content: [{ type: "text" as const, text }], details, isError: true };
}

function resolveLocalPath(cwd: string, path: string): string {
	if (!path || !path.trim()) throw new Error("Notebook path is required.");
	return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function readNotebook(cwd: string, path: string): { notebook: Notebook; absolutePath: string } {
	const absolutePath = resolveLocalPath(cwd, path);
	if (!existsSync(absolutePath)) {
		throw new Error("Notebook file does not exist: " + absolutePath);
	}
	let raw: string;
	try {
		raw = readFileSync(absolutePath, "utf8");
	} catch (error: any) {
		throw new Error("Could not read notebook: " + absolutePath + ". " + (error?.message ?? String(error)));
	}
	let notebook: Notebook;
	try {
		notebook = JSON.parse(raw);
	} catch (error: any) {
		throw new Error("Notebook is not valid JSON: " + absolutePath + ". " + (error?.message ?? String(error)));
	}
	if (!notebook || typeof notebook !== "object" || !Array.isArray(notebook.cells)) {
		throw new Error("File is not a valid .ipynb notebook: missing top-level cells array in " + absolutePath);
	}
	return { notebook, absolutePath };
}

function writeNotebook(absolutePath: string, notebook: Notebook) {
	try {
		writeFileSync(absolutePath, JSON.stringify(notebook, null, 1) + "\n", "utf8");
	} catch (error: any) {
		throw new Error("Could not write notebook: " + absolutePath + ". " + (error?.message ?? String(error)));
	}
}

function sourceToText(source: any): string {
	if (typeof source === "string") return source;
	if (Array.isArray(source)) return source.map((part) => String(part)).join("");
	if (source == null) return "";
	return String(source);
}

function splitLinesKeepNewline(text: string): string[] {
	if (text.length === 0) return [];
	return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function textToSourceLike(text: string, like: any): string | string[] {
	return Array.isArray(like) ? splitLinesKeepNewline(text) : text;
}

function cellSourceHash(cell: any): string {
	return createHash("sha256").update(sourceToText(cell?.source)).digest("hex").slice(0, 16);
}

function resolveCellIndex(notebook: Notebook, cell: CellRef, label = "cell"): number {
	if (typeof cell === "number") {
		if (!Number.isInteger(cell)) throw new Error(label + " index must be an integer, got " + cell + ".");
		if (cell < 0 || cell >= notebook.cells.length) {
			throw new Error(label + " index " + cell + " is out of range. Notebook has " + notebook.cells.length + " cells.");
		}
		return cell;
	}
	const id = String(cell);
	const matches: number[] = [];
	for (let i = 0; i < notebook.cells.length; i++) {
		if (String(notebook.cells[i]?.id ?? "") === id) matches.push(i);
	}
	if (matches.length === 0) throw new Error(label + " id not found: " + id);
	if (matches.length > 1) throw new Error(label + " id is not unique: " + id);
	return matches[0];
}

function checkExpectedHash(cell: any, expectedHash?: string) {
	if (!expectedHash) return;
	const actual = cellSourceHash(cell);
	if (actual !== expectedHash) {
		throw new Error(
			"Cell hash mismatch. Expected " + expectedHash + ", actual " + actual + ". Read the cell again before editing."
		);
	}
}

function truncate(text: string, max = 160): string {
	const compact = text.replace(/\s+/g, " ").trim();
	return compact.length > max ? compact.slice(0, max - 1) + "…" : compact;
}

function firstLines(text: string, maxLines: number): string {
	const lines = text.split(/\r?\n/).slice(0, maxLines).join("\\n");
	return truncate(lines, 180);
}

function outputCount(cell: any): number {
	return Array.isArray(cell?.outputs) ? cell.outputs.length : 0;
}

function formatOutput(output: any, maxChars: number): string {
	const type = output?.output_type ?? "unknown";
	if (type === "stream") return "stream[" + (output.name ?? "") + "]: " + truncate(sourceToText(output.text), maxChars);
	if (type === "error") return "error: " + (output.ename ?? "Error") + ": " + (output.evalue ?? "");
	if (type === "execute_result" || type === "display_data") {
		const data = output.data ?? {};
		if (data["text/plain"] !== undefined) return type + " text/plain: " + truncate(sourceToText(data["text/plain"]), maxChars);
		const keys = Object.keys(data);
		return type + " data: " + (keys.length ? keys.join(", ") : "(empty)");
	}
	return type;
}

function formatOutputs(cell: any, maxChars: number): string {
	const outputs = Array.isArray(cell?.outputs) ? cell.outputs : [];
	if (outputs.length === 0) return "No outputs.";
	return outputs.map((output, i) => "  [" + i + "] " + formatOutput(output, maxChars)).join("\n");
}

function createCell(cellType: string, source: string, metadata: any = {}) {
	if (!["code", "markdown", "raw"].includes(cellType)) throw new Error("Invalid cell_type: " + cellType);
	const base: any = { cell_type: cellType, id: randomUUID(), metadata: metadata ?? {}, source };
	if (cellType === "code") {
		base.execution_count = null;
		base.outputs = [];
	}
	return base;
}

function normalizeCellType(cell: any, cellType: string) {
	if (!["code", "markdown", "raw"].includes(cellType)) throw new Error("Invalid cell_type: " + cellType);
	cell.cell_type = cellType;
	if (cellType === "code") {
		if (!Array.isArray(cell.outputs)) cell.outputs = [];
		if (!("execution_count" in cell)) cell.execution_count = null;
	} else {
		delete cell.outputs;
		delete cell.execution_count;
	}
}

function markdownCell(source: string) {
	return createCell("markdown", source);
}

function codeCell(source = "") {
	return createCell("code", source);
}

function createNotebookTemplate(kind: string, title: string): Notebook {
	const cleanTitle = title.trim() || "Untitled Notebook";
	let cells: any[];
	if (kind === "experiment") {
		cells = [
			markdownCell("# Experiment: " + cleanTitle),
			markdownCell("## Objective\nState the question, success criteria, and expected outcome."),
			markdownCell("## Setup"),
			codeCell("from pathlib import Path\n\nimport numpy as np\n\nSEED = 42\nrng = np.random.default_rng(SEED)"),
			markdownCell("## Configuration\nKeep experiment knobs in one small cell."),
			codeCell("config = {\n    \"seed\": SEED,\n}"),
			markdownCell("## Plan\n- Hypothesis:\n- Metrics:\n- Baseline:"),
			markdownCell("## Baseline"),
			codeCell("# Build the smallest runnable baseline here"),
			markdownCell("## Results\nSummarize key metrics and observations near the code that produced them."),
			markdownCell("## Next steps\n- Continue / pivot / stop:\n- Follow-up ideas:"),
		];
	} else if (kind === "tutorial") {
		cells = [
			markdownCell("# Tutorial: " + cleanTitle),
			markdownCell("## Audience and goals\nAudience:\n\nPrerequisites:\n\nBy the end, you will be able to:"),
			markdownCell("## Outline\n1.\n2.\n3."),
			markdownCell("## Setup"),
			codeCell("# Imports and setup go here"),
			markdownCell("## Step 1\nExplain the purpose of this step and the expected result."),
			codeCell("# Small runnable example"),
			markdownCell("## Exercise\nTry changing one parameter or input and predict what will happen."),
			codeCell("# Exercise scaffold"),
			markdownCell("## Common pitfalls\n- Pitfall:\n- Fix:"),
			markdownCell("## Extensions\n- Optional next thing to try:"),
		];
	} else if (kind === "blank") {
		cells = [markdownCell("# " + cleanTitle), codeCell("")];
	} else {
		throw new Error("Invalid kind: " + kind + ". Use experiment, tutorial, or blank.");
	}
	return {
		cells,
		metadata: {
			kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
			language_info: { name: "python" },
		},
		nbformat: 4,
		nbformat_minor: 5,
	};
}

function parseExpectedHashes(value: any): Map<string, string> {
	const map = new Map<string, string>();
	if (!value) return map;
	if (Array.isArray(value)) {
		value.forEach((hash, index) => {
			if (typeof hash === "string" && hash) map.set(String(index), hash);
		});
		return map;
	}
	if (typeof value === "object") {
		for (const [key, hash] of Object.entries(value)) {
			if (typeof hash === "string" && hash) map.set(String(key), hash);
		}
		return map;
	}
	throw new Error("expected_hashes must be an object mapping cell refs to hashes, or an array aligned with cells.");
}

function findVenvPython(startDir: string, stopDir: string): string | undefined {
	let current = resolve(startDir);
	const stop = resolve(stopDir);
	while (true) {
		const candidate = join(current, ".venv", "bin", "python");
		if (existsSync(candidate)) return candidate;
		if (current === stop || current === dirname(current)) break;
		current = dirname(current);
	}
	return undefined;
}

function resolveExecutionOptions(cwd: string, absolutePath: string, params: any) {
	const requestedCwd = params.cwd ? resolveLocalPath(cwd, params.cwd) : dirname(absolutePath);
	if (params.python_path && params.kernel_name) {
		throw new Error("Use either python_path or kernel_name, not both.");
	}
	let pythonPath: string | undefined;
	let kernelName: string | undefined;
	let source = "";
	if (params.python_path) {
		pythonPath = resolveLocalPath(cwd, params.python_path);
		if (!existsSync(pythonPath)) throw new Error("python_path does not exist: " + pythonPath);
		source = "explicit python_path";
	} else if (params.kernel_name) {
		kernelName = String(params.kernel_name);
		source = "explicit kernel_name";
	} else {
		pythonPath = findVenvPython(requestedCwd, cwd) ?? findVenvPython(dirname(absolutePath), dirname(absolutePath));
		if (pythonPath) {
			source = "auto-detected .venv/bin/python";
		} else {
			const { notebook } = readNotebook(cwd, absolutePath);
			const metaKernel = notebook.metadata?.kernelspec?.name;
			if (metaKernel) {
				kernelName = String(metaKernel);
				source = "notebook metadata kernelspec";
			} else {
				pythonPath = "python3";
				source = "fallback python3";
			}
		}
	}
	return { cwd: requestedCwd, pythonPath, kernelName, source };
}

function cellsToIndexes(notebook: Notebook, cells: any): number[] {
	if (cells === undefined || cells === null || cells === "all") return notebook.cells.map((_cell, i) => i);
	if (Array.isArray(cells)) return cells.map((cell, i) => resolveCellIndex(notebook, cell, "cells[" + i + "]"));
	if (typeof cells === "object" && Number.isInteger(cells.start) && Number.isInteger(cells.end)) {
		const start = cells.start;
		const end = cells.end;
		if (start < 0 || end < start || end >= notebook.cells.length) {
			throw new Error("Invalid cell range start=" + start + ", end=" + end + ". Notebook has " + notebook.cells.length + " cells.");
		}
		const result: number[] = [];
		for (let i = start; i <= end; i++) result.push(i);
		return result;
	}
	throw new Error("cells must be 'all', a list of indexes/ids, or {start, end}.");
}

function summarizeCellExecution(result: any): string {
	const lines: string[] = [];
	for (const cell of result.cells ?? []) {
		const status = cell.error ? "error" : "ok";
		lines.push("[" + cell.index + "] " + status + " execution_count=" + (cell.execution_count ?? "null") + " outputs=" + (cell.outputs?.length ?? 0));
		for (const output of cell.output_summaries ?? []) lines.push("  " + output);
	}
	return lines.join("\n");
}

function spawnKernelProcess(key: string): KernelProc {
	const child = spawn("uv", ["run", "--quiet", "--with", "jupyter_client", "python", helperPath], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	const entry: KernelProc = { key, process: child, pending: new Map(), buffer: "", stderr: "" };

	child.stdout.on("data", (chunk) => {
		entry.buffer += chunk.toString("utf8");
		let newline = entry.buffer.indexOf("\n");
		while (newline >= 0) {
			const line = entry.buffer.slice(0, newline).trim();
			entry.buffer = entry.buffer.slice(newline + 1);
			if (line) {
				let payload: any;
				try {
					payload = JSON.parse(line);
				} catch (error: any) {
					for (const pending of entry.pending.values()) pending.reject(new Error("Kernel helper returned invalid JSON: " + line));
					entry.pending.clear();
					continue;
				}
				const pending = entry.pending.get(String(payload.id));
				if (pending) {
					entry.pending.delete(String(payload.id));
					if (payload.ok) pending.resolve(payload.result);
					else pending.reject(new Error(formatHelperError(payload.error)));
				} else if (payload.ok === false) {
					entry.startupError = formatHelperError(payload.error);
				}
			}
			newline = entry.buffer.indexOf("\n");
		}
	});

	child.stderr.on("data", (chunk) => {
		entry.stderr = (entry.stderr + chunk.toString("utf8")).slice(-4000);
	});

	child.on("error", (error) => {
		for (const pending of entry.pending.values()) {
			pending.reject(new Error("Could not start notebook kernel helper. Is uv installed? " + error.message));
		}
		entry.pending.clear();
		kernels.delete(key);
	});
	child.on("exit", (code, signal) => {
		const diagnostics = entry.startupError || entry.stderr.trim();
		for (const pending of entry.pending.values()) {
			pending.reject(new Error("Notebook kernel helper exited unexpectedly (code=" + code + ", signal=" + signal + ")." + (diagnostics ? "\n" + diagnostics : "")));
		}
		entry.pending.clear();
		kernels.delete(key);
	});
	return entry;
}

function formatHelperError(error: any): string {
	if (!error) return "Notebook execution failed for an unknown reason.";
	const parts = [error.message ?? String(error)];
	if (error.hint) parts.push("Hint: " + error.hint);
	if (error.details) parts.push("Details: " + error.details);
	return parts.join("\n");
}

function getKernelProcess(key: string): KernelProc {
	let entry = kernels.get(key);
	if (!entry || entry.process.killed) {
		entry = spawnKernelProcess(key);
		kernels.set(key, entry);
	}
	return entry;
}

function sendKernelCommand(key: string, command: any, timeoutMs: number): Promise<any> {
	const entry = getKernelProcess(key);
	const id = randomUUID();
	const payload = { id, ...command };
	return new Promise((resolvePromise, rejectPromise) => {
		const timer = setTimeout(() => {
			entry.pending.delete(id);
			rejectPromise(new Error("Notebook kernel helper did not respond within " + timeoutMs + "ms."));
		}, timeoutMs);
		entry.pending.set(id, {
			resolve: (value) => {
				clearTimeout(timer);
				resolvePromise(value);
			},
			reject: (error) => {
				clearTimeout(timer);
				rejectPromise(error);
			},
		});
		entry.process.stdin.write(JSON.stringify(payload) + "\n");
	});
}

function kernelKey(absolutePath: string, options: { cwd: string; pythonPath?: string; kernelName?: string }) {
	return [absolutePath, options.cwd, options.pythonPath ? "python:" + options.pythonPath : "kernel:" + options.kernelName].join("\n");
}

function resolveSyntaxPython(cwd: string, absolutePath: string, params: any) {
	const requestedCwd = params.cwd ? resolveLocalPath(cwd, params.cwd) : dirname(absolutePath);
	let pythonPath: string;
	let source: string;
	if (params.python_path) {
		pythonPath = resolveLocalPath(cwd, params.python_path);
		if (!existsSync(pythonPath)) throw new Error("python_path does not exist: " + pythonPath);
		source = "explicit python_path";
	} else {
		pythonPath = findVenvPython(requestedCwd, cwd) ?? findVenvPython(dirname(absolutePath), dirname(absolutePath)) ?? "python3";
		source = pythonPath === "python3" ? "fallback python3" : "auto-detected .venv/bin/python";
	}
	return { cwd: requestedCwd, pythonPath, source };
}

const SYNTAX_CHECK_SCRIPT = `
import ast, json, sys
payload = json.load(sys.stdin)
errors = []
for cell in payload.get("cells", []):
    index = cell.get("index")
    source = cell.get("source") or ""
    try:
        ast.parse(source, filename=f"<notebook cell {index}>")
    except SyntaxError as exc:
        errors.append({
            "index": index,
            "message": exc.msg,
            "lineno": exc.lineno,
            "offset": exc.offset,
            "end_lineno": getattr(exc, "end_lineno", None),
            "end_offset": getattr(exc, "end_offset", None),
            "text": exc.text,
        })
print(json.dumps({"checked": len(payload.get("cells", [])), "errors": errors}), flush=True)
`;

function runSyntaxCheck(pythonPath: string, cwd: string, cells: Array<{ index: number; source: string }>, timeoutMs: number): Promise<any> {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(pythonPath, ["-c", SYNTAX_CHECK_SCRIPT], { cwd, stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill();
			rejectPromise(new Error("Python syntax check timed out after " + timeoutMs + "ms."));
		}, timeoutMs);
		child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
		child.stderr.on("data", (chunk) => (stderr = (stderr + chunk.toString("utf8")).slice(-4000)));
		child.on("error", (error) => {
			clearTimeout(timer);
			rejectPromise(new Error("Could not start Python for syntax check: " + error.message));
		});
		child.on("exit", (code, signal) => {
			clearTimeout(timer);
			if (code !== 0) {
				rejectPromise(new Error("Python syntax check process failed (code=" + code + ", signal=" + signal + ")." + (stderr.trim() ? "\n" + stderr.trim() : "")));
				return;
			}
			try {
				resolvePromise(JSON.parse(stdout));
			} catch (error: any) {
				rejectPromise(new Error("Python syntax check returned invalid JSON. " + (error?.message ?? String(error))));
			}
		});
		child.stdin.end(JSON.stringify({ cells }));
	});
}

function formatSyntaxResult(result: any, absolutePath: string, pythonPath: string, source: string): string {
	const errors = result.errors ?? [];
	const lines = [
		"Python syntax check " + (errors.length ? "failed" : "passed") + ": " + absolutePath,
		"Checked code cells: " + (result.checked ?? 0),
		"Parser: " + pythonPath + " (" + source + ")",
	];
	if (errors.length) {
		lines.push("", "Errors:");
		for (const error of errors) {
			lines.push("[" + error.index + "] line " + error.lineno + ", column " + error.offset + ": " + error.message);
			if (error.text) lines.push("  " + String(error.text).trimEnd());
		}
		lines.push("", "Note: this uses Python ast.parse; IPython magics and shell escapes may be reported as invalid Python syntax.");
	}
	return lines.join("\n");
}

export default function jupyterNotebooksExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "notebook_create",
		label: "Notebook Create",
		description: "Create a new local .ipynb notebook from a small built-in experiment, tutorial, or blank template.",
		promptSnippet: "Scaffold a clean local Jupyter .ipynb notebook without hand-authoring raw JSON.",
		promptGuidelines: [
			"Use notebook_create when the user asks to create a new notebook from scratch.",
			"Choose kind=experiment for exploratory or hypothesis-driven work, kind=tutorial for teaching/walkthroughs, and kind=blank for minimal notebooks.",
			"Templates are intentionally lightweight; adapt or remove sections that do not fit the user's task.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Output path for the new local .ipynb file" }),
			title: Type.String({ description: "Notebook title" }),
			kind: Type.Union([Type.Literal("experiment"), Type.Literal("tutorial"), Type.Literal("blank")], { description: "Notebook template kind" }),
			force: Type.Optional(Type.Boolean({ description: "Overwrite the output file if it already exists", default: false })),
		}),
		async execute(_id, params: any, _signal, _onUpdate, ctx: any) {
			try {
				const absolutePath = resolveLocalPath(ctx.cwd, params.path);
				if (existsSync(absolutePath) && params.force !== true) {
					throw new Error("Refusing to overwrite existing notebook without force=true: " + absolutePath);
				}
				mkdirSync(dirname(absolutePath), { recursive: true });
				const notebook = createNotebookTemplate(String(params.kind), String(params.title));
				writeNotebook(absolutePath, notebook);
				return makeToolResult(
					"Created " + params.kind + " notebook: " + absolutePath + " (" + notebook.cells.length + " cells).",
					{ path: absolutePath, kind: params.kind, title: params.title, cellCount: notebook.cells.length }
				);
			} catch (error: any) {
				return makeToolError("notebook_create failed: " + error.message, { error: error.message });
			}
		},
	});

	pi.registerTool({
		name: "notebook_overview",
		label: "Notebook Overview",
		description: "Show a compact cell map for a local .ipynb notebook.",
		promptSnippet: "Inspect local Jupyter .ipynb notebooks as structured cells.",
		promptGuidelines: [
			"Use notebook_overview before editing a notebook to pick the correct cell index or id.",
			"For simple search/count/bulk inspection, normal shell/Python/JSON tools are often enough.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the local .ipynb file" }),
			include_outputs: Type.Optional(Type.Boolean({ description: "Include one-line output summaries", default: false })),
			max_source_lines: Type.Optional(Type.Number({ description: "Source preview lines per cell", default: 2 })),
		}),
		async execute(_id, params: any, _signal, _onUpdate, ctx: any) {
			try {
				const { notebook, absolutePath } = readNotebook(ctx.cwd, params.path);
				const maxLines = Math.max(1, Math.min(8, Math.floor(params.max_source_lines ?? 2)));
				const lines = ["Notebook: " + absolutePath, "Cells: " + notebook.cells.length, ""];
				for (let i = 0; i < notebook.cells.length; i++) {
					const cell = notebook.cells[i];
					const source = sourceToText(cell.source);
					const out = cell.cell_type === "code" ? " outputs=" + outputCount(cell) : "";
					lines.push("[" + i + "] " + (cell.cell_type ?? "?") + " id=" + (cell.id ?? "(none)") + " hash=" + cellSourceHash(cell) + out + "  " + JSON.stringify(firstLines(source, maxLines)));
					if (params.include_outputs && cell.cell_type === "code" && outputCount(cell) > 0) {
						lines.push(formatOutputs(cell, 120));
					}
				}
				return makeToolResult(lines.join("\n"), { path: absolutePath, cellCount: notebook.cells.length });
			} catch (error: any) {
				return makeToolError("notebook_overview failed: " + error.message, { error: error.message });
			}
		},
	});

	pi.registerTool({
		name: "notebook_read_cell",
		label: "Notebook Read Cell",
		description: "Read one notebook cell source cleanly, optionally including saved outputs.",
		promptSnippet: "Read a local notebook cell by index or id without raw JSON noise.",
		promptGuidelines: ["Use notebook_read_cell before editing/replacing/deleting a notebook cell."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the local .ipynb file" }),
			cell: Type.Union([Type.Number(), Type.String()], { description: "Cell index or cell id" }),
			include_outputs: Type.Optional(Type.Boolean({ description: "Include saved outputs", default: false })),
			max_output_chars: Type.Optional(Type.Number({ description: "Maximum chars per output summary", default: 1000 })),
		}),
		async execute(_id, params: any, _signal, _onUpdate, ctx: any) {
			try {
				const { notebook, absolutePath } = readNotebook(ctx.cwd, params.path);
				const index = resolveCellIndex(notebook, params.cell);
				const cell = notebook.cells[index];
				const lines = [
					"Notebook: " + absolutePath,
					"Cell: [" + index + "] type=" + cell.cell_type + " id=" + (cell.id ?? "(none)") + " hash=" + cellSourceHash(cell),
					"",
					"Source:",
					sourceToText(cell.source) || "(empty)",
				];
				if (params.include_outputs) {
					lines.push("", "Outputs:", formatOutputs(cell, Math.max(100, Math.floor(params.max_output_chars ?? 1000))));
				}
				return makeToolResult(lines.join("\n"), { path: absolutePath, index, id: cell.id, hash: cellSourceHash(cell), cell });
			} catch (error: any) {
				return makeToolError("notebook_read_cell failed: " + error.message, { error: error.message });
			}
		},
	});

	pi.registerTool({
		name: "notebook_edit_cell",
		label: "Notebook Edit Cell",
		description: "Surgically replace visible source text inside one notebook cell.",
		promptSnippet: "Edit visible cell source in a local .ipynb without touching raw JSON encoding.",
		promptGuidelines: [
			"Use notebook_edit_cell for small exact replacements inside one cell; use notebook_replace_cell for full rewrites.",
			"Unless the user asks otherwise, avoid adding a trailing newline at the end of cell source.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the local .ipynb file" }),
			cell: Type.Union([Type.Number(), Type.String()], { description: "Cell index or cell id" }),
			old_text: Type.String({ description: "Exact visible source text to replace; must occur exactly once" }),
			new_text: Type.String({ description: "Replacement visible source text" }),
			expected_hash: Type.Optional(Type.String({ description: "Optional source hash from overview/read_cell to prevent stale edits" })),
		}),
		async execute(_id, params: any, _signal, _onUpdate, ctx: any) {
			try {
				const { notebook, absolutePath } = readNotebook(ctx.cwd, params.path);
				const index = resolveCellIndex(notebook, params.cell);
				const cell = notebook.cells[index];
				checkExpectedHash(cell, params.expected_hash);
				const source = sourceToText(cell.source);
				const oldText = String(params.old_text);
				if (oldText.length === 0) throw new Error("old_text must not be empty.");
				const first = source.indexOf(oldText);
				if (first < 0) throw new Error("old_text was not found in cell [" + index + "]. Read the cell again and match the visible source exactly.");
				if (source.indexOf(oldText, first + oldText.length) >= 0) throw new Error("old_text occurs more than once in cell [" + index + "]. Use a larger unique snippet or notebook_replace_cell.");
				const next = source.slice(0, first) + String(params.new_text) + source.slice(first + oldText.length);
				cell.source = textToSourceLike(next, cell.source);
				writeNotebook(absolutePath, notebook);
				return makeToolResult("Edited cell [" + index + "] in " + absolutePath + ". New hash: " + cellSourceHash(cell), { path: absolutePath, index, hash: cellSourceHash(cell) });
			} catch (error: any) {
				return makeToolError("notebook_edit_cell failed: " + error.message, { error: error.message });
			}
		},
	});

	pi.registerTool({
		name: "notebook_replace_cell",
		label: "Notebook Replace Cell",
		description: "Replace an entire notebook cell source, optionally changing its type.",
		promptSnippet: "Replace one local notebook cell source as structured notebook data.",
		promptGuidelines: [
			"Use notebook_replace_cell for full cell rewrites.",
			"Unless the user asks otherwise, avoid adding a trailing newline at the end of cell source.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the local .ipynb file" }),
			cell: Type.Union([Type.Number(), Type.String()], { description: "Cell index or cell id" }),
			source: Type.String({ description: "New full visible source for the cell" }),
			cell_type: Type.Optional(Type.Union([Type.Literal("code"), Type.Literal("markdown"), Type.Literal("raw")], { description: "Optional new cell type" })),
			expected_hash: Type.Optional(Type.String({ description: "Optional source hash from overview/read_cell to prevent stale edits" })),
		}),
		async execute(_id, params: any, _signal, _onUpdate, ctx: any) {
			try {
				const { notebook, absolutePath } = readNotebook(ctx.cwd, params.path);
				const index = resolveCellIndex(notebook, params.cell);
				const cell = notebook.cells[index];
				checkExpectedHash(cell, params.expected_hash);
				if (params.cell_type) normalizeCellType(cell, params.cell_type);
				cell.source = textToSourceLike(String(params.source), cell.source);
				writeNotebook(absolutePath, notebook);
				return makeToolResult("Replaced cell [" + index + "] in " + absolutePath + ". New hash: " + cellSourceHash(cell), { path: absolutePath, index, hash: cellSourceHash(cell) });
			} catch (error: any) {
				return makeToolError("notebook_replace_cell failed: " + error.message, { error: error.message });
			}
		},
	});

	pi.registerTool({
		name: "notebook_insert_cell",
		label: "Notebook Insert Cell",
		description: "Insert a new code/markdown/raw cell into a local .ipynb notebook.",
		promptSnippet: "Insert a structured notebook cell in a local .ipynb file.",
		promptGuidelines: ["Unless the user asks otherwise, avoid adding a trailing newline at the end of cell source."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the local .ipynb file" }),
			index: Type.Optional(Type.Number({ description: "Insertion index" })),
			before: Type.Optional(Type.Union([Type.Number(), Type.String()], { description: "Insert before this cell index/id" })),
			after: Type.Optional(Type.Union([Type.Number(), Type.String()], { description: "Insert after this cell index/id" })),
			cell_type: Type.Union([Type.Literal("code"), Type.Literal("markdown"), Type.Literal("raw")], { description: "New cell type" }),
			source: Type.String({ description: "Visible source for the new cell" }),
			metadata: Type.Optional(Type.Any({ description: "Optional cell metadata object" })),
		}),
		async execute(_id, params: any, _signal, _onUpdate, ctx: any) {
			try {
				const { notebook, absolutePath } = readNotebook(ctx.cwd, params.path);
				const modes = [params.index !== undefined, params.before !== undefined, params.after !== undefined].filter(Boolean).length;
				if (modes !== 1) throw new Error("Specify exactly one of index, before, or after.");
				let index: number;
				if (params.index !== undefined) {
					index = Math.floor(params.index);
					if (index < 0 || index > notebook.cells.length) throw new Error("Insertion index " + index + " is out of range 0.." + notebook.cells.length + ".");
				} else if (params.before !== undefined) {
					index = resolveCellIndex(notebook, params.before, "before");
				} else {
					index = resolveCellIndex(notebook, params.after, "after") + 1;
				}
				const cell = createCell(params.cell_type, String(params.source), params.metadata ?? {});
				notebook.cells.splice(index, 0, cell);
				writeNotebook(absolutePath, notebook);
				return makeToolResult("Inserted " + params.cell_type + " cell at [" + index + "] in " + absolutePath + ". id=" + cell.id + " hash=" + cellSourceHash(cell), { path: absolutePath, index, id: cell.id, hash: cellSourceHash(cell) });
			} catch (error: any) {
				return makeToolError("notebook_insert_cell failed: " + error.message, { error: error.message });
			}
		},
	});

	pi.registerTool({
		name: "notebook_delete_cells",
		label: "Notebook Delete Cells",
		description: "Delete one or more notebook cells safely by index or id.",
		promptSnippet: "Delete structured cells from a local .ipynb notebook.",
		promptGuidelines: ["Read or overview cells before deleting them. Deletes are sorted descending so indexes do not shift mid-delete."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the local .ipynb file" }),
			cells: Type.Array(Type.Union([Type.Number(), Type.String()]), { description: "Cell indexes or ids to delete" }),
			expected_hashes: Type.Optional(Type.Any({ description: "Optional object mapping each provided cell ref to its expected hash" })),
		}),
		async execute(_id, params: any, _signal, _onUpdate, ctx: any) {
			try {
				const { notebook, absolutePath } = readNotebook(ctx.cwd, params.path);
				if (!Array.isArray(params.cells) || params.cells.length === 0) throw new Error("cells must be a non-empty array.");
				const expected = parseExpectedHashes(params.expected_hashes);
				const resolved = params.cells.map((cellRef: CellRef, pos: number) => {
					const index = resolveCellIndex(notebook, cellRef, "cells[" + pos + "]");
					const cell = notebook.cells[index];
					const expectedHash = expected.get(String(cellRef)) ?? expected.get(String(pos));
					checkExpectedHash(cell, expectedHash);
					return { index, id: cell.id, type: cell.cell_type, hash: cellSourceHash(cell) };
				});
				const unique = new Map<number, any>();
				for (const item of resolved) {
					if (unique.has(item.index)) throw new Error("Duplicate delete target resolved to cell index " + item.index + ".");
					unique.set(item.index, item);
				}
				const sorted = [...unique.values()].sort((a, b) => b.index - a.index);
				for (const item of sorted) notebook.cells.splice(item.index, 1);
				writeNotebook(absolutePath, notebook);
				return makeToolResult("Deleted " + sorted.length + " cell(s) from " + absolutePath + ": " + sorted.map((x) => "[" + x.index + "]").join(", "), { path: absolutePath, deleted: sorted });
			} catch (error: any) {
				return makeToolError("notebook_delete_cells failed: " + error.message, { error: error.message });
			}
		},
	});

	pi.registerTool({
		name: "notebook_clear_outputs",
		label: "Notebook Clear Outputs",
		description: "Clear saved outputs and optionally execution counts for all or selected code cells.",
		promptSnippet: "Clear saved outputs from local .ipynb code cells.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the local .ipynb file" }),
			cells: Type.Optional(Type.Union([Type.Literal("all"), Type.Array(Type.Union([Type.Number(), Type.String()]))], { description: "all or list of cell indexes/ids", default: "all" })),
			clear_execution_count: Type.Optional(Type.Boolean({ description: "Also set execution_count to null", default: true })),
		}),
		async execute(_id, params: any, _signal, _onUpdate, ctx: any) {
			try {
				const { notebook, absolutePath } = readNotebook(ctx.cwd, params.path);
				const indexes = cellsToIndexes(notebook, params.cells ?? "all");
				let changed = 0;
				for (const index of indexes) {
					const cell = notebook.cells[index];
					if (cell.cell_type !== "code") continue;
					cell.outputs = [];
					if (params.clear_execution_count !== false) cell.execution_count = null;
					changed++;
				}
				writeNotebook(absolutePath, notebook);
				return makeToolResult("Cleared outputs for " + changed + " code cell(s) in " + absolutePath + ".", { path: absolutePath, changed, indexes });
			} catch (error: any) {
				return makeToolError("notebook_clear_outputs failed: " + error.message, { error: error.message });
			}
		},
	});

	pi.registerTool({
		name: "notebook_check_syntax",
		label: "Notebook Check Syntax",
		description: "Parse selected code cells with Python ast.parse and report syntax errors without executing code.",
		promptSnippet: "Check Python syntax in local .ipynb code cells without executing them.",
		promptGuidelines: [
			"Use notebook_check_syntax after editing Python code cells when a syntax check is useful.",
			"This is for Python syntax only; IPython magics and shell escapes may be reported as invalid Python syntax.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the local .ipynb file" }),
			cells: Type.Optional(Type.Union([Type.Literal("all"), Type.Array(Type.Union([Type.Number(), Type.String()])), Type.Object({ start: Type.Number(), end: Type.Number() })], { description: "Cells to check: all, list of indexes/ids, or inclusive {start,end}", default: "all" })),
			python_path: Type.Optional(Type.String({ description: "Python interpreter whose parser to use, e.g. .venv/bin/python" })),
			cwd: Type.Optional(Type.String({ description: "Working directory for resolving python_path; defaults to notebook directory" })),
			timeout_ms: Type.Optional(Type.Number({ description: "Syntax check process timeout in milliseconds", default: 10000 })),
		}),
		async execute(_id, params: any, _signal, _onUpdate, ctx: any) {
			try {
				const { notebook, absolutePath } = readNotebook(ctx.cwd, params.path);
				const indexes = cellsToIndexes(notebook, params.cells ?? "all");
				const selectedCells = indexes
					.filter((index) => notebook.cells[index]?.cell_type === "code")
					.map((index) => ({ index, source: sourceToText(notebook.cells[index].source) }));
				const options = resolveSyntaxPython(ctx.cwd, absolutePath, params);
				const result = await runSyntaxCheck(
					options.pythonPath,
					options.cwd,
					selectedCells,
					Math.max(1000, Math.floor(params.timeout_ms ?? 10000))
				);
				const text = formatSyntaxResult(result, absolutePath, options.pythonPath, options.source);
				const details = { path: absolutePath, pythonPath: options.pythonPath, cwd: options.cwd, checkedIndexes: selectedCells.map((cell) => cell.index), ...result };
				return (result.errors?.length ?? 0) > 0 ? makeToolError(text, details) : makeToolResult(text, details);
			} catch (error: any) {
				return makeToolError("notebook_check_syntax failed: " + error.message, { error: error.message });
			}
		},
	});

	pi.registerTool({
		name: "notebook_execute_cells",
		label: "Notebook Execute Cells",
		description: "Execute selected cells in a local notebook using a Pi-owned persistent kernel and save/retrieve outputs.",
		promptSnippet: "Execute local .ipynb cells with a Pi-owned persistent Python kernel, separate from VS Code's live kernel.",
		promptGuidelines: [
			"Execution uses a Pi-owned persistent kernel, not the VS Code live kernel.",
			"Pass python_path (for example .venv/bin/python) when the environment matters.",
			"Use notebook_restart_kernel to reset variables/imports in Pi's persistent kernel.",
			"When done executing cells, shut down the Pi-owned kernel with notebook_restart_kernel(shutdown_only=true) unless you expect to continue soon.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the local .ipynb file" }),
			cells: Type.Optional(Type.Union([Type.Literal("all"), Type.Array(Type.Union([Type.Number(), Type.String()])), Type.Object({ start: Type.Number(), end: Type.Number() })], { description: "Cells to execute: all, list of indexes/ids, or inclusive {start,end}", default: "all" })),
			python_path: Type.Optional(Type.String({ description: "Python interpreter to use for the kernel, e.g. .venv/bin/python" })),
			kernel_name: Type.Optional(Type.String({ description: "Existing Jupyter kernelspec name to use instead of python_path" })),
			cwd: Type.Optional(Type.String({ description: "Working directory for execution; defaults to notebook directory" })),
			timeout: Type.Optional(Type.Number({ description: "Timeout per cell in seconds", default: 60 })),
			save_outputs: Type.Optional(Type.Boolean({ description: "Save outputs back into the .ipynb file", default: true })),
			return_outputs: Type.Optional(Type.Boolean({ description: "Return concise output summaries", default: true })),
			stop_on_error: Type.Optional(Type.Boolean({ description: "Stop executing further selected cells after an error", default: true })),
			max_output_chars: Type.Optional(Type.Number({ description: "Maximum chars per output summary", default: 1000 })),
		}),
		async execute(_id, params: any, _signal, _onUpdate, ctx: any) {
			try {
				const { notebook, absolutePath } = readNotebook(ctx.cwd, params.path);
				const indexes = cellsToIndexes(notebook, params.cells ?? "all");
				const options = resolveExecutionOptions(ctx.cwd, absolutePath, params);
				const key = kernelKey(absolutePath, options);
				const timeout = Math.max(1, Math.floor(params.timeout ?? 60));
				const result = await sendKernelCommand(key, {
					op: "execute",
					path: absolutePath,
					cell_indexes: indexes,
					cwd: options.cwd,
					python_path: options.pythonPath,
					kernel_name: options.kernelName,
					timeout,
					save_outputs: params.save_outputs !== false,
					return_outputs: params.return_outputs !== false,
					stop_on_error: params.stop_on_error !== false,
					max_output_chars: Math.max(100, Math.floor(params.max_output_chars ?? 1000)),
				}, (timeout * Math.max(1, indexes.length) + 120) * 1000);
				const summary = [
					"Notebook execution " + (result.error_count ? "finished with errors" : "succeeded") + ": " + absolutePath,
					"Kernel: " + (options.pythonPath ? "python_path=" + options.pythonPath : "kernel_name=" + options.kernelName) + " (" + options.source + ")",
					"CWD: " + options.cwd,
					"Persistent kernel: " + (result.kernel_reused ? "reused" : "started"),
					"Executed cells: " + (result.executed_indexes ?? []).join(", "),
					"Saved outputs: " + String(params.save_outputs !== false),
					"",
					summarizeCellExecution(result) || "No code cells were executed.",
				].join("\n");
				return result.error_count ? makeToolError(summary, result) : makeToolResult(summary, result);
			} catch (error: any) {
				return makeToolError("notebook_execute_cells failed: " + error.message, { error: error.message });
			}
		},
	});

	pi.registerTool({
		name: "notebook_restart_kernel",
		label: "Notebook Restart Kernel",
		description: "Restart or stop the Pi-owned persistent kernel for a notebook/interpreter/cwd.",
		promptSnippet: "Reset the Pi-owned persistent notebook kernel state for a local .ipynb.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the local .ipynb file" }),
			python_path: Type.Optional(Type.String({ description: "Python interpreter used for the kernel" })),
			kernel_name: Type.Optional(Type.String({ description: "Existing Jupyter kernelspec name used for the kernel" })),
			cwd: Type.Optional(Type.String({ description: "Working directory; must match the execution cwd to target the same kernel" })),
			shutdown_only: Type.Optional(Type.Boolean({ description: "Shut down and forget the kernel instead of restarting it", default: false })),
		}),
		async execute(_id, params: any, _signal, _onUpdate, ctx: any) {
			try {
				const { absolutePath } = readNotebook(ctx.cwd, params.path);
				const options = resolveExecutionOptions(ctx.cwd, absolutePath, params);
				const key = kernelKey(absolutePath, options);
				const entry = kernels.get(key);
				if (!entry) {
					return makeToolResult("No existing Pi-owned kernel for " + absolutePath + " with the requested interpreter/cwd. Nothing to restart.", { path: absolutePath, existed: false });
				}
				if (params.shutdown_only) {
					entry.process.stdin.write(JSON.stringify({ id: randomUUID(), op: "shutdown" }) + "\n");
					entry.process.kill();
					kernels.delete(key);
					return makeToolResult("Shut down Pi-owned kernel for " + absolutePath + ".", { path: absolutePath, shutdown: true });
				}
				const result = await sendKernelCommand(key, { op: "restart" }, 60_000);
				return makeToolResult("Restarted Pi-owned kernel for " + absolutePath + ".", { path: absolutePath, ...result });
			} catch (error: any) {
				return makeToolError("notebook_restart_kernel failed: " + error.message, { error: error.message });
			}
		},
	});

	pi.on("session_shutdown", () => {
		for (const entry of kernels.values()) {
			try {
				entry.process.stdin.write(JSON.stringify({ id: randomUUID(), op: "shutdown" }) + "\n");
				entry.process.kill();
			} catch {
				// ignore
			}
		}
		kernels.clear();
	});
}
