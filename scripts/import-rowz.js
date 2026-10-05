import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createSecureContext, getCACertificates, setDefaultCACertificates } from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const credentialName = ".rowz-credential.local";

async function credentials(explicitPath) {
  let gitRoot;
  try {
    gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // The helper also works when invoked outside a Git checkout.
  }
  const candidates = explicitPath
    ? [resolve(explicitPath)]
    : [...new Set([process.cwd(), gitRoot, homedir()].filter(Boolean))].map((directory) =>
        join(directory, credentialName),
      );
  for (const candidate of candidates) {
    let contents;
    try {
      contents = await readFile(candidate, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error(`Cannot read credential file: ${candidate}`, { cause: error });
    }
    let account;
    try {
      account = JSON.parse(contents);
    } catch {
      throw new Error(`Credential file must contain JSON: ${candidate}`);
    }
    const email = account?.username ?? account?.email;
    if (typeof email !== "string" || !email.trim() || typeof account?.password !== "string") {
      throw new Error("Credentials need username (the account email) and password strings.");
    }
    if (!account.password) throw new Error("Credential password must not be empty.");
    if (
      account.tls !== undefined &&
      (account.tls === null || typeof account.tls !== "object" || Array.isArray(account.tls))
    ) {
      throw new Error('Credential field "tls" must be an object.');
    }
    if (
      account.tls?.rejectUnauthorized !== undefined &&
      typeof account.tls.rejectUnauthorized !== "boolean"
    ) {
      throw new Error('Credential field "tls.rejectUnauthorized" must be a boolean.');
    }
    if (
      account.tls?.caFile !== undefined &&
      (typeof account.tls.caFile !== "string" || !account.tls.caFile.trim())
    ) {
      throw new Error('Credential field "tls.caFile" must be a non-empty PEM file path.');
    }
    let tlsCa;
    if (account.tls?.caFile && account.tls.rejectUnauthorized !== false) {
      const caFile = resolve(dirname(candidate), account.tls.caFile);
      try {
        tlsCa = { file: caFile, certificate: await readFile(caFile, "utf8") };
      } catch (error) {
        throw new Error(`Cannot read TLS certificate file: ${caFile}`, { cause: error });
      }
      if (!tlsCa.certificate.trim()) {
        throw new Error(`TLS certificate file is empty: ${caFile}`);
      }
    }
    return {
      email: email.trim(),
      password: account.password,
      url: account.url,
      tlsCa,
      insecureTls: account.tls?.rejectUnauthorized === false,
    };
  }
  throw new Error(
    explicitPath
      ? `Credential file not found: ${resolve(explicitPath)}`
      : `No ${credentialName} found in the current directory, Git root, or home.`,
  );
}

function requestFailure(path, error) {
  const causes = [];
  for (let cause = error; cause && !causes.includes(cause); cause = cause.cause) {
    causes.push(cause);
  }
  const code = causes.find((cause) => cause.code)?.code;
  let detail;
  switch (code) {
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
    case "CERT_UNTRUSTED":
      detail =
        `TLS rejected an untrusted certificate (${code}). Add its PEM file to the credentials JSON as ` +
        '"tls": { "caFile": "/path/to/server-cert.pem" }. The helper will trust that certificate and still check the URL hostname.';
      break;
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      detail =
        "The TLS certificate does not match the hostname in the app URL. Use the hostname listed in the certificate or fix the server certificate.";
      break;
    case "CERT_HAS_EXPIRED":
      detail = "The app's TLS certificate has expired. Renew or replace it on the server.";
      break;
    case "ENOTFOUND":
    case "EAI_AGAIN":
      detail = `DNS could not resolve the app hostname (${code}). Check the hostname and DNS configuration.`;
      break;
    case "ECONNREFUSED":
      detail =
        "The app refused the connection. Check that it is running and that the URL has the right host and port.";
      break;
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      detail =
        "The connection timed out. Check that the app is reachable at this URL and that network policy allows the connection.";
      break;
    case "ECONNRESET":
      detail =
        "The connection closed unexpectedly. Check the app server and any reverse proxy in front of it.";
      break;
    case "EPERM":
    case "EACCES":
      detail = `The network connection was denied (${code}) by the current environment or local policy.`;
      break;
    default: {
      const cause = causes.find((item) => item !== error) ?? error;
      const reason = cause.code ? `${cause.code}: ${cause.message}` : cause.message;
      detail = reason ? `Underlying error: ${reason}` : "The network request failed.";
    }
  }
  return new Error(
    `Request to ${path} failed. ${detail} ` +
      (path === "/spreadsheets/import"
        ? "Import outcome is unknown; inspect the document list before trying again."
        : "No automatic retry was made."),
    { cause: error },
  );
}

/** Import one new document and evaluate its snapshot. Does not click buttons. */
export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      credentials: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: node scripts/import-rowz.js <document.json> [--url APP_URL] [--credentials FILE]\n" +
        'Credentials: {"username":"you@example.com","password":"...","url":"https://rowz.example.com","tls":{"rejectUnauthorized":false}}\n' +
        "Set tls.rejectUnauthorized to false to disable all TLS certificate checks. Optional tls.caFile trusts a PEM certificate; relative paths resolve from the credentials file.\n" +
        "Search order: current directory, current Git root, home. URL order: --url, credential url, BASE_URL, localhost:5173.\n" +
        "Creates one document, reports its URL and engine errors, and leaves it for UI review. Exit: 0 clean, 2 document errors, 1 failure.",
    );
    return 0;
  }
  if (positionals.length !== 1) throw new Error("Give exactly one document JSON path; see --help.");

  // tsx belongs to the server package. Resolve it there regardless of the caller's cwd.
  const require = createRequire(join(repository, "apps/server/package.json"));
  const { register } = await import(pathToFileURL(require.resolve("tsx/esm/api")).href);
  const unregister = register();
  try {
    const { spreadsheetFile } = await import(
      pathToFileURL(join(repository, "packages/shared/src/index.ts")).href
    );
    const file = spreadsheetFile.parse(JSON.parse(await readFile(resolve(positionals[0]), "utf8")));
    const account = await credentials(values.credentials);
    if (account.insecureTls) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      console.warn(
        "Warning: TLS certificate validation is disabled for requests from this process.",
      );
    } else if (account.tlsCa) {
      try {
        createSecureContext({ ca: account.tlsCa.certificate });
        setDefaultCACertificates([...getCACertificates(), account.tlsCa.certificate]);
      } catch (error) {
        throw new Error(
          `Cannot trust TLS certificate file ${account.tlsCa.file}: ${error.message}`,
          { cause: error },
        );
      }
    }
    const base = new URL(
      values.url ?? account.url ?? process.env.BASE_URL ?? "http://localhost:5173",
    );
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
      throw new Error("The app URL must use HTTP or HTTPS and contain no credentials.");
    }
    if (base.pathname !== "/" || base.search || base.hash) {
      throw new Error("Give the app origin, such as https://rowz.example.com, without a path.");
    }
    let cookie = "";
    const request = async (path, body, signingIn = false) => {
      let response;
      try {
        response = await fetch(new URL(`/api${path}`, base), {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Origin: base.origin,
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        throw requestFailure(path, error);
      }
      if (!response.ok) {
        if (signingIn) throw new Error(`Sign-in failed (HTTP ${response.status}).`);
        const text = await response.text();
        throw new Error(`${path} failed (HTTP ${response.status}): ${text.slice(0, 2000)}`);
      }
      if (signingIn) {
        cookie = response.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        if (!cookie) throw new Error("Sign-in returned no session cookie.");
      }
      return response.json();
    };
    await request(
      "/auth/sign-in/email",
      { email: account.email, password: account.password, rememberMe: false },
      true,
    );
    const imported = await request("/spreadsheets/import", file);
    if (typeof imported.id !== "string") throw new Error("Import returned no document ID.");
    const url = new URL(`/s/${imported.id}`, base).href;
    console.log(`Imported: ${file.name}\nDocument ID: ${imported.id}\nOpen: ${url}`);
    const snapshot = await request(`/spreadsheets/${imported.id}`);
    const { Contents } = await import(
      pathToFileURL(join(repository, "apps/server/src/repo/contents.ts")).href
    );
    const { createWorkbook, documentErrors } = await import(
      pathToFileURL(join(repository, "packages/engine/src/index.ts")).href
    );
    const { data } = new Contents(snapshot);
    const errors = documentErrors(createWorkbook(data), data.tables, data.views);
    for (const error of errors) console.error(`${error.label}: ${error.code} ${error.message}`);
    console.log(
      errors.length
        ? `Found ${errors.length} document errors. The imported document remains available for review.`
        : "No engine document errors found. Check layout, controls, and intended button behavior in the web UI.",
    );
    return errors.length ? 2 : 0;
  } finally {
    unregister();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
