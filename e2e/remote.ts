// Runs the end-to-end tests with the browser in the Playwright container of
// compose.yaml: `pnpm e2e:remote`, which passes its arguments to `playwright test`.
//
// Where the container's port cannot be reached directly but an HTTP proxy can
// reach it, as in the Claude Code sandbox, this listens on a local port and
// sends each connection through the proxy. Playwright cannot do that itself:
// its WebSocket client ignores HTTP_PROXY.
import { spawn } from "node:child_process";
import { connect, createServer, type AddressInfo, type Socket } from "node:net";

const HOST = "127.0.0.1";
// The port compose.yaml publishes the Playwright server on.
const PORT = 3200;

function connectDirectly(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(PORT, HOST);
    socket.once("connect", () => {
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

/** Opens a connection to the container with an HTTP CONNECT request to the proxy. */
function connectThrough(proxy: URL): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(proxy.port), proxy.hostname);
    const target = `${HOST}:${String(PORT)}`;
    const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
    let received = Buffer.alloc(0);

    const onData = (chunk: Buffer): void => {
      received = Buffer.concat([received, chunk]);
      const end = received.indexOf("\r\n\r\n");
      if (end === -1) return;
      socket.off("data", onData);
      const status = received.toString("latin1", 0, received.indexOf("\r\n"));
      if (!/^HTTP\/1\.[01] 2\d\d/.test(status)) {
        socket.destroy();
        reject(new Error(`the proxy answered "${status}"`));
        return;
      }
      // What follows the proxy's answer already belongs to the tunnel.
      socket.pause();
      socket.unshift(received.subarray(end + 4));
      resolve(socket);
    };

    socket.on("data", onData);
    socket.once("error", reject);
    socket.write(
      `CONNECT ${target} HTTP/1.1\r\n` +
        `Host: ${target}\r\n` +
        (proxy.username === ""
          ? ""
          : `Proxy-Authorization: Basic ${Buffer.from(credentials).toString("base64")}\r\n`) +
        "\r\n",
    );
  });
}

/** Listens on a local port and sends each connection through the proxy. Resolves to the port. */
function forwardThrough(proxy: URL): Promise<number> {
  const server = createServer((client) => {
    connectThrough(proxy).then(
      (upstream) => {
        client.on("error", () => upstream.destroy());
        upstream.on("error", () => client.destroy());
        client.pipe(upstream);
        upstream.pipe(client);
      },
      () => client.destroy(),
    );
  });
  // Does not keep the process alive once the tests have finished.
  server.unref();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The port to reach the Playwright server on: its own, or a forwarder's. */
async function reachablePort(): Promise<number> {
  let directFailure: string;
  try {
    (await connectDirectly()).destroy();
    return PORT;
  } catch (error) {
    directFailure = message(error);
  }

  const proxyUrl = process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (proxyUrl === undefined || proxyUrl === "") {
    throw new Error(
      `No Playwright server at ${HOST}:${String(PORT)} (${directFailure}). ` +
        "Start it with `docker compose up --detach playwright`.",
    );
  }
  const proxy = new URL(proxyUrl);
  try {
    (await connectThrough(proxy)).destroy();
  } catch (error) {
    throw new Error(
      `No Playwright server at ${HOST}:${String(PORT)}, directly (${directFailure}) ` +
        `or through the proxy at ${proxy.host} (${message(error)}). ` +
        "Start it with `docker compose up --detach playwright`, " +
        "and check that the proxy allows that address.",
      { cause: error },
    );
  }
  return forwardThrough(proxy);
}

let port: number;
try {
  port = await reachablePort();
} catch (error) {
  console.error(message(error));
  process.exit(1);
}

const tests = spawn("playwright", ["test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    PW_TEST_CONNECT_WS_ENDPOINT: `ws://${HOST}:${String(port)}/`,
    // The servers under test are on this machine, which the container has no
    // route to. This sends the browser's requests for localhost back through
    // the test runner.
    PW_TEST_CONNECT_EXPOSE_NETWORK: "<loopback>",
  },
});
tests.once("error", (error) => {
  console.error(`Could not start Playwright: ${error.message}`);
  process.exit(1);
});
tests.once("exit", (code) => {
  process.exit(code ?? 1);
});
