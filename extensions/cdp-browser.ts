import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

type CdpTarget = {
	id: string;
	title?: string;
	type?: string;
	url?: string;
	webSocketDebuggerUrl?: string;
};

type BrowserState = {
	endpoint: string;
	activeTargetId?: string;
};

const DEFAULT_ENDPOINT = "http://127.0.0.1:9222";
const STATE_ENTRY = "cdp-browser-state";

class CdpClient {
	private ws: any;
	private nextId = 1;
	private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();
	private waiters = new Map<string, Array<{ resolve: (value: any) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>>();
	private listeners = new Set<(method: string, params: any) => void>();

	constructor(private readonly wsUrl: string) {}

	async connect(timeoutMs = 8000): Promise<void> {
		if (this.ws && this.ws.readyState === 1) return;
		if (typeof WebSocket === "undefined") {
			throw new Error("WebSocket is not available in this Node runtime.");
		}

		this.ws = new WebSocket(this.wsUrl);

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`Timed out connecting to CDP websocket after ${timeoutMs}ms: ${this.wsUrl}`));
			}, timeoutMs);

			this.ws.onopen = () => {
				clearTimeout(timeout);
				resolve();
			};

			this.ws.onerror = () => {
				clearTimeout(timeout);
				reject(new Error(`Failed to connect to CDP websocket: ${this.wsUrl}`));
			};
		});

		this.ws.onmessage = (event: { data: any }) => {
			let raw = "";
			if (typeof event.data === "string") {
				raw = event.data;
			} else if (Buffer.isBuffer(event.data)) {
				raw = event.data.toString("utf8");
			} else {
				raw = String(event.data);
			}

			let message: any;
			try {
				message = JSON.parse(raw);
			} catch {
				return;
			}

			if (typeof message.id === "number") {
				const pending = this.pending.get(message.id);
				if (!pending) return;
				clearTimeout(pending.timeout);
				this.pending.delete(message.id);

				if (message.error) {
					pending.reject(new Error(`CDP error ${message.error.code}: ${message.error.message}`));
				} else {
					pending.resolve(message.result);
				}
				return;
			}

			if (typeof message.method === "string") {
				for (const listener of this.listeners) {
					try {
						listener(message.method, message.params);
					} catch {
						// Listener failures should not break protocol processing.
					}
				}

				const queue = this.waiters.get(message.method);
				if (!queue || queue.length === 0) return;
				const waiter = queue.shift();
				if (!waiter) return;
				clearTimeout(waiter.timeout);
				waiter.resolve(message.params);
			}
		};

		this.ws.onclose = () => {
			this.rejectAll(new Error("CDP websocket closed"));
		};
	}

	async send(method: string, params: Record<string, unknown> = {}, timeoutMs = 10000): Promise<any> {
		if (!this.ws || this.ws.readyState !== 1) {
			throw new Error("CDP websocket is not connected.");
		}

		const id = this.nextId++;
		const payload = JSON.stringify({ id, method, params });

		const resultPromise = new Promise<any>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP call timed out: ${method}`));
			}, timeoutMs);

			this.pending.set(id, { resolve, reject, timeout });
		});

		this.ws.send(payload);
		return await resultPromise;
	}

	onEvent(listener: (method: string, params: any) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async waitForEvent(method: string, timeoutMs = 10000): Promise<any> {
		if (!this.ws || this.ws.readyState !== 1) {
			throw new Error("CDP websocket is not connected.");
		}

		return await new Promise<any>((resolve, reject) => {
			const timeout = setTimeout(() => {
				const queue = this.waiters.get(method) ?? [];
				const next = queue.filter((entry) => entry.resolve !== resolve);
				this.waiters.set(method, next);
				reject(new Error(`Timed out waiting for CDP event: ${method}`));
			}, timeoutMs);

			const queue = this.waiters.get(method) ?? [];
			queue.push({ resolve, reject, timeout });
			this.waiters.set(method, queue);
		});
	}

	close() {
		if (!this.ws) return;
		if (this.ws.readyState === 0 || this.ws.readyState === 1) {
			this.ws.close();
		}
		this.rejectAll(new Error("CDP client closed"));
	}

	private rejectAll(error: Error) {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timeout);
			pending.reject(error);
			this.pending.delete(id);
		}
		for (const [method, queue] of this.waiters) {
			for (const waiter of queue) {
				clearTimeout(waiter.timeout);
				waiter.reject(error);
			}
			this.waiters.delete(method);
		}
	}
}

async function fetchJson(endpoint: string, path: string, init?: RequestInit, timeoutMs = 8000): Promise<any> {
	const base = endpoint.replace(/\/$/, "");
	const url = `${base}${path}`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { ...init, signal: controller.signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}
		return await response.json();
	} finally {
		clearTimeout(timeout);
	}
}

async function listPageTargets(endpoint: string): Promise<CdpTarget[]> {
	const targets = (await fetchJson(endpoint, "/json/list")) as CdpTarget[];
	return targets.filter((target) => target.type === "page" && !!target.webSocketDebuggerUrl);
}

async function createTarget(endpoint: string, url: string): Promise<CdpTarget> {
	const encodedUrl = encodeURIComponent(url);
	try {
		return (await fetchJson(endpoint, `/json/new?${encodedUrl}`, { method: "PUT" })) as CdpTarget;
	} catch {
		return (await fetchJson(endpoint, `/json/new?${encodedUrl}`, { method: "GET" })) as CdpTarget;
	}
}

async function getOrCreateActiveTarget(state: BrowserState): Promise<CdpTarget> {
	const pages = await listPageTargets(state.endpoint);

	if (state.activeTargetId) {
		const active = pages.find((target) => target.id === state.activeTargetId);
		if (active) return active;
	}

	if (pages.length > 0) {
		state.activeTargetId = pages[0].id;
		return pages[0];
	}

	const created = await createTarget(state.endpoint, "about:blank");
	state.activeTargetId = created.id;
	return created;
}

async function evalInPage(client: CdpClient, expression: string, returnByValue = true): Promise<any> {
	const result = await client.send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue,
		userGesture: true,
	});
	if (result.exceptionDetails) {
		const message = result.exceptionDetails.text || "Runtime.evaluate failed";
		throw new Error(message);
	}
	return result.result?.value;
}

async function withActivePage<T>(state: BrowserState, fn: (client: CdpClient, target: CdpTarget) => Promise<T>): Promise<T> {
	const target = await getOrCreateActiveTarget(state);
	if (!target.webSocketDebuggerUrl) {
		throw new Error(`Active target has no websocket URL: ${target.id}`);
	}
	const client = new CdpClient(target.webSocketDebuggerUrl);
	await client.connect();
	try {
		await client.send("Page.enable");
		await client.send("Runtime.enable");
		await client.send("DOM.enable");
		return await fn(client, target);
	} finally {
		client.close();
	}
}

async function waitForLoadEvent(client: CdpClient, timeoutMs: number): Promise<void> {
	try {
		await Promise.any([
			client.waitForEvent("Page.loadEventFired", timeoutMs),
			client.waitForEvent("Page.domContentEventFired", timeoutMs),
		]);
	} catch {
		// Ignore timeout; many SPAs don't emit a fresh load event for every navigation.
	}
}

function truncateForPrompt(text: string): { text: string; truncated: boolean } {
	const truncation = truncateHead(text, {
		maxBytes: DEFAULT_MAX_BYTES,
		maxLines: DEFAULT_MAX_LINES,
	});
	if (!truncation.truncated) {
		return { text: truncation.content, truncated: false };
	}

	const suffix = `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
	return { text: truncation.content + suffix, truncated: true };
}

