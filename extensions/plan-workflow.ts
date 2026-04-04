import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
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

interface ExecuteContext {
	mode: "all" | "single";
	task?: PlanTask;
	tasks?: PlanTask[];
}

const PLAN_PROMPT_APPEND = `
[PLAN WORKFLOW RULES]
- You are creating an implementation plan, not an exploration checklist.
- Do discovery yourself first (repo scan + web research if needed), then output implementation tasks only.
- Do NOT include tasks like "explore the repo" or "research basics" in the final task board.
- Prefer larger tasks over tiny fragments.
- During /plan, focus on planning only: do not implement features yet.
- Do not modify source files during /plan except PLAN.md updates needed for the plan.
- Do not run mutating setup commands during /plan unless user explicitly asks for that in this turn.
- Write or update PLAN.md in the repo root.
- PLAN.md must include:
  1) short summary at top
  2) task board with [ ], [/], [x]
  3) detailed sections per task
- [x] means done only after lint + relevant tests pass.
- Keep actions visible through normal tool calls in this foreground session.
`;

const EXECUTE_PROMPT_APPEND = `
[EXECUTION WORKFLOW RULES]
- Follow the scope requested in the kickoff message (all remaining tasks, or one selected task).
- For each task you execute:
  1) mark [/] when starting,
  2) implement,
  3) run lint + relevant tests,
  4) mark [x] only if verification passes.
- If blocked or verification fails, keep [/] and add a brief blocker note under that task section in PLAN.md.
- Keep actions visible through normal foreground tool calls.
`;

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

function resolveTask(arg: string, pending: PlanTask[]): PlanTask | undefined {
	const trimmed = arg.trim();
	if (!trimmed) return undefined;

	const asNumber = Number(trimmed);
	if (!Number.isNaN(asNumber)) {
		return pending.find((t) => t.index === asNumber);
	}

	const q = trimmed.toLowerCase();
	return pending.find((t) => t.text.toLowerCase().includes(q));
}

type PlanReviewAction = "close" | "revise" | "cancel";

async function showPlanReviewOverlay(ctx: any, planText: string): Promise<PlanReviewAction> {
	return ctx.ui.custom<PlanReviewAction>(
		(_tui, theme, _kb, done) => {
			const lines = planText.split("\n");
			let scroll = 0;
			let focus: "content" | "actions" = "content";
			let actionIndex = 0; // 0 close, 1 revise
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
				const top = `╭${"─".repeat(Math.max(1, width - 2))}╮`;
				const divider = `├${"─".repeat(Math.max(1, width - 2))}┤`;
				const bottom = `╰${"─".repeat(Math.max(1, width - 2))}╯`;

				push(theme.fg("borderAccent", top));
				push(
					theme.fg(
						"borderAccent",
						`│${truncateToWidth(
							` ${theme.bold("Plan Review")} ${theme.fg("muted", "(foreground session)")}`,
							Math.max(1, width - 2),
						)}│`,
					),
				);
				push(
					theme.fg(
						"border",
						`│${truncateToWidth(
							` ${theme.fg("dim", "↑↓ scroll • Tab switch focus • Enter action • Esc cancel")}`,
							Math.max(1, width - 2),
						)}│`,
					),
				);
				push(theme.fg("border", divider));

				for (let i = 0; i < contentHeight; i++) {
					const line = lines[scroll + i] ?? "";
					const prefix = focus === "content" && i === 0 ? theme.fg("accent", "▌") : " ";
					const body = truncateToWidth(`${prefix}${line}`, Math.max(1, width - 2));
					push(theme.fg("border", `│`) + body + theme.fg("border", `│`));
				}

				push(theme.fg("border", divider));

				const closeLabel = actionIndex === 0 && focus === "actions"
					? theme.bg("selectedBg", theme.fg("text", " Close "))
					: theme.fg("success", " Close ");
				const reviseLabel = actionIndex === 1 && focus === "actions"
					? theme.bg("selectedBg", theme.fg("text", " Request changes "))
					: theme.fg("accent", " Request changes ");

				const actions = `${closeLabel}  ${reviseLabel}`;
				push(theme.fg("border", `│`) + truncateToWidth(` ${actions}`, Math.max(1, width - 2)) + theme.fg("border", `│`));
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
				if (matchesKey(data, Key.tab)) {
					focus = focus === "content" ? "actions" : "content";
					invalidate();
					return;
				}
				if (matchesKey(data, Key.up) || data === "k") {
					scroll = Math.max(0, scroll - 1);
					invalidate();
					return;
				}
				if (matchesKey(data, Key.down) || data === "j") {
					scroll += 1;
					invalidate();
					return;
				}
				if (focus === "actions") {
					if (matchesKey(data, Key.left)) {
						actionIndex = Math.max(0, actionIndex - 1);
						invalidate();
						return;
					}
					if (matchesKey(data, Key.right)) {
						actionIndex = Math.min(1, actionIndex + 1);
						invalidate();
						return;
					}
					if (matchesKey(data, Key.enter)) {
						done(actionIndex === 0 ? "close" : "revise");
					}
				}
			};

			return { render, handleInput, invalidate };
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "84%",
				minWidth: 80,
				maxHeight: "90%",
				margin: 1,
			},
		},
	);
}

