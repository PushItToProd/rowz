# Import and review

[scripts/import-rowz.js](../../../../scripts/import-rowz.js) uses the current repository schema and engine. Run with Node 24 and installed repository dependencies. It resolves tsx from the server package, so invoking it from another current directory is supported.

## Credentials

Read an existing `.rowz-credential.local` as JSON. Search order is:

1. Current working directory.
2. Root of the current Git repository, found with a read-only Git command.
3. User's home directory.

An explicit `--credentials FILE` replaces this search. The first existing file must be readable and valid; an invalid file is not silently skipped. Never print its contents or put its password in command arguments, generated documents, or reports.

Expected contents:

```json
{
  "username": "you@example.com",
  "password": "your password",
  "url": "http://localhost:5173"
}
```

Rowz signs in with an email address; `username` must contain that account email. `email` is accepted as an alternative key. `url` is optional. The app origin is selected from `--url`, credential `url`, environment `BASE_URL`, then `http://localhost:5173`. The helper does not read `.env.local` automatically. Supply the actual app origin when it differs from the default.

The repository ignores `.rowz-credential.local`. The user can restrict a credential file's access with `chmod 600 .rowz-credential.local`. Do not create or overwrite the user's credential file unless asked.

## Usage

From the repository root:

```sh
node scripts/import-rowz.js samples/example.json --url https://rowz.example.com
```

The example hostname denotes the user's configured app; choose their actual URL. Use `--help` to inspect options. The URL must be an HTTP(S) origin with no embedded credentials or path.

The helper:

1. Parses JSON and checks the `spreadsheetFile` schema locally.
2. Signs in at `/api/auth/sign-in/email`, keeping cookies in memory.
3. Sends the trusted Origin header and imports at `/api/spreadsheets/import`. The server applies its import checks.
4. Prints the new document ID and editor URL immediately.
5. Retrieves `/api/spreadsheets/:id`, converts stable IDs using the repository's Contents class, and runs documentErrors with the current engine.

Diagnostics cover evaluated cells, names, scripts, assertions, filters, charts, text expressions, and action planning where supported by the app's collector. They never execute action effects. The engine uses its default current clock; samples needing reproducible dates should use an explicit editable reference date.

Exit status is 0 for no engine errors, 2 for document errors, and 1 for an operational failure. A successfully imported document remains available even when diagnostics fail. Each invocation creates a new document; there is no automatic retry, overwrite, or deletion. If the import request loses its response, inspect the document list before retrying because it might have succeeded.

The helper follows normal TLS certificate verification. If app access fails because of sandbox restrictions, report the restriction and request configuration help; do not bypass it. If setup is unavailable, stop pursuing API validation and ask the user to import the JSON in the web UI.

## User review

Ask the user to open the returned URL, or use Import on the document list if the helper was not run. Give them one specific interaction and its expected result. They should inspect layout, readable formatting, choices, error explanations, record changes, and the resulting report. Email actions need their configured SMTP service for delivery.

Do not describe a clean diagnostic result as complete behavioral validation. The helper does not check rendering, business-rule correctness, click effects, email delivery, or usability. Button exercises, especially external side effects, belong to an explicitly requested interaction check.
