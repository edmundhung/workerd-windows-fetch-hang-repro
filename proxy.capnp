using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .proxy),
    # Allow fetch() to reach the upstream on 127.0.0.1.
    (name = "internet", network = (allow = ["public", "private", "local"])),
  ],
  # The address is overridden with --socket-addr.
  sockets = [(name = "http", address = "127.0.0.1:8080", http = (), service = "main")],
);

const proxy :Workerd.Worker = (
  modules = [(name = "proxy.js", esModule = embed "proxy.js")],
  compatibilityDate = "2026-11-01",
  globalOutbound = "internet",
);
