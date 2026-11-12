export default {
	async fetch(request) {
		const { pathname } = new URL(request.url);
		if (pathname === "/long") {
			// Keep the request open so the process can be killed mid-request.
			await new Promise((resolve) => setTimeout(resolve, 30_000));
		}
		return new Response(`upstream ${pathname}`);
	},
};
