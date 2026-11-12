# workerd: fetch() to a killed upstream hangs on Windows

`repro.mjs` starts two `workerd` processes: a proxy Worker that calls `fetch()` on an upstream Worker over `127.0.0.1`. While a request to the upstream is in flight, the script kills the upstream process and measures how long the proxy's `fetch()` takes to settle.

It runs two scenarios:

- **fresh connection**: the in-flight request is the first one on its connection.
- **reused connection**: the proxy first makes one quick request, so the in-flight request goes out on a pooled keep-alive connection.

The script exits with code 1 if the proxy's `fetch()` does not settle within 10 seconds of the kill.

## Run

```sh
npm install
node repro.mjs
```

The [CI workflow](.github/workflows/repro.yml) runs the script on Linux, macOS and Windows against `workerd@1.20261110.1` and `workerd@1.20261112.1`.