export default function planWorkflow(pi: ExtensionAPI) {
	let pendingPlan: PlanContext | null = null;
	let lastPlanContext: PlanContext | null = null;
	let pendingExecute: ExecuteContext | null = null;
	let activeMode: "plan" | "execute" | null = null;

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
				`Idea: ${idea}`,
				`Final goal: ${goal.trim()}`,
				"",
				"First do needed discovery (repo + web if useful), then produce implementation tasks only.",
				"Do not include exploration tasks in the final checklist.",
			].join("\n");

			if (ctx.isIdle()) {
				pi.sendUserMessage(kickoff);
			} else {
				pi.sendUserMessage(kickoff, { deliverAs: "followUp" });
			}

			ctx.ui.notify("Planning turn queued (foreground mode).", "success");
		},
	});

	pi.registerCommand("execute", {
		description: "Execute PLAN.md tasks in foreground (all remaining by default; pass a task id/text to run one)",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/execute requires interactive UI mode", "error");
				return;
			}

			const repoRoot = await detectRepoRoot(pi, ctx.cwd);
			const planPath = join(repoRoot, "PLAN.md");
			if (!(await exists(planPath))) {
				ctx.ui.notify(`PLAN.md not found at ${planPath}.`, "error");
				return;
			}

			const plan = await readFile(planPath, "utf8");
			const tasks = parsePlanTasks(plan);
			if (tasks.length === 0) {
				ctx.ui.notify("No checklist tasks found in PLAN.md.", "error");
				return;
			}

			const pending = tasks.filter((t) => t.status !== "x");
			if (pending.length === 0) {
				ctx.ui.notify("All PLAN.md tasks are already completed.", "success");
				return;
			}

			const arg = args.trim();
			const selected = arg ? resolveTask(arg, pending) : undefined;

			if (arg && !selected) {
				ctx.ui.notify(`Could not resolve pending task from '${arg}'.`, "error");
				return;
			}

			if (!selected) {
				const preview = pending
					.slice(0, 8)
					.map((t) => `- ${t.index}. [${t.status}] ${t.text}`)
					.join("\n");
				const suffix = pending.length > 8 ? `\n...and ${pending.length - 8} more task(s).` : "";
				const ok = await ctx.ui.confirm(
					`Execute all ${pending.length} pending task(s)?`,
					`${preview}${suffix}\n\nWill enforce lint/tests before [x] for each task.`,
				);
				if (!ok) {
					ctx.ui.notify("/execute cancelled", "info");
					return;
				}

				pendingExecute = { mode: "all", tasks: pending };
				const kickoff = [
					"Execute all remaining PLAN.md tasks in order.",
					"For each task: mark [/] at start, implement, run lint/tests, mark [x] only if verification passes.",
					"If blocked/failing, keep [/] and add blocker note under that task.",
					"Pending tasks:",
					...pending.map((t) => `- #${t.index} (line ${t.lineNumber}): ${t.text}`),
				].join("\n");

				if (ctx.isIdle()) {
					pi.sendUserMessage(kickoff);
				} else {
					pi.sendUserMessage(kickoff, { deliverAs: "followUp" });
				}

				ctx.ui.notify(`Execution turn queued for all ${pending.length} pending task(s).`, "success");
				return;
			}

			const ok = await ctx.ui.confirm(
				`Execute task #${selected.index}?`,
				`${selected.text}\n\nWill enforce lint/tests before [x].`,
			);
			if (!ok) {
				ctx.ui.notify("/execute cancelled", "info");
				return;
			}

			pendingExecute = { mode: "single", task: selected };
			const kickoff = [
				`Execute task #${selected.index} from PLAN.md (line ${selected.lineNumber}).`,
				`Task: ${selected.text}`,
				"Update PLAN.md status according to execution rules.",
			].join("\n");

			if (ctx.isIdle()) {
				pi.sendUserMessage(kickoff);
			} else {
				pi.sendUserMessage(kickoff, { deliverAs: "followUp" });
			}

			ctx.ui.notify(`Execution turn queued for task #${selected.index}.`, "success");
		},
	});

	pi.on("before_agent_start", async (event) => {
		if (pendingPlan) {
			const context = pendingPlan;
			pendingPlan = null;
			lastPlanContext = context;
			activeMode = "plan";
			return {
				systemPrompt: `${event.systemPrompt}\n\n${PLAN_PROMPT_APPEND}`,
				message: {
					customType: "plan-context",
					content: `Plan context\n- Idea: ${context.idea}\n- Final goal: ${context.goal}`,
					display: false,
				},
			};
		}

		if (pendingExecute) {
			const context = pendingExecute;
			pendingExecute = null;
			activeMode = "execute";
			const contextText =
				context.mode === "all"
					? `Execution context\n- Mode: all\n- Pending tasks: ${context.tasks?.length ?? 0}`
					: `Execution context\n- Mode: single\n- Task #${context.task?.index}\n- Line ${context.task?.lineNumber}\n- ${context.task?.text}`;
			return {
				systemPrompt: `${event.systemPrompt}\n\n${EXECUTE_PROMPT_APPEND}`,
				message: {
					customType: "execute-context",
					content: contextText,
					display: false,
				},
			};
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (activeMode === "plan" && ctx.hasUI) {
			const repoRoot = await detectRepoRoot(pi, ctx.cwd);
			const planPath = join(repoRoot, "PLAN.md");
			if (await exists(planPath)) {
				const planText = await readFile(planPath, "utf8");
				const action = await showPlanReviewOverlay(ctx, planText);
				if (action === "revise") {
					const note = await ctx.ui.editor("Requested changes to PLAN.md", "");
					if (note && note.trim()) {
						if (lastPlanContext) pendingPlan = lastPlanContext;
						const revisePrompt = [
							"Please revise PLAN.md based on this feedback:",
							note.trim(),
							"Keep tasks implementation-focused and reasonably large.",
						].join("\n\n");
						if (ctx.isIdle()) {
							pi.sendUserMessage(revisePrompt);
						} else {
							pi.sendUserMessage(revisePrompt, { deliverAs: "followUp" });
						}
					}
				}
			}
		}
		if (activeMode) activeMode = null;
	});
}
