// Shows how workerd's fetch() behaves when its upstream goes away while a
// request is in flight, in four scenarios (see README.md).
//
// Exits with code 1 if any scenario differs from workerd 1.20261110.1.

import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import workerd from "workerd";

const workerdPath = workerd.default;

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
		[
			"serve",
			fileURLToPath(new URL(config, import.meta.url)),
			"--socket-addr",
			`http=127.0.0.1:${port}`,
		],
		{ stdio: ["ignore", "inherit", "inherit"] }
	);
	const exited = once(child, "exit");
	const url = `http://127.0.0.1:${port}`;

	const deadline = Date.now() + 10_000;
	for (;;) {
		try {
			await (await fetch(url)).text();
			break;
		} catch (error) {
			if (Date.now() > deadline) {
				throw new Error(`${config} did not start on ${url}`, { cause: error });
			}
			await sleep(100);
		}
	}
	return {
		url,
		async stop() {
			child.kill("SIGKILL");
			await exited;
		},
	};
}

/** Asks the proxy Worker to fetch() `target` and returns what it reports. */
async function viaProxy(proxy, target) {
	const response = await fetch(
		`${proxy.url}/?target=${encodeURIComponent(target)}`
	);
	return response.text();
}

/**
 * Kills the upstream workerd process while the proxy's fetch() to it is in
 * flight, and times how long that fetch() takes to reject.
 */
async function killUpstream({ reuseConnection }) {
	const upstream = await startWorkerd("upstream.capnp");
	const proxy = await startWorkerd("proxy.capnp");
	try {
		if (reuseConnection) {
			// Leaves a keep-alive connection in the proxy's pool.
			await viaProxy(proxy, `${upstream.url}/short`);
		}
		const inflight = viaProxy(proxy, `${upstream.url}/long`);
		await sleep(1_000);

		await upstream.stop();
		const killedAt = Date.now();
		const reply = await inflight;
		const elapsed = Date.now() - killedAt;
		return {
			scenario: `upstream killed, ${reuseConnection ? "reused" : "fresh"} connection`,
			result: `rejected ${elapsed}ms after the kill`,
			ok: reply.startsWith("fetch rejected") && elapsed < 1_000,
		};
	} finally {
		await proxy.stop();
	}
}

/** Times a fetch() to a port that nothing listens on. */
async function nothingListening() {
	const proxy = await startWorkerd("proxy.capnp");
	try {
		const start = Date.now();
		const reply = await viaProxy(proxy, `http://127.0.0.1:${await getFreePort()}/`);
		return {
			scenario: "nothing listening on the port",
			result: `rejected after ${Date.now() - start}ms`,
			// Informational: shows how long this OS takes to refuse a connection.
			ok: reply.startsWith("fetch rejected"),
		};
	} finally {
		await proxy.stop();
	}
}

/**
 * Uses a Node.js upstream that resets the connection while it holds /long,
 * and counts how many times /long reaches it.
 */
async function resetMidRequest() {
	let longRequests = 0;
	const upstream = createHttpServer((request, response) => {
		if (request.url === "/long") {
			longRequests++;
			setTimeout(() => request.socket.resetAndDestroy(), 500);
			return;
		}
		response.end("short");
	});
	upstream.listen(0, "127.0.0.1");
	await once(upstream, "listening");
	const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

	const proxy = await startWorkerd("proxy.capnp");
	try {
		// Leaves a keep-alive connection in the proxy's pool.
		await viaProxy(proxy, `${upstreamUrl}/short`);
		const reply = await viaProxy(proxy, `${upstreamUrl}/long`);
		return {
			scenario: "upstream resets a reused connection mid-request",
			result: `/long reached the upstream ${longRequests} time(s)`,
			ok: reply.startsWith("fetch rejected") && longRequests === 1,
		};
	} finally {
		await proxy.stop();
		upstream.closeAllConnections();
		upstream.close();
	}
}

const version = execFileSync(workerdPath, ["--version"]).toString().trim();
console.log(`${version} on ${process.platform}/${process.arch}`);

const results = [
	await killUpstream({ reuseConnection: false }),
	await killUpstream({ reuseConnection: true }),
	await nothingListening(),
	await resetMidRequest(),
];
console.table(results);

if (results.some((result) => !result.ok)) {
	console.error("FAIL: behaviour differs from workerd 1.20261110.1");
	process.exit(1);
}
