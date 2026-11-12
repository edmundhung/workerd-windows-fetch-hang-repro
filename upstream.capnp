using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [(name = "main", worker = .upstream)],
  # The address is overridden with --socket-addr.
  sockets = [(name = "http", address = "127.0.0.1:8081", http = (), service = "main")],
);

const upstream :Workerd.Worker = (
  modules = [(name = "upstream.js", esModule = embed "upstream.js")],
  compatibilityDate = "2026-11-01",
);
