// Kills an upstream workerd process while a proxy workerd process has a
// fetch() to it in flight, and reports how long that fetch() takes to settle.
//
// "reused connection": the in-flight request goes out on a keep-alive
// connection that already served a response.
// "fresh connection": the in-flight request is the connection's first.
//
// Exits with code 1 if the proxy's fetch() does not settle within
// SETTLE_LIMIT_MS of the upstream being killed.

import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import workerd from "workerd";

const workerdPath = workerd.default;
const SETTLE_LIMIT_MS = Number(process.env.SETTLE_LIMIT_MS ?? 10_000);
const WAIT_LIMIT_MS = Number(process.env.WAIT_LIMIT_MS ?? 60_000);

function configPath(name) {
	return fileURLToPath(new URL(name, import.meta.url));
}

async function getFreePort() {
	const server = createServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const { port } = server.address();
	server.close();
	await once(server, "close");
	return port;
}

async function startWorkerd(config) {
	const port = await getFreePort();
	const child = spawn(
		workerdPath,
		["serve", configPath(config), "--socket-addr", `http=127.0.0.1:${port}`],
		{ stdio: ["ignore", "inherit", "inherit"] }
	);
	const exited = once(child, "exit");
	const url = `http://127.0.0.1:${port}`;

	const deadline = Date.now() + 10_000;
	for (;;) {
		try {
			const response = await fetch(url);
			await response.text();
			break;
		} catch (error) {
			if (Date.now() > deadline) {
				throw new Error(`${config} did not start on ${url}`, { cause: error });
			}
			await sleep(100);
		}
	}
	return { child, exited, url };
}

async function runScenario(name, reuseConnection) {
	const upstream = await startWorkerd("upstream.capnp");
	const proxy = await startWorkerd("proxy.capnp");
	const viaProxy = (path) =>
		`${proxy.url}/?target=${encodeURIComponent(upstream.url + path)}`;

	try {
		if (reuseConnection) {
			// Leaves a keep-alive connection in the proxy's pool.
			const response = await fetch(viaProxy("/short"));
			console.log(`  warm-up: ${await response.text()}`);
		}

		const inflight = fetch(viaProxy("/long")).then(
			async (response) => response.text(),
			(error) => `request to proxy failed: ${error}`
		);
		await sleep(1_000);

		upstream.child.kill("SIGKILL");
		await upstream.exited;
		const killedAt = Date.now();
		console.log("  upstream killed");

		const result = await Promise.race([
			inflight,
			sleep(WAIT_LIMIT_MS).then(() => undefined),
		]);
		const elapsed = Date.now() - killedAt;
		const passed = result !== undefined && elapsed <= SETTLE_LIMIT_MS;
		console.log(
			result === undefined
				? `  proxy fetch() still pending ${elapsed}ms after the kill`
				: `  proxy says: ${result}`
		);
		return { scenario: name, settledAfterKillMs: elapsed, passed };
	} finally {
		proxy.child.kill("SIGKILL");
		await proxy.exited;
	}
}

const version = execFileSync(workerdPath, ["--version"]).toString().trim();
console.log(`${version} on ${process.platform}/${process.arch}\n`);

const results = [];
for (const [name, reuse] of [
	["fresh connection", false],
	["reused connection", true],
]) {
	console.log(`${name}:`);
	results.push(await runScenario(name, reuse));
	console.log();
}
console.table(results);

if (results.some((result) => !result.passed)) {
	console.error(
		`FAIL: the proxy's fetch() did not settle within ${SETTLE_LIMIT_MS}ms of the upstream being killed`
	);
	process.exit(1);
}
