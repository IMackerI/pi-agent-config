const endpoint = process.env.CDP_ENDPOINT?.trim() || "http://127.0.0.1:9222";

async function fetchJson(url: string, timeoutMs = 5000) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
		return await response.json();
	} finally {
		clearTimeout(timeout);
	}
}

try {
	const version = await fetchJson(`${endpoint.replace(/\/$/, "")}/json/version`);
	const targets = await fetchJson(`${endpoint.replace(/\/$/, "")}/json/list`);
	if (!Array.isArray(targets)) {
		throw new Error("/json/list did not return an array");
	}
	console.log(`CDP smoke OK: ${endpoint}`);
	console.log(`Browser: ${version?.Browser ?? "unknown"}`);
	console.log(`Targets: ${targets.length}`);
} catch (error: any) {
	console.log(`CDP smoke skipped: ${(error && error.message) || String(error)}`);
	console.log("Hint: start Chrome with --remote-debugging-port=9222");
	process.exit(0);
}
