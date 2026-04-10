import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

interface PlanContext {
	idea: string;
	goal: string;
}

interface PlanTask {
	index: number;
	status: " " | "/" | "x";
	text: string;
	lineNumber: number;
}

interface ExecuteReviewContext {
	feedback?: string;
}

interface ExecuteContext {
	mode: "all" | "selected";
	tasks: PlanTask[];
	selectionText: string;
}

const PLAN_PROMPT_APPEND = [
	"[PLAN WORKFLOW RULES]",
	"- You are creating an implementation plan, not an exploration checklist.",
	"- Do discovery yourself first (repo scan + web research if needed), then output implementation tasks only.",
	"- Do NOT include tasks like 'explore the repo' or 'research basics' in the final task board.",
	"- Prefer larger tasks over tiny fragments.",
	"- During /plan, focus on planning only: do not implement features yet.",
	"- Do not modify source files during /plan except PLAN.md updates needed for the plan.",
	"- Non-mutating discovery is encouraged during /plan (including web search and curl when useful).",
	"- Write or update PLAN.md in the repo root.",
	"- PLAN.md must include:",
	"  1) short summary at top",
	"  2) task board with [ ], [/], [x]",
	"  3) detailed sections per task",
	"- [x] means done only after lint + relevant tests pass.",
	"- After updating PLAN.md, do NOT dump the plan in chat.",
	"- Start the visible reply with an absolutely brief summary only.",
	"- Keep the summary to 1-2 short sentences max.",
	"- The most important part of the visible reply is your opinions.",
	"- Include: your opinion on the plan, what feels harder than necessary, suggested simplifications or improvements, and anything unexpected.",
	"- Keep the visible reply discussion-oriented and concise.",
	"- Keep actions visible through normal tool calls in this foreground session.",
].join("\n");

const EXECUTE_REVIEW_PROMPT_APPEND = [
	"[EXECUTE REVIEW RULES]",
	"- This turn exists to adapt PLAN.md for execution readiness.",
	"- Review the recent discussion since planning and update PLAN.md if needed.",
	"- Do NOT implement any task yet.",
	"- Do NOT modify source files other than PLAN.md.",
	"- Keep the plan simple, minimal, and aligned with the discussed goal.",
	"- In the visible chat reply, do NOT dump the plan.",
	"- Reply with only a short execution-readiness note and any final caveats.",
	"- Keep actions visible through normal tool calls in this foreground session.",
].join("\n");

const EXECUTE_PROMPT_APPEND = [
	"[EXECUTION WORKFLOW RULES]",
	"- Follow the selected PLAN.md scope exactly.",
	"- Do not silently execute extra tasks outside the selected scope.",
	"- If a selected task is blocked by an unfinished unselected task, stop, explain the blocker, and record it in PLAN.md.",
	"- For each task you execute:",
	"  1) mark [/] when starting,",
	"  2) implement,",
	"  3) run lint + relevant tests,",
	"  4) mark [x] only if verification passes.",
	"- If blocked or verification fails, keep [/] and add a brief blocker note under that task section in PLAN.md.",
	"- Keep actions visible through normal foreground tool calls.",
].join("\n");

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function detectRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
	const result = await pi.exec("git", ["rev-parse", "--show-toplevel"]);
	if (result.code === 0) {
		const root = result.stdout.trim();
		if (root.length > 0) return root;
	}
	return cwd;
}

function parsePlanTasks(planMarkdown: string): PlanTask[] {
	const lines = planMarkdown.split("\n");
	const tasks: PlanTask[] = [];
	let i = 0;

	for (let lineNo = 0; lineNo < lines.length; lineNo++) {
		const line = lines[lineNo] ?? "";
		const m = line.match(/^\s*[-*]\s+\[( |\/|x|X)\]\s+(.+)$/);
		if (!m) continue;
		i += 1;
		tasks.push({
			index: i,
			status: (m[1] === "X" ? "x" : m[1]) as " " | "/" | "x",
			text: m[2].trim(),
			lineNumber: lineNo + 1,
		});
	}

	return tasks;
}

function formatTaskRefs(tasks: PlanTask[]): string {
	return tasks.map((task) => "#" + String(task.index)).join(", ");
}

