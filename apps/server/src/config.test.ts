import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config";
import { ApiFailure, isUniqueViolation } from "./errors";
import { logMailer } from "./mail/mailer";

describe("loadConfig", () => {
  it("works with no variables set in development", () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      databaseUrl: ".data/pglite",
      authSecret: expect.any(String),
      baseUrl: "http://localhost:5173",
      emailRunsPerHour: 20,
    });
  });

  it("reads every variable", () => {
    expect(
      loadConfig({
        NODE_ENV: "production",
        PORT: "8080",
        DATABASE_URL: "postgres://db/app",
        AUTH_SECRET: "s3cret",
        BASE_URL: "https://sheets.example.com",
        EMAIL_RUNS_PER_HOUR: "0",
      }),
    ).toEqual({
      port: 8080,
      databaseUrl: "postgres://db/app",
      authSecret: "s3cret",
      baseUrl: "https://sheets.example.com",
      emailRunsPerHour: 0,
    });
  });

  it.each([{}, { AUTH_SECRET: "" }])("refuses to start in production without a secret", (env) => {
    expect(() => loadConfig({ NODE_ENV: "production", ...env })).toThrow(
      "AUTH_SECRET must be set in production",
    );
  });

  it.each(["abc", "-1", "1.5"])("rejects the port %j", (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow("PORT must be a whole number");
  });

  it("treats an empty number as unset", () => {
    expect(loadConfig({ PORT: "" }).port).toBe(3000);
  });
});

describe("logMailer", () => {
  it("writes the message as one JSON line and delivers nothing", async () => {
    const log = vi.fn();
    await logMailer(log).send({ to: ["a@b.co"], cc: [], subject: "Hi", body: "Line 1\nLine 2" });
    expect(log).toHaveBeenCalledExactlyOnceWith(
      '{"event":"email","to":["a@b.co"],"cc":[],"subject":"Hi","body":"Line 1\\nLine 2"}',
    );
  });
});

describe("isUniqueViolation", () => {
  const violation = Object.assign(new Error("duplicate key"), { code: "23505" });

  it("recognizes the database error directly and when wrapped", () => {
    expect(isUniqueViolation(violation)).toBe(true);
    expect(isUniqueViolation(new Error("query failed", { cause: violation }))).toBe(true);
  });

  it("rejects other errors and non-errors", () => {
    expect(isUniqueViolation(Object.assign(new Error("fk"), { code: "23503" }))).toBe(false);
    expect(isUniqueViolation(new ApiFailure(409, "conflict", "x"))).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