function defaultScreenshotPath(cwd: string): string {
	const now = new Date();
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	return resolve(cwd, ".pi", "browser", `screenshot-${stamp}.png`);
}

function defaultHarPath(cwd: string): string {
	const now = new Date();
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	return resolve(cwd, ".pi", "browser", `network-${stamp}.har`);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateEndpoint(endpoint: string): string {
	const normalized = endpoint.trim().replace(/\/$/, "");
	if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
		throw new Error(`CDP endpoint must start with http:// or https://. Got: ${endpoint}`);
	}
	return normalized;
}

export default function (pi: ExtensionAPI) {
	let state: BrowserState = {
		endpoint: DEFAULT_ENDPOINT,
	};

	const persistState = () => {
		pi.appendEntry(STATE_ENTRY, { ...state });
	};

	pi.on("session_start", async (_event, ctx) => {
		state = { endpoint: DEFAULT_ENDPOINT };
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
			const data = entry.data as Partial<BrowserState> | undefined;
			if (!data?.endpoint) continue;
			state = {
				endpoint: validateEndpoint(data.endpoint),
				activeTargetId: data.activeTargetId,
			};
		}
		ctx.ui.setStatus("cdp-browser", `CDP ${state.endpoint}`);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("cdp-browser", undefined);
	});

	pi.registerTool({
		name: "cdp_connect",
		label: "CDP Connect",
		description:
			"Connect to a local Chrome DevTools Protocol endpoint (default http://127.0.0.1:9222), validate connectivity, and select an active tab.",
		promptSnippet: "Connect to a local browser via CDP before browsing or DOM interaction.",
		parameters: Type.Object({
			endpoint: Type.Optional(Type.String({ description: "HTTP CDP endpoint, e.g. http://127.0.0.1:9222" })),
			targetId: Type.Optional(Type.String({ description: "Optional target/tab id to make active after connecting" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			state.endpoint = validateEndpoint(params.endpoint ?? DEFAULT_ENDPOINT);
			const version = await fetchJson(state.endpoint, "/json/version").catch((error: Error) => {
				throw new Error(
					`Failed to connect to CDP endpoint ${state.endpoint}. ${error.message}\nStart Chrome with: google-chrome-stable --remote-debugging-port=9222 --user-data-dir=/tmp/pi-cdp-profile --no-first-run --no-default-browser-check`
				);
			});

			const pages = await listPageTargets(state.endpoint);
			if (params.targetId) {
				const requested = pages.find((target) => target.id === params.targetId);
				if (!requested) {
					throw new Error(`Target not found: ${params.targetId}`);
				}
				state.activeTargetId = requested.id;
			} else if (!state.activeTargetId) {
				if (pages.length > 0) {
					state.activeTargetId = pages[0].id;
				} else {
					const created = await createTarget(state.endpoint, "about:blank");
					state.activeTargetId = created.id;
				}
			}

			persistState();
			ctx.ui.setStatus("cdp-browser", `CDP ${state.endpoint}`);

			const activeTitle = pages.find((target) => target.id === state.activeTargetId)?.title ?? "(new tab)";
			return {
				content: [
					{
						type: "text",
						text: `Connected to ${state.endpoint}\nBrowser: ${version.Browser ?? "unknown"}\nActive tab: ${state.activeTargetId} (${activeTitle})`,
					},
				],
				details: {
					endpoint: state.endpoint,
					browserVersion: version.Browser,
					protocolVersion: version["Protocol-Version"],
					activeTargetId: state.activeTargetId,
					pageCount: pages.length,
				},
			};
		},
	});

	pi.registerTool({
		name: "cdp_tabs",
		label: "CDP Tabs",
		description: "List open page tabs available on the connected CDP browser.",
		parameters: Type.Object({}),
		async execute() {
			const pages = await listPageTargets(state.endpoint);
			if (pages.length === 0) {
				return {
					content: [{ type: "text", text: "No page tabs found." }],
					details: { tabs: [] },
				};
			}
			const lines = pages.map((tab, index) => {
				const active = tab.id === state.activeTargetId ? "*" : " ";
				const title = (tab.title || "(untitled)").replace(/\s+/g, " ").trim();
				return `${active} [${index + 1}] ${tab.id} | ${title} | ${tab.url || "about:blank"}`;
			});
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { tabs: pages, activeTargetId: state.activeTargetId },
			};
		},
	});

	pi.registerTool({
		name: "cdp_select_tab",
		label: "CDP Select Tab",
		description: "Select the active tab by CDP target id.",
		parameters: Type.Object({
			targetId: Type.String({ description: "CDP target id from cdp_tabs" }),
		}),
		async execute(_toolCallId, params) {
			const pages = await listPageTargets(state.endpoint);
			const selected = pages.find((target) => target.id === params.targetId);
			if (!selected) {
				throw new Error(`Target not found: ${params.targetId}`);
			}
			state.activeTargetId = selected.id;
			persistState();
			return {
				content: [{ type: "text", text: `Active tab set to ${selected.id} (${selected.title || "untitled"})` }],
				details: { activeTargetId: selected.id, tab: selected },
			};
		},
	});

	pi.registerTool({
		name: "cdp_new_tab",
		label: "CDP New Tab",
		description: "Open a new tab with an optional URL and make it active.",
		parameters: Type.Object({
			url: Type.Optional(Type.String({ description: "Initial URL (defaults to about:blank)" })),
		}),
		async execute(_toolCallId, params) {
			const target = await createTarget(state.endpoint, params.url ?? "about:blank");
			state.activeTargetId = target.id;
			persistState();
			return {
				content: [{ type: "text", text: `Opened new tab ${target.id} at ${target.url || params.url || "about:blank"}` }],
				details: { tab: target, activeTargetId: state.activeTargetId },
			};
		},
	});

	pi.registerTool({
		name: "cdp_navigate",
		label: "CDP Navigate",
		description: "Navigate the active tab to a URL and wait briefly for load events.",
		promptSnippet: "Navigate browser tab to a URL when the user asks to open a page.",
		parameters: Type.Object({
			url: Type.String({ description: "Destination URL" }),
			timeoutMs: Type.Optional(Type.Number({ description: "Navigation wait timeout in milliseconds", default: 15000 })),
		}),
		async execute(_toolCallId, params) {
			return await withActivePage(state, async (client) => {
				await client.send("Page.navigate", { url: params.url });
				await waitForLoadEvent(client, params.timeoutMs ?? 15000);

				const snapshot = await evalInPage(
					client,
					"(() => ({ title: document.title || '', url: location.href, readyState: document.readyState }))()"
				);
				return {
					content: [
						{
							type: "text",
							text: `Navigated to ${snapshot.url}\nTitle: ${snapshot.title}\nreadyState: ${snapshot.readyState}`,
						},
					],
					details: snapshot,
				};
			});
		},
	});

	pi.registerTool({
		name: "cdp_snapshot",
		label: "CDP Snapshot",
		description: "Capture a text snapshot of the active page (URL, title, and body text).",
		promptSnippet: "Read the current page content after navigation or interaction.",
		parameters: Type.Object({
			maxTextChars: Type.Optional(Type.Number({ description: "Soft limit before truncation metadata (default 12000)", default: 12000 })),
		}),
		async execute(_toolCallId, params) {
			return await withActivePage(state, async (client) => {
				const data = await evalInPage(
					client,
					`(() => {
						const rawText = (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
						const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 25).map((a) => ({
							text: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
							href: a.getAttribute('href') || ''
						}));
						return {
							title: document.title || '',
							url: location.href,
							readyState: document.readyState,
							text: rawText,
							links
						};
					})()`
				);

				const rawText = typeof data.text === "string" ? data.text : "";
				const softLimit = Math.max(1000, Math.floor(params.maxTextChars ?? 12000));
				const softClipped = rawText.length > softLimit ? `${rawText.slice(0, softLimit)}\n\n[Soft-clipped before truncation utility]` : rawText;
				const truncated = truncateForPrompt(softClipped);

				const lines = [
					`URL: ${data.url}`,
					`Title: ${data.title}`,
					`Ready: ${data.readyState}`,
					"",
					truncated.text,
				];

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						...data,
						textLength: rawText.length,
						truncated: truncated.truncated,
					},
				};
			});
		},
	});

	pi.registerTool({
		name: "cdp_click",
		label: "CDP Click",
		description: "Click an element in the active page via CSS selector.",
		promptSnippet: "Click buttons/links by CSS selector for browser automation tasks.",
		parameters: Type.Object({
			selector: Type.String({ description: "CSS selector for the element to click" }),
			waitForLoad: Type.Optional(Type.Boolean({ description: "Wait for load events after click", default: true })),
			timeoutMs: Type.Optional(Type.Number({ description: "Load wait timeout in milliseconds", default: 10000 })),
		}),
		async execute(_toolCallId, params) {
			return await withActivePage(state, async (client) => {
				const selectorLiteral = JSON.stringify(params.selector);
				const clickResult = await evalInPage(
					client,
					`(() => {
						const selector = ${selectorLiteral};
						const el = document.querySelector(selector);
						if (!el) return { ok: false, error: 'Element not found' };
						el.scrollIntoView({ block: 'center', inline: 'center' });
						if (typeof el.click === 'function') el.click();
						return {
							ok: true,
							tag: el.tagName,
							text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 140)
						};
					})()`
				);

				if (!clickResult?.ok) {
					throw new Error(`Click failed for selector ${params.selector}: ${clickResult?.error || "unknown error"}`);
				}

				if (params.waitForLoad !== false) {
					await waitForLoadEvent(client, params.timeoutMs ?? 10000);
				}

				return {
					content: [{ type: "text", text: `Clicked ${params.selector} (${clickResult.tag}) ${clickResult.text ? `- ${clickResult.text}` : ""}` }],
					details: clickResult,
				};
			});
		},
	});

	pi.registerTool({
		name: "cdp_type",
		label: "CDP Type",
		description: "Type text into an input or textarea selected by CSS selector.",
		promptSnippet: "Fill forms by typing text into fields.",
		parameters: Type.Object({
			selector: Type.String({ description: "CSS selector for input/textarea/contenteditable" }),
			text: Type.String({ description: "Text to type" }),
			clearFirst: Type.Optional(Type.Boolean({ description: "Clear existing value before typing", default: true })),
			submit: Type.Optional(Type.Boolean({ description: "Submit nearest form after typing", default: false })),
			waitForLoad: Type.Optional(Type.Boolean({ description: "Wait for load events after submit", default: true })),
			timeoutMs: Type.Optional(Type.Number({ description: "Load wait timeout in milliseconds", default: 10000 })),
		}),
		async execute(_toolCallId, params) {
			return await withActivePage(state, async (client) => {
				const selectorLiteral = JSON.stringify(params.selector);
				const textLiteral = JSON.stringify(params.text);
				const clearLiteral = params.clearFirst !== false ? "true" : "false";
				const submitLiteral = params.submit === true ? "true" : "false";

				const result = await evalInPage(
					client,
					`(() => {
						const selector = ${selectorLiteral};
						const text = ${textLiteral};
						const clearFirst = ${clearLiteral};
						const submit = ${submitLiteral};
						const el = document.querySelector(selector);
						if (!el) return { ok: false, error: 'Element not found' };
						const target = el;
						if (typeof target.focus === 'function') target.focus();
						if ('value' in target) {
							const next = clearFirst ? text : String(target.value || '') + text;
							target.value = next;
							target.dispatchEvent(new Event('input', { bubbles: true }));
							target.dispatchEvent(new Event('change', { bubbles: true }));
						} else if (target.isContentEditable) {
							target.textContent = clearFirst ? text : (target.textContent || '') + text;
							target.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
						} else {
							return { ok: false, error: 'Element is not typeable' };
						}
						let submitted = false;
						if (submit) {
							const form = target.closest('form');
							if (form && typeof form.requestSubmit === 'function') {
								form.requestSubmit();
								submitted = true;
							}
						}
						return {
							ok: true,
							tag: target.tagName,
							submitted,
							length: text.length
						};
					})()`
				);

				if (!result?.ok) {
					throw new Error(`Type failed for selector ${params.selector}: ${result?.error || "unknown error"}`);
				}

				if (result.submitted && params.waitForLoad !== false) {
					await waitForLoadEvent(client, params.timeoutMs ?? 10000);
				}

				return {
					content: [{ type: "text", text: `Typed ${params.text.length} characters into ${params.selector}` }],
					details: result,
				};
			});
		},
	});

	pi.registerTool({
		name: "cdp_wait_for",
		label: "CDP Wait For",
		description: "Wait until an element matching a CSS selector appears.",
		parameters: Type.Object({
			selector: Type.String({ description: "CSS selector to wait for" }),
			timeoutMs: Type.Optional(Type.Number({ description: "Maximum wait time", default: 10000 })),
			pollMs: Type.Optional(Type.Number({ description: "Polling interval", default: 250 })),
		}),
		async execute(_toolCallId, params) {
			return await withActivePage(state, async (client) => {
				const timeoutMs = Math.max(100, Math.floor(params.timeoutMs ?? 10000));
				const pollMs = Math.max(50, Math.floor(params.pollMs ?? 250));
				const startedAt = Date.now();
				const selectorLiteral = JSON.stringify(params.selector);

				let found = false;
				while (Date.now() - startedAt < timeoutMs) {
					const exists = await evalInPage(client, `(() => !!document.querySelector(${selectorLiteral}))()`);
					if (exists) {
						found = true;
						break;
					}
					await new Promise((resolve) => setTimeout(resolve, pollMs));
				}

				if (!found) {
					throw new Error(`Selector did not appear within ${timeoutMs}ms: ${params.selector}`);
				}

				return {
					content: [{ type: "text", text: `Selector appeared: ${params.selector}` }],
					details: { selector: params.selector, waitedMs: Date.now() - startedAt },
				};
			});
		},
	});

	pi.registerTool({
		name: "cdp_eval",
		label: "CDP Eval",
		description: "Evaluate JavaScript in the active page and return JSON-serializable output.",
		parameters: Type.Object({
			expression: Type.String({ description: "JavaScript expression evaluated in page context" }),
		}),
		async execute(_toolCallId, params) {
			return await withActivePage(state, async (client) => {
				const value = await evalInPage(client, params.expression, true);
				const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
				const truncated = truncateForPrompt(text ?? "null");
				return {
					content: [{ type: "text", text: truncated.text }],
					details: { value, truncated: truncated.truncated },
				};
			});
		},
	});

	pi.registerTool({
		name: "cdp_html",
		label: "CDP HTML",
		description: "Get outer HTML for the full page or a CSS selector.",
		parameters: Type.Object({
			selector: Type.Optional(Type.String({ description: "Optional CSS selector" })),
		}),
		async execute(_toolCallId, params) {
			return await withActivePage(state, async (client) => {
				const selectorLiteral = JSON.stringify(params.selector ?? "");
				const html = await evalInPage(
					client,
					`(() => {
						const selector = ${selectorLiteral};
						if (!selector) return document.documentElement?.outerHTML || '';
						const el = document.querySelector(selector);
						if (!el) return null;
						return el.outerHTML;
					})()`
				);
				if (html === null) {
					throw new Error(`Selector not found: ${params.selector}`);
				}
				const truncated = truncateForPrompt(String(html));
				return {
					content: [{ type: "text", text: truncated.text }],
					details: { selector: params.selector, truncated: truncated.truncated, length: String(html).length },
				};
			});
		},
	});

	pi.registerTool({
		name: "cdp_console_watch",
		label: "CDP Console Watch",
		description: "Capture console errors/warnings/messages from the active page over a short observation window.",
		parameters: Type.Object({
			durationMs: Type.Optional(Type.Number({ description: "How long to observe console output", default: 5000 })),
			navigateUrl: Type.Optional(Type.String({ description: "Optional URL to navigate to before observing" })),
			includeInfo: Type.Optional(Type.Boolean({ description: "Include info/debug/log console output", default: false })),
		}),
		async execute(_toolCallId, params) {
			return await withActivePage(state, async (client) => {
				const durationMs = Math.max(250, Math.floor(params.durationMs ?? 5000));
				const includeInfo = params.includeInfo === true;
				const startedAt = Date.now();
				const entries: Array<{ level: string; source: string; text: string; ts: number }> = [];

				await client.send("Runtime.enable");
				await client.send("Log.enable");

				const unsubscribe = client.onEvent((method, eventParams) => {
					if (method === "Runtime.consoleAPICalled") {
						const level = String(eventParams?.type ?? "log");
						if (!includeInfo && !["error", "warning", "assert"].includes(level)) return;
						const args = Array.isArray(eventParams?.args) ? eventParams.args : [];
						const text = args
							.map((arg: any) => {
								if (typeof arg?.value === "string") return arg.value;
								if (arg?.value !== undefined) return String(arg.value);
								if (typeof arg?.description === "string") return arg.description;
								return "[object]";
							})
							.join(" ")
							.trim();
						entries.push({
							level,
							source: "console",
							text: text || "(empty message)",
							ts: Date.now(),
						});
						return;
					}

					if (method === "Runtime.exceptionThrown") {
						const details = eventParams?.exceptionDetails;
						const text = details?.text || details?.exception?.description || "Uncaught exception";
						entries.push({ level: "error", source: "exception", text: String(text), ts: Date.now() });
						return;
					}

					if (method === "Log.entryAdded") {
						const entry = eventParams?.entry;
						const level = String(entry?.level ?? "info");
						if (!includeInfo && !["error", "warning"].includes(level)) return;
						const source = String(entry?.source ?? "log");
						const text = String(entry?.text ?? "").trim();
						entries.push({ level, source, text: text || "(empty log entry)", ts: Date.now() });
					}
				});

				if (params.navigateUrl) {
					await client.send("Page.navigate", { url: params.navigateUrl });
					await waitForLoadEvent(client, 15000);
				}

				await sleep(durationMs);
				unsubscribe();

				const counts = entries.reduce<Record<string, number>>((acc, entry) => {
					acc[entry.level] = (acc[entry.level] ?? 0) + 1;
					return acc;
				}, {});

				const sorted = [...entries].sort((a, b) => a.ts - b.ts);
				const previewLines = sorted.map((entry, index) => {
					const age = `${entry.ts - startedAt}ms`;
					return `[${index + 1}] ${entry.level.toUpperCase()} (${entry.source}, +${age}) ${entry.text}`;
				});

				const summary = [
					`Console watch complete (${durationMs}ms).`,
					`Captured ${entries.length} entries.`,
					`Levels: error=${counts.error ?? 0}, warning=${counts.warning ?? 0}, info=${counts.info ?? 0}, log=${counts.log ?? 0}, debug=${counts.debug ?? 0}`,
					"",
					...previewLines,
				].join("\n");

				const truncated = truncateForPrompt(summary);
				return {
					content: [{ type: "text", text: truncated.text }],
					details: {
						durationMs,
						navigateUrl: params.navigateUrl,
						entryCount: entries.length,
						counts,
						entries,
						truncated: truncated.truncated,
					},
				};
			});
		},
	});

	pi.registerTool({
		name: "cdp_network_har",
		label: "CDP Network HAR",
		description: "Capture network activity and export a HAR file with a concise latency/error summary.",
		parameters: Type.Object({
			durationMs: Type.Optional(Type.Number({ description: "How long to record network traffic", default: 7000 })),
			navigateUrl: Type.Optional(Type.String({ description: "Optional URL to navigate to before recording" })),
			path: Type.Optional(Type.String({ description: "Output HAR path (defaults to .pi/browser/network-*.har)" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return await withActivePage(state, async (client) => {
				const durationMs = Math.max(500, Math.floor(params.durationMs ?? 7000));
				type RecordItem = {
					requestId: string;
					url: string;
					method: string;
					resourceType?: string;
					status?: number;
					statusText?: string;
					mimeType?: string;
					requestHeaders?: Record<string, any>;
					responseHeaders?: Record<string, any>;
					startWallTimeMs: number;
					startTs?: number;
					endTs?: number;
					finished?: boolean;
					failed?: boolean;
					errorText?: string;
					encodedDataLength?: number;
				};

				const records = new Map<string, RecordItem>();
				await client.send("Network.enable");

				const unsubscribe = client.onEvent((method, eventParams) => {
					if (method === "Network.requestWillBeSent") {
						const requestId = String(eventParams?.requestId ?? "");
						if (!requestId) return;
						const req = eventParams?.request ?? {};
						records.set(requestId, {
							requestId,
							url: String(req.url ?? ""),
							method: String(req.method ?? "GET"),
							requestHeaders: req.headers ?? {},
							resourceType: eventParams?.type,
							startWallTimeMs: typeof eventParams?.wallTime === "number" ? eventParams.wallTime * 1000 : Date.now(),
							startTs: typeof eventParams?.timestamp === "number" ? eventParams.timestamp : undefined,
						});
						return;
					}

					if (method === "Network.responseReceived") {
						const requestId = String(eventParams?.requestId ?? "");
						const item = records.get(requestId);
						if (!item) return;
						const response = eventParams?.response ?? {};
						item.status = Number(response.status ?? 0);
						item.statusText = String(response.statusText ?? "");
						item.mimeType = String(response.mimeType ?? "");
						item.responseHeaders = response.headers ?? {};
						item.resourceType = eventParams?.type ?? item.resourceType;
						return;
					}

					if (method === "Network.loadingFinished") {
						const requestId = String(eventParams?.requestId ?? "");
						const item = records.get(requestId);
						if (!item) return;
						item.endTs = typeof eventParams?.timestamp === "number" ? eventParams.timestamp : undefined;
						item.finished = true;
						if (typeof eventParams?.encodedDataLength === "number") {
							item.encodedDataLength = eventParams.encodedDataLength;
						}
						return;
					}

					if (method === "Network.loadingFailed") {
						const requestId = String(eventParams?.requestId ?? "");
						const item = records.get(requestId);
						if (!item) return;
						item.failed = true;
						item.errorText = String(eventParams?.errorText ?? "Network request failed");
						item.endTs = typeof eventParams?.timestamp === "number" ? eventParams.timestamp : undefined;
					}
				});

				if (params.navigateUrl) {
					await client.send("Page.navigate", { url: params.navigateUrl });
					await waitForLoadEvent(client, 15000);
				}

				await sleep(durationMs);
				unsubscribe();

				const all = [...records.values()];
				const withDuration = all.map((item) => {
					const duration =
						typeof item.startTs === "number" && typeof item.endTs === "number"
							? Math.max(0, (item.endTs - item.startTs) * 1000)
							: undefined;
					return { ...item, durationMs: duration };
				});

				const failures = withDuration.filter((item) => item.failed || (item.status ?? 0) >= 400);
				const slowest = [...withDuration]
					.filter((item) => typeof item.durationMs === "number")
					.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
					.slice(0, 10);

				const outputPath = params.path ? resolve(ctx.cwd, params.path) : defaultHarPath(ctx.cwd);
				const startedDateTime = new Date(Math.min(...withDuration.map((item) => item.startWallTimeMs), Date.now())).toISOString();
				const har = {
					log: {
						version: "1.2",
						creator: { name: "pi-cdp-browser", version: "1.0" },
						pages: [
							{
								id: "page_1",
								startedDateTime,
								title: "CDP capture",
								pageTimings: {},
							},
						],
						entries: withDuration.map((item) => ({
							pageref: "page_1",
							startedDateTime: new Date(item.startWallTimeMs).toISOString(),
							time: item.durationMs ?? 0,
							request: {
								method: item.method,
								url: item.url,
								httpVersion: "",
								headers: Object.entries(item.requestHeaders ?? {}).map(([name, value]) => ({ name, value: String(value) })),
								queryString: [],
								cookies: [],
								headersSize: -1,
								bodySize: -1,
							},
							response: {
								status: item.status ?? 0,
								statusText: item.statusText ?? "",
								httpVersion: "",
								headers: Object.entries(item.responseHeaders ?? {}).map(([name, value]) => ({ name, value: String(value) })),
								cookies: [],
								content: {
									size: item.encodedDataLength ?? 0,
									mimeType: item.mimeType ?? "",
								},
								redirectURL: "",
								headersSize: -1,
								bodySize: item.encodedDataLength ?? -1,
							},
							cache: {},
							timings: {
								send: 0,
								wait: item.durationMs ?? 0,
								receive: 0,
							},
							_serverIPAddress: "",
							_connection: "",
						})),
					},
				};

				await withFileMutationQueue(outputPath, async () => {
					await mkdir(dirname(outputPath), { recursive: true });
					await writeFile(outputPath, JSON.stringify(har, null, 2), "utf8");
				});

				const lines = [
					`Network capture complete (${durationMs}ms).`,
					`Captured ${withDuration.length} requests. Failures: ${failures.length}.`,
					`HAR saved to: ${outputPath}`,
					"",
					"Top slow requests:",
					...slowest.map((item, index) => `[${index + 1}] ${Math.round(item.durationMs ?? 0)}ms ${item.status ?? 0} ${item.method} ${item.url}`),
					"",
					"Failures:",
					...failures.slice(0, 10).map((item, index) => `[${index + 1}] ${item.status ?? 0} ${item.method} ${item.url} ${item.errorText ?? ""}`.trim()),
				].join("\n");

				const truncated = truncateForPrompt(lines);
				return {
					content: [{ type: "text", text: truncated.text }],
					details: {
						durationMs,
						navigateUrl: params.navigateUrl,
						requestCount: withDuration.length,
						failureCount: failures.length,
						slowest,
						failures: failures.slice(0, 20),
						harPath: outputPath,
						truncated: truncated.truncated,
					},
				};
			});
		},
	});

	pi.registerTool({
		name: "cdp_perf_trace",
		label: "CDP Perf Trace",
		description: "Capture key performance metrics and timeline events for the active page over a short window.",
		parameters: Type.Object({
			durationMs: Type.Optional(Type.Number({ description: "How long to capture metrics", default: 5000 })),
			navigateUrl: Type.Optional(Type.String({ description: "Optional URL to navigate to before measuring" })),
		}),
		async execute(_toolCallId, params) {
			return await withActivePage(state, async (client) => {
				const durationMs = Math.max(500, Math.floor(params.durationMs ?? 5000));
				const timelineEvents: Array<{ name: string; duration?: number; ts?: number }> = [];

				await client.send("Performance.enable");
				try {
					await client.send("PerformanceTimeline.enable", {
						eventTypes: ["longtask", "largest-contentful-paint", "layout-shift"],
					});
				} catch {
					// Some Chrome/CDP versions may not expose PerformanceTimeline.
				}

				const unsubscribe = client.onEvent((method, eventParams) => {
					if (method !== "PerformanceTimeline.timelineEventAdded") return;
					const evt = eventParams?.event;
					if (!evt) return;
					timelineEvents.push({
						name: String(evt.name ?? "unknown"),
						duration: typeof evt.duration === "number" ? evt.duration : undefined,
						ts: typeof evt.time === "number" ? evt.time : undefined,
					});
				});

				if (params.navigateUrl) {
					await client.send("Page.navigate", { url: params.navigateUrl });
					await waitForLoadEvent(client, 20000);
				}

				const before = await client.send("Performance.getMetrics");
				await sleep(durationMs);
				const after = await client.send("Performance.getMetrics");
				unsubscribe();

				const toMap = (metrics: any): Record<string, number> => {
					const arr = Array.isArray(metrics?.metrics) ? metrics.metrics : [];
					const out: Record<string, number> = {};
					for (const metric of arr) {
						if (typeof metric?.name === "string" && typeof metric?.value === "number") {
							out[metric.name] = metric.value;
						}
					}
					return out;
				};

				const beforeMap = toMap(before);
				const afterMap = toMap(after);
				const delta = (name: string) => (afterMap[name] ?? 0) - (beforeMap[name] ?? 0);

				const longTasks = timelineEvents.filter((evt) => evt.name === "longtask");
				const lcpEvents = timelineEvents.filter((evt) => evt.name === "largest-contentful-paint");
				const clsEvents = timelineEvents.filter((evt) => evt.name === "layout-shift");
				const maxLongTask = Math.max(0, ...longTasks.map((evt) => evt.duration ?? 0));

				const lines = [
					`Performance capture complete (${durationMs}ms).`,
					`FCP: ${afterMap.FirstContentfulPaint ?? "n/a"}`,
					`LCP: ${afterMap.LargestContentfulPaint ?? "n/a"}`,
					`CLS: ${afterMap.CumulativeLayoutShift ?? "n/a"}`,
					`DOM Interactive: ${afterMap.DomInteractive ?? "n/a"}`,
					`TaskDuration Δ: ${delta("TaskDuration").toFixed(3)}s`,
					`ScriptDuration Δ: ${delta("ScriptDuration").toFixed(3)}s`,
					`LayoutDuration Δ: ${delta("LayoutDuration").toFixed(3)}s`,
					`Long tasks: ${longTasks.length} (max duration: ${maxLongTask.toFixed(2)}ms)`,
					`LCP events: ${lcpEvents.length}, Layout-shift events: ${clsEvents.length}`,
				].join("\n");

				return {
					content: [{ type: "text", text: lines }],
					details: {
						durationMs,
						navigateUrl: params.navigateUrl,
						metrics: afterMap,
						deltas: {
							TaskDuration: delta("TaskDuration"),
							ScriptDuration: delta("ScriptDuration"),
							LayoutDuration: delta("LayoutDuration"),
						},
						events: {
							longTaskCount: longTasks.length,
							maxLongTaskDuration: maxLongTask,
							lcpCount: lcpEvents.length,
							layoutShiftCount: clsEvents.length,
						},
						timelineEvents,
					},
				};
			});
		},
	});

	pi.registerTool({
		name: "cdp_screenshot",
		label: "CDP Screenshot",
		description: "Capture a PNG screenshot of the active page and save to disk.",
		promptSnippet: "Capture page screenshots when visual confirmation is needed.",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Output path (relative paths resolve from cwd)" })),
			fullPage: Type.Optional(Type.Boolean({ description: "Capture beyond viewport", default: true })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return await withActivePage(state, async (client) => {
				const screenshot = await client.send("Page.captureScreenshot", {
					format: "png",
					fromSurface: true,
					captureBeyondViewport: params.fullPage !== false,
				});

				const outputPath = params.path ? resolve(ctx.cwd, params.path) : defaultScreenshotPath(ctx.cwd);
				await withFileMutationQueue(outputPath, async () => {
					await mkdir(dirname(outputPath), { recursive: true });
					await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
				});

				return {
					content: [{ type: "text", text: `Saved screenshot to ${outputPath}` }],
					details: {
						path: outputPath,
						bytes: Buffer.byteLength(screenshot.data, "base64"),
						fullPage: params.fullPage !== false,
					},
				};
			});
		},
	});
}
