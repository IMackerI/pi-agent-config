const key = process.env.BRAVE_SEARCH_API_KEY?.trim();

if (!key) {
	console.log("Brave smoke skipped: BRAVE_SEARCH_API_KEY is not set.");
	process.exit(0);
}

const query = process.env.BRAVE_SMOKE_QUERY?.trim() || "site:developer.mozilla.org fetch api";
const url = new URL("https://api.search.brave.com/res/v1/web/search");
url.searchParams.set("q", query);
url.searchParams.set("count", "3");

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 12000);

try {
	const response = await fetch(url.toString(), {
		headers: {
			Accept: "application/json",
			"X-Subscription-Token": key,
		},
		signal: controller.signal,
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`);
	}

	const payload = await response.json();
	const results = payload?.web?.results;
	if (!Array.isArray(results)) {
		throw new Error("Missing web.results[] in Brave response");
	}

	console.log(`Brave smoke OK: ${results.length} result(s) for '${query}'.`);
} catch (error: any) {
	if (error?.name === "AbortError") {
		console.error("Brave smoke failed: request timed out.");
		process.exit(1);
	}
	console.error(`Brave smoke failed: ${(error && error.message) || String(error)}`);
	process.exit(1);
} finally {
	clearTimeout(timeout);
}
