import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type, type Static } from "@sinclair/typebox";

const OptionSchema = Type.Object({
	value: Type.String({ description: "Value returned when selected" }),
	label: Type.String({ description: "Display label" }),
	description: Type.Optional(Type.String({ description: "Optional helper text" })),
});

const QuestionSchema = Type.Object({
	id: Type.String({ description: "Unique question ID" }),
	label: Type.Optional(Type.String({ description: "Short label" })),
	prompt: Type.String({ description: "Question prompt" }),
	options: Type.Optional(Type.Array(OptionSchema, { description: "Explicit options" })),
	suggestedAnswers: Type.Optional(
		Type.Array(Type.String(), { description: "Suggested quick answers for open prompts" }),
	),
	required: Type.Optional(Type.Boolean({ description: "Must be answered before submit" })),
	placeholder: Type.Optional(Type.String({ description: "Hint for typed answer" })),
	kind: Type.Optional(
		StringEnum(["open", "choice", "permission"] as const, {
			description: "Question kind (informational; behavior is options + optional custom input)",
		}),
	),
	allowCustom: Type.Optional(Type.Boolean({ description: "Allow typed custom answer (default true)" })),
});

const ParamsSchema = Type.Object({
	title: Type.Optional(Type.String({ description: "Dialog title" })),
	description: Type.Optional(Type.String({ description: "Optional context text" })),
	submitLabel: Type.Optional(Type.String({ description: "Unused label for compatibility" })),
	questions: Type.Array(QuestionSchema, { description: "Questions to ask" }),
});

type Params = Static<typeof ParamsSchema>;
type Question = Static<typeof QuestionSchema>;

interface Answer {
	id: string;
	label: string;
	value: string;
	wasCustom: boolean;
}

interface Details {
	title: string;
	description?: string;
	answers: Answer[];
	cancelled: boolean;
}

function normalizeOptions(question: Question): Array<{ value: string; label: string }> {
	const options: Array<{ value: string; label: string }> = [];
	for (const option of question.options ?? []) {
		options.push({ value: option.value, label: option.label });
	}
	for (const suggested of question.suggestedAnswers ?? []) {
		options.push({ value: suggested, label: suggested });
	}
	if ((question.kind ?? "open") === "permission" && options.length === 0) {
		options.push({ value: "approve", label: "Approve" }, { value: "deny", label: "Deny" });
	}
	return options;
}

export default function planningQuestionnaire(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user_questions",
		label: "Ask User Questions",
		description: "Ask a small structured set of questions and return user answers.",
		promptSnippet: "Ask the user a structured multi-question planning dialog and collect answers in one step.",
		promptGuidelines: [
			"Use this sparingly. Prefer normal chat for simple/one-off clarifications.",
			"Use mainly when the user explicitly says we are planning and wants batched input.",
		],
		parameters: ParamsSchema,

		async execute(_toolCallId, params: Params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Error: ask_user_questions requires interactive UI mode." }],
					details: { title: params.title ?? "Questions", description: params.description, answers: [], cancelled: true },
				};
			}

			if (!params.questions || params.questions.length === 0) {
				return {
					content: [{ type: "text", text: "Error: No questions provided." }],
					details: { title: params.title ?? "Questions", description: params.description, answers: [], cancelled: true },
				};
			}

			const answers: Answer[] = [];
			for (const question of params.questions) {
				const required = question.required !== false;
				const options = normalizeOptions(question);
				const allowCustom = question.allowCustom !== false;
				const title = question.label ? `${question.label}: ${question.prompt}` : question.prompt;

				let answer: Answer | null = null;

				if (options.length > 0) {
					const labels = options.map((o) => o.label);
					if (allowCustom) labels.push("Write your own answer…");

					const selected = await ctx.ui.select(title, labels);
					if (!selected) {
						return {
							content: [{ type: "text", text: "User cancelled questionnaire." }],
							details: {
								title: params.title ?? "Questions",
								description: params.description,
								answers,
								cancelled: true,
							} satisfies Details,
						};
					}

					if (selected === "Write your own answer…") {
						const typed = await ctx.ui.editor(title, "");
						if (!typed && required) {
							return {
								content: [{ type: "text", text: `User cancelled required question '${question.id}'.` }],
								details: {
									title: params.title ?? "Questions",
									description: params.description,
									answers,
									cancelled: true,
								} satisfies Details,
							};
						}
						answer = {
							id: question.id,
							label: typed?.trim() || "",
							value: typed?.trim() || "",
							wasCustom: true,
						};
					} else {
						const picked = options.find((o) => o.label === selected)!;
						answer = { id: question.id, label: picked.label, value: picked.value, wasCustom: false };
					}
				} else {
					const typed = await ctx.ui.editor(title, "");
					if (!typed && required) {
						return {
							content: [{ type: "text", text: `User cancelled required question '${question.id}'.` }],
							details: {
								title: params.title ?? "Questions",
								description: params.description,
								answers,
								cancelled: true,
							} satisfies Details,
						};
					}
					answer = {
						id: question.id,
						label: typed?.trim() || "",
						value: typed?.trim() || "",
						wasCustom: true,
					};
				}

				if (answer && (answer.value.length > 0 || !required)) answers.push(answer);
			}

			const summary = answers.map((a) => `${a.id}: ${a.wasCustom ? "typed" : "selected"}: ${a.label}`).join("\n");
			return {
				content: [{ type: "text", text: summary || "No answers captured." }],
				details: {
					title: params.title ?? "Questions",
					description: params.description,
					answers,
					cancelled: false,
				} satisfies Details,
			};
		},

		renderCall(args, theme, _context) {
			const input = args as Params;
			const count = input.questions?.length ?? 0;
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ask_user_questions "))}${theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`)}`,
				0,
				0,
			);
		},

		renderResult(result, _options, _theme, _context) {
			const text = result.content.find((c): c is { type: "text"; text: string } => c.type === "text")?.text ?? "";
			return new Text(text, 0, 0);
		},
	});
}