function parseStepSelection(raw: string, tasks: PlanTask[]): ExecuteContext {
	const pending = tasks.filter((task) => task.status !== "x");
	if (pending.length === 0) {
		throw new Error("All PLAN.md steps are already completed.");
	}

	const trimmed = raw.trim();
	if (!trimmed) {
		return {
			mode: "all",
			tasks: pending,
			selectionText: "all pending steps (" + formatTaskRefs(pending) + ")",
		};
	}

	const byIndex = new Map(tasks.map((task) => [task.index, task]));
	const selected = new Map<number, PlanTask>();
	const tokens = trimmed.replace(/,/g, " ").split(/\s+/).filter(Boolean);

	for (const token of tokens) {
		if (/^\d+$/.test(token)) {
			const index = Number(token);
			const task = byIndex.get(index);
			if (!task) throw new Error("Unknown step '" + token + "'.");
			selected.set(task.index, task);
			continue;
		}

		const rangeMatch = token.match(/^(\d+)-(\d+)$/);
		if (rangeMatch) {
			const start = Number(rangeMatch[1]);
			const end = Number(rangeMatch[2]);
			if (end < start) throw new Error("Invalid range '" + token + "'.");
			for (let index = start; index <= end; index++) {
				const task = byIndex.get(index);
				if (!task) throw new Error("Unknown step '" + String(index) + "' in range '" + token + "'.");
				selected.set(task.index, task);
			}
			continue;
		}

		throw new Error("Could not parse step selector '" + token + "'. Use numbers like 1 2 4-6.");
	}

	const ordered = [...selected.values()].sort((a, b) => a.index - b.index);
	if (ordered.length === 0) {
		throw new Error("No steps selected.");
	}

	const completed = ordered.filter((task) => task.status === "x");
	if (completed.length > 0) {
		throw new Error("Step already completed: " + formatTaskRefs(completed) + ".");
	}

	return {
		mode: ordered.length === pending.length ? "all" : "selected",
		tasks: ordered,
		selectionText: "selected steps (" + formatTaskRefs(ordered) + ")",
	};
}

type ExecuteReviewAction = "confirm" | "revise" | "cancel";

async function showExecuteReviewOverlay(
	ctx: Pick<ExtensionContext, "ui">,
	planText: string,
): Promise<ExecuteReviewAction> {
	return ctx.ui.custom<ExecuteReviewAction>(
		(_tui, theme, _kb, done) => {
			const lines = planText.split("\n");
			let scroll = 0;
			let cachedWidth: number | undefined;
			let cachedLines: string[] | undefined;

			const invalidate = () => {
				cachedWidth = undefined;
				cachedLines = undefined;
			};

			const render = (width: number): string[] => {
				if (cachedLines && cachedWidth === width) return cachedLines;

				const contentHeight = 20;
				const maxScroll = Math.max(0, lines.length - contentHeight);
				scroll = Math.max(0, Math.min(scroll, maxScroll));

				const out: string[] = [];
				const push = (line = "") => out.push(truncateToWidth(line, width));
				const innerW = Math.max(1, width - 2);
				const boxLine = (inner: string, borderStyle: "normal" | "accent" = "normal") => {
					const truncated = truncateToWidth(inner, innerW);
					const pad = " ".repeat(Math.max(0, innerW - visibleWidth(truncated)));
					const borderColor = borderStyle === "accent" ? "borderAccent" : "border";
					return theme.fg(borderColor, "│") + truncated + pad + theme.fg(borderColor, "│");
				};
				const top = "╭" + "─".repeat(innerW) + "╮";
				const divider = "├" + "─".repeat(innerW) + "┤";
				const bottom = "╰" + "─".repeat(innerW) + "╯";

				const confirmLabel = theme.bg("selectedBg", theme.fg("text", " Confirm "));
				const reviseLabel = theme.fg("accent", " Request changes ");
				const cancelLabel = theme.fg("warning", " Cancel ");

				push(theme.fg("borderAccent", top));
				push(boxLine(" " + theme.bold("Execution Review") + " " + theme.fg("muted", "(PLAN.md preview)"), "accent"));
				push(boxLine(" " + theme.fg("dim", "Ctrl+K up • Ctrl+J down • Enter confirm • Ctrl+R changes • Esc cancel")));
				push(theme.fg("border", divider));

				for (let i = 0; i < contentHeight; i++) {
					const line = lines[scroll + i] ?? "";
					push(boxLine(" " + line));
				}

				push(theme.fg("border", divider));
				push(boxLine(" " + confirmLabel + "  " + reviseLabel + "  " + cancelLabel));
				push(theme.fg("borderAccent", bottom));

				cachedWidth = width;
				cachedLines = out;
				return out;
			};

			const handleInput = (data: string) => {
				if (matchesKey(data, Key.escape)) {
					done("cancel");
					return;
				}
				if (matchesKey(data, Key.enter)) {
					done("confirm");
					return;
				}
				if (matchesKey(data, Key.ctrl("r"))) {
					done("revise");
					return;
				}
				if (matchesKey(data, Key.ctrl("k"))) {
					scroll = Math.max(0, scroll - 1);
					invalidate();
					return;
				}
				if (matchesKey(data, Key.ctrl("j"))) {
					scroll += 1;
					invalidate();
				}
			};

			return { render, handleInput, invalidate };
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "84%",
				minWidth: 60,
				maxHeight: "90%",
				margin: 1,
			},
		},
	);
}

