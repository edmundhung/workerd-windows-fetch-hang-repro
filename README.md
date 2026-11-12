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
