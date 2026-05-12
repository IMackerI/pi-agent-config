import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import { copyToClipboard, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";

type CodeBlock = {
	language: string;
	content: string;
	preview: string;
};

function getLastAssistantMessage(ctx: ExtensionContext): AssistantMessage | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		if (entry.message.role !== "assistant") continue;
		return entry.message;
	}
	return undefined;
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n\n")
		.trim();
}

function summarizeBlock(content: string, maxChars = 72): string {
	const singleLine = content.replace(/\s+/g, " ").trim();
	if (!singleLine) return "(empty block)";
	if (singleLine.length <= maxChars) return singleLine;
	return `${singleLine.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function extractCodeBlocks(text: string): CodeBlock[] {
	const blocks: CodeBlock[] = [];
	const regex = /```([^\n`]*)\n([\s\S]*?)```/g;

	for (const match of text.matchAll(regex)) {
		const language = (match[1] ?? "").trim().toLowerCase();
		const content = (match[2] ?? "").replace(/^\n+|\n+$/g, "");
		blocks.push({
			language,
			content,
			preview: summarizeBlock(content),
		});
	}

	return blocks.filter((block) => block.content.trim().length > 0);
}

async function copyLastAssistantCodeBlock(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	const lastAssistant = getLastAssistantMessage(ctx);
	if (!lastAssistant) {
		ctx.ui.notify("No assistant message to copy from", "warning");
		return;
	}

	const blocks = extractCodeBlocks(assistantText(lastAssistant));
	if (blocks.length === 0) {
		ctx.ui.notify("No fenced code blocks found in the last assistant message", "warning");
		return;
	}

	let selectedBlock = blocks[0];
	if (blocks.length > 1) {
		const labels = blocks.map((block, index) => {
			const language = block.language || "text";
			return `${index + 1}. [${language}] ${block.preview}`;
		});
		const selectedLabel = await ctx.ui.select("Copy which code block?", labels);
		if (!selectedLabel) return;
		const selectedIndex = labels.indexOf(selectedLabel);
		if (selectedIndex < 0) {
			ctx.ui.notify("Could not resolve selected code block", "error");
			return;
		}
		selectedBlock = blocks[selectedIndex];
	}

	try {
		await copyToClipboard(selectedBlock.content);
		ctx.ui.notify(
			`Copied ${selectedBlock.language || "text"} block to clipboard${blocks.length > 1 ? ` (${blocks.indexOf(selectedBlock) + 1}/${blocks.length})` : ""}`,
			"info",
		);
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
	}
}

async function cutEditorInput(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	const text = ctx.ui.getEditorText();
	if (!text.trim()) {
		ctx.ui.notify("Editor is empty", "warning");
		return;
	}

	try {
		await copyToClipboard(text);
		ctx.ui.setEditorText("");
		ctx.ui.notify("Cut editor input to clipboard", "info");
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("copyblock", {
		description: "Copy a code block from the last assistant message",
		handler: async (_args, ctx) => {
			await copyLastAssistantCodeBlock(ctx);
		},
	});

	pi.registerCommand("cutinput", {
		description: "Cut the current editor input to the clipboard",
		handler: async (_args, ctx) => {
			await cutEditorInput(ctx);
		},
	});

	pi.registerShortcut("alt+c", {
		description: "Copy a code block from the last assistant message",
		handler: async (ctx) => {
			await copyLastAssistantCodeBlock(ctx);
		},
	});

	pi.registerShortcut("alt+x", {
		description: "Cut the current editor input to the clipboard",
		handler: async (ctx) => {
			await cutEditorInput(ctx);
		},
	});
}