export default function planWorkflow(pi: ExtensionAPI) {
	let pendingPlan: PlanContext | null = null;
	let lastPlanContext: PlanContext | null = null;
	let pendingExecuteReview: ExecuteReviewContext | null = null;
	let pendingExecute: ExecuteContext | null = null;
	let activeMode: "plan" | "execute-review" | "execute-run" | null = null;

	pi.registerCommand("plan", {
		description: "Plan a feature/change in the foreground and create/update PLAN.md",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/plan requires interactive UI mode", "error");
				return;
			}

			let idea = args.trim();
			if (!idea) {
				const value = await ctx.ui.editor("Plan idea", "");
				if (!value || !value.trim()) {
					ctx.ui.notify("/plan cancelled", "info");
					return;
				}
				idea = value.trim();
			}

			const goal = await ctx.ui.editor("Final goal", "");
			if (!goal || !goal.trim()) {
				ctx.ui.notify("/plan cancelled (missing final goal)", "info");
				return;
			}

			pendingPlan = { idea, goal: goal.trim() };

			const kickoff = [
				"Create or update PLAN.md for this request.",
				"",
				"Idea: " + idea,
				"Final goal: " + goal.trim(),
				"",
				"First do needed discovery (repo + web if useful), then produce implementation tasks only.",
				"Do not include exploration tasks in the final checklist.",
				"After the plan is done, do not print it in chat. Give only a very brief summary plus your opinions for discussion.",
			].join("\n");

			if (ctx.isIdle()) {
				pi.sendUserMessage(kickoff);
			} else {
				pi.sendUserMessage(kickoff, { deliverAs: "followUp" });
			}

			ctx.ui.notify("Planning turn queued (foreground mode).", "info");
		},
	});

	pi.registerCommand("execute", {
		description: "Adapt PLAN.md, review it, then confirm which steps to execute",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/execute requires interactive UI mode", "error");
				return;
			}

			const repoRoot = await detectRepoRoot(pi, ctx.cwd);
			const planPath = join(repoRoot, "PLAN.md");
			if (!(await exists(planPath))) {
				ctx.ui.notify("PLAN.md not found at " + planPath + ".", "error");
				return;
			}

			const plan = await readFile(planPath, "utf8");
			const tasks = parsePlanTasks(plan);
			if (tasks.length === 0) {
				ctx.ui.notify("No checklist tasks found in PLAN.md.", "error");
				return;
			}

			const pending = tasks.filter((task) => task.status !== "x");
			if (pending.length === 0) {
				ctx.ui.notify("All PLAN.md tasks are already completed.", "info");
				return;
			}

			pendingExecuteReview = {};
			const kickoff = [
				"Review PLAN.md and adapt it for execution readiness.",
				"Use the discussion so far, especially anything we changed after planning.",
				"Do not implement anything yet.",
				"Keep the plan simple, minimal, and aligned with the goal.",
				lastPlanContext ? "" : undefined,
				lastPlanContext ? "Original idea: " + lastPlanContext.idea : undefined,
				lastPlanContext ? "Final goal: " + lastPlanContext.goal : undefined,
			].filter(Boolean).join("\n");

			if (ctx.isIdle()) {
				pi.sendUserMessage(kickoff);
			} else {
				pi.sendUserMessage(kickoff, { deliverAs: "followUp" });
			}

			ctx.ui.notify("Execution review turn queued.", "info");
		},
	});

	pi.on("before_agent_start", async (event) => {
		if (pendingPlan) {
			const context = pendingPlan;
			pendingPlan = null;
			lastPlanContext = context;
			activeMode = "plan";
			return {
				systemPrompt: event.systemPrompt + "\n\n" + PLAN_PROMPT_APPEND,
				message: {
					customType: "plan-context",
					content: "Plan context\n- Idea: " + context.idea + "\n- Final goal: " + context.goal,
					display: false,
				},
			};
		}

		if (pendingExecuteReview) {
			const context = pendingExecuteReview;
			pendingExecuteReview = null;
			activeMode = "execute-review";
			return {
				systemPrompt: event.systemPrompt + "\n\n" + EXECUTE_REVIEW_PROMPT_APPEND,
				message: {
					customType: "execute-review-context",
					content: context.feedback
						? "Execution review context\n- Feedback to apply: " + context.feedback
						: "Execution review context\n- Review PLAN.md and adapt it for execution readiness.",
					display: false,
				},
			};
		}

		if (pendingExecute) {
			const context = pendingExecute;
			pendingExecute = null;
			activeMode = "execute-run";
			return {
				systemPrompt: event.systemPrompt + "\n\n" + EXECUTE_PROMPT_APPEND,
				message: {
					customType: "execute-context",
					content:
						"Execution context\n- Scope: " +
						context.selectionText +
						"\n- Tasks: " +
						context.tasks.map((task) => "#" + String(task.index) + " (line " + String(task.lineNumber) + ") " + task.text).join("\n"),
					display: false,
				},
			};
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		const mode = activeMode;
		activeMode = null;

		if (mode === "plan" && ctx.hasUI) {
			const repoRoot = await detectRepoRoot(pi, ctx.cwd);
			const planPath = join(repoRoot, "PLAN.md");
			if (!(await exists(planPath))) {
				ctx.ui.notify("Planning finished, but PLAN.md was not found at " + planPath + ".", "warning");
				return;
			}
			ctx.ui.notify("Plan saved to PLAN.md. Discuss the notes in chat, then use /execute when ready.", "info");
			return;
		}

		if (mode !== "execute-review" || !ctx.hasUI) return;

		const repoRoot = await detectRepoRoot(pi, ctx.cwd);
		const planPath = join(repoRoot, "PLAN.md");
		if (!(await exists(planPath))) {
			ctx.ui.notify("Execution review skipped: PLAN.md not found at " + planPath + ".", "warning");
			return;
		}

		const planText = await readFile(planPath, "utf8");
		let action: ExecuteReviewAction = "cancel";
		try {
			action = await showExecuteReviewOverlay(ctx, planText);
		} catch {
			const fallback = await ctx.ui.select("Execution review", ["Confirm", "Request changes", "Cancel"]);
			action = fallback === "Confirm" ? "confirm" : fallback === "Request changes" ? "revise" : "cancel";
		}

		if (action === "cancel") {
			ctx.ui.notify("/execute cancelled", "info");
			return;
		}

		if (action === "revise") {
			const note = await ctx.ui.editor("Requested changes to PLAN.md", "");
			if (!note || !note.trim()) {
				ctx.ui.notify("/execute cancelled", "info");
				return;
			}

			pendingExecuteReview = { feedback: note.trim() };
			const revisePrompt = [
				"Please revise PLAN.md based on this feedback:",
				note.trim(),
				"Do not implement yet. Keep the plan minimal and execution-ready.",
			].join("\n\n");

			if (ctx.isIdle()) {
				pi.sendUserMessage(revisePrompt);
			} else {
				pi.sendUserMessage(revisePrompt, { deliverAs: "followUp" });
			}

			ctx.ui.notify("Requested PLAN.md changes queued.", "info");
			return;
		}

		let selection: ExecuteContext | null = null;
		while (!selection) {
			const raw = await ctx.ui.input(
				"Steps to execute (leave empty for all pending steps)",
				"e.g. 1 2 4-6",
			);
			if (raw === undefined) {
				ctx.ui.notify("/execute cancelled", "info");
				return;
			}

			try {
				selection = parseStepSelection(raw, parsePlanTasks(planText));
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : "Invalid step selection.", "error");
			}
		}

		pendingExecute = selection;
		const kickoff = [
			"Execute the selected PLAN.md tasks.",
			"Scope: " + selection.selectionText,
			"For each selected task: mark [/] at start, implement, run lint/tests, mark [x] only if verification passes.",
			"If blocked by unfinished unselected work, stop and record the blocker in PLAN.md instead of silently expanding scope.",
			"Selected tasks:",
			...selection.tasks.map((task) => "- #" + String(task.index) + " (line " + String(task.lineNumber) + "): " + task.text),
		].join("\n");

		if (ctx.isIdle()) {
			pi.sendUserMessage(kickoff);
		} else {
			pi.sendUserMessage(kickoff, { deliverAs: "followUp" });
		}

		ctx.ui.notify("Execution turn queued for " + selection.selectionText + ".", "info");
	});
}
