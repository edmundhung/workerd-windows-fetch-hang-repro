export default {
	async fetch(request) {
		const target = new URL(request.url).searchParams.get("target");
		if (target === null) {
			return new Response("ready");
		}

		const start = Date.now();
		try {
			const response = await fetch(target);
			const body = await response.text();
			return new Response(
				`fetch resolved after ${Date.now() - start}ms: ${response.status} ${body}`
			);
		} catch (error) {
			return new Response(
				`fetch rejected after ${Date.now() - start}ms: ${error}`,
				{ status: 502 }
			);
		}
	},
};
