# workerd: fetch() resends a GET after its upstream resets mid-request

Since `workerd@1.20261112.1`, when an upstream resets a reused keep-alive connection while a GET is in flight, workerd sends the GET again on a new connection instead of rejecting `fetch()`.

`repro.mjs` runs a proxy Worker in `workerd` that calls `fetch()` on an upstream over `127.0.0.1`, in four scenarios:

1. **upstream killed, fresh connection**: the upstream `workerd` process is killed while it holds the proxy's first request.
2. **upstream killed, reused connection**: the same, but the proxy first makes one quick request, so the in-flight request goes out on a pooled keep-alive connection.
3. **nothing listening on the port**: the proxy fetches a port that nothing listens on. This shows how long the OS takes to refuse a connection.
4. **upstream resets a reused connection mid-request**: a Node.js upstream answers one request, then resets the connection while it holds the second, and counts how many times the second request reaches it.

The script exits with code 1 if any scenario differs from `workerd@1.20261110.1`.

## Run

```sh
npm install
node repro.mjs
```

The [CI workflow](.github/workflows/repro.yml) runs the script on Linux, macOS and Windows against `workerd@1.20261110.1` and `workerd@1.20261112.1`.

## Results

From [CI run 43230416543](https://github.com/edmundhung/workerd-windows-fetch-hang-repro/actions/runs/43230416543):

| Scenario                                           | OS            | 1.20261110.1   | 1.20261112.1    |
| -------------------------------------------------- | ------------- | -------------- | --------------- |
| 2. upstream killed, reused connection              | Linux / macOS | rejects in 0–1ms | rejects in 1–3ms |
|                                                    | Windows       | rejects in 24ms | rejects in **2046ms** |
| 3. nothing listening on the port                   | Linux / macOS | rejects in 2–3ms | rejects in 2–3ms |
|                                                    | Windows       | rejects in 2035ms | rejects in 2050ms |
| 4. upstream resets a reused connection mid-request | all           | GET sent once  | GET sent **twice** |

Scenario 4 shows the resend on every OS. On Windows it also delays the rejection: when the upstream process is gone, the resend goes to a port that nothing listens on, and Windows takes about 2 seconds to refuse a loopback connection (scenario 3).

The resend looks like it comes from [cloudflare/workerd#8325](https://github.com/cloudflare/workerd/pull/8325). It resends a replayable request when a pooled connection that had already served a response closes or resets before answering. An upstream that crashes while handling the request also matches that check.

In Wrangler's local dev, the proxy Worker relies on this `fetch()` rejecting promptly when the user Worker's `workerd` process is replaced during a reload. On Windows, the 2-second delay made the `inflight requests are retried during UserWorker reloads` test in `cloudflare/workers-sdk` time out.
