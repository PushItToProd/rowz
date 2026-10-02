import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDirectory = join(root, "apps/server/drizzle");
const metadataDirectory = join(migrationDirectory, "meta");
const journalPath = join(metadataDirectory, "_journal.json");
const checksumsPath = join(metadataDirectory, "_checksums.json");

function fail(message) {
  console.error(`Migration checksum check failed: ${message}`);
  process.exitCode = 1;
}

const journal = JSON.parse(await readFile(journalPath, "utf8"));
const checksums = JSON.parse(await readFile(checksumsPath, "utf8"));

if (!Array.isArray(journal.entries) || !Array.isArray(checksums.entries)) {
  fail("the journal and checksum manifest must contain entries arrays");
  process.exit();
}

const journalTags = journal.entries.map(({ tag }) => tag);
const checksumTags = checksums.entries.map(({ tag }) => tag);

if (new Set(journalTags).size !== journalTags.length) {
  fail("the journal contains duplicate migration tags");
}

if (JSON.stringify(checksumTags) !== JSON.stringify(journalTags)) {
  fail("checksum entries must match journal tags in order; add entries only for new migrations");
}

const sqlFiles = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
const journalFiles = journalTags.map((tag) => `${tag}.sql`).sort();

if (JSON.stringify(sqlFiles) !== JSON.stringify(journalFiles)) {
  fail("SQL migration files must match the journal exactly (no missing or unjournaled files)");
}

for (const { tag, sha256 } of checksums.entries) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    fail(`${tag} has an invalid SHA-256 checksum`);
    continue;
  }

  const contents = await readFile(join(migrationDirectory, `${tag}.sql`));
  const actual = createHash("sha256").update(contents).digest("hex");
  if (actual !== sha256) {
    fail(`${tag}.sql changed; add a new migration instead of updating an existing migration`);
  }
}

if (process.exitCode !== 1) {
  console.log(`Checked ${journalTags.length} migration checksums.`);
}
