import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

type BraveWebResult = {
	title?: string;
	url?: string;
	description?: string;
	age?: string;
	language?: string;
};

const BRAVE_WEB_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

function getApiKey(): string {
	const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
	if (!key) {
		throw new Error(
			"Missing BRAVE_SEARCH_API_KEY environment variable. " +
				"Set it before using Brave web search (https://api.search.brave.com)."
		);
	}
	return key;
}

function normalizeCount(value: number | undefined): number {
	if (value === undefined) return 8;
	return Math.max(1, Math.min(20, Math.floor(value)));
}

async function runBraveWebSearch(params: {
	query: string;
	count?: number;
	offset?: number;
	country?: string;
	searchLang?: string;
	freshness?: string;
	safesearch?: "off" | "moderate" | "strict";
	resultFilter?: string;
	extraSnippets?: boolean;
	timeoutMs?: number;
}): Promise<any> {
	const key = getApiKey();
	const timeoutMs = Math.max(1000, Math.floor(params.timeoutMs ?? 12000));
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	const query = params.query.trim();
	if (!query) throw new Error("Query must not be empty.");

	const url = new URL(BRAVE_WEB_SEARCH_ENDPOINT);
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(normalizeCount(params.count)));

	if (params.offset !== undefined) {
		url.searchParams.set("offset", String(Math.max(0, Math.min(9, Math.floor(params.offset)))));
	}
	if (params.country?.trim()) url.searchParams.set("country", params.country.trim());
	if (params.searchLang?.trim()) url.searchParams.set("search_lang", params.searchLang.trim());
	if (params.freshness?.trim()) url.searchParams.set("freshness", params.freshness.trim());
	if (params.safesearch) url.searchParams.set("safesearch", params.safesearch);
	if (params.resultFilter?.trim()) url.searchParams.set("result_filter", params.resultFilter.trim());
	if (params.extraSnippets === true) url.searchParams.set("extra_snippets", "true");

	try {
		const response = await fetch(url.toString(), {
			method: "GET",
			headers: {
				Accept: "application/json",
				"X-Subscription-Token": key,
			},
			signal: controller.signal,
		});

		if (!response.ok) {
			let bodyText = "";
			try {
				bodyText = (await response.text()).slice(0, 600);
			} catch {
				// ignore
			}
			if (response.status === 401 || response.status === 403) {
				throw new Error(
					`Brave API auth failed (${response.status}). Check BRAVE_SEARCH_API_KEY and your subscription plan.`
				);
			}
			if (response.status === 429) {
				throw new Error("Brave API rate limit reached (429). Retry later or reduce request frequency.");
			}
			throw new Error(`Brave API request failed (${response.status} ${response.statusText}). ${bodyText}`.trim());
		}

		let json: any;
		try {
			json = await response.json();
		} catch {
			throw new Error("Brave API returned non-JSON response.");
		}

		if (!json || typeof json !== "object") {
			throw new Error("Brave API returned an invalid JSON payload.");
		}
		return json;
	} catch (error: any) {
		if (error?.name === "AbortError") {
			throw new Error(`Brave API request timed out after ${timeoutMs}ms.`);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

function formatWebResults(results: BraveWebResult[]): string {
	if (results.length === 0) {
		return "No web results found.";
	}

	const lines = results.map((result, index) => {
		const title = (result.title || "(untitled)").replace(/\s+/g, " ").trim();
		const url = result.url || "(missing URL)";
		const description = (result.description || "").replace(/\s+/g, " ").trim();
		const meta = [result.age, result.language].filter(Boolean).join(" • ");
		return [
			`[${index + 1}] ${title}`,
			`URL: ${url}`,
			meta ? `Meta: ${meta}` : undefined,
			description ? `Snippet: ${description}` : undefined,
		]
			.filter(Boolean)
			.join("\n");
	});

	return lines.join("\n\n");
}

export default function braveSearchExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "brave_web_search",
		label: "Brave Web Search",
		description: "Search the web using Brave Search API and return ranked results with snippets.",
		promptSnippet: "Use Brave Search API for internet web search and research tasks (instead of CDP browsing).",
		promptGuidelines: [
			"Use brave_web_search for normal web research, documentation lookup, and fact gathering.",
			"Do not use CDP local debugging tools for general internet search.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query text" }),
			count: Type.Optional(Type.Number({ description: "Results per page (1-20)", default: 8 })),
			offset: Type.Optional(Type.Number({ description: "Pagination offset (0-9)", default: 0 })),
			country: Type.Optional(Type.String({ description: "Country code, e.g. US or ALL" })),
			searchLang: Type.Optional(Type.String({ description: "Language code, e.g. en" })),
			freshness: Type.Optional(Type.String({ description: "Freshness filter (pd, pw, pm, py, or date range)" })),
			safesearch: Type.Optional(Type.Union([Type.Literal("off"), Type.Literal("moderate"), Type.Literal("strict")], { default: "moderate" })),
			resultFilter: Type.Optional(Type.String({ description: "Comma-separated result filter, e.g. web,news,videos" })),
			extraSnippets: Type.Optional(Type.Boolean({ description: "Request additional snippets", default: false })),
			timeoutMs: Type.Optional(Type.Number({ description: "Request timeout in milliseconds", default: 12000 })),
		}),
		async execute(_toolCallId, params) {
			const payload = await runBraveWebSearch(params);
			const results = (payload?.web?.results ?? []) as BraveWebResult[];
			const lines = [
				`Brave web search for: ${params.query}`,
				`Results: ${results.length}`,
				"",
				formatWebResults(results),
			].join("\n");

			return {
				content: [{ type: "text", text: lines }],
				details: {
					query: params.query,
					count: results.length,
					moreResultsAvailable: payload?.query?.more_results_available === true,
					results,
					raw: payload,
				},
			};
		},
	});
}
