import { describe, expect, it } from "vitest";
import { firstConversation, modelsLabel, sessionIdentity } from "../src/lib/session";
import { HOME, formatRoute, parentRoute, parseRoute, routeSession, type Route } from "../src/lib/route";
import type { EntrySummary, RequestRecord } from "../src/types";

describe("the address of a place in the dashboard", () => {
  const places: [string, Route][] = [
    ["#/", { view: "sessions", tab: "sessions" }],
    ["#/usage", { view: "sessions", tab: "usage" }],
    ["#/s/2026-11-23T23-34-32-264", { view: "session", session: "2026-11-23T23-34-32-264", tab: "replay" }],
    ["#/s/a/usage", { view: "session", session: "a", tab: "usage" }],
    ["#/s/a/r/4", { view: "request", session: "a", seq: 4, tab: undefined }],
    ["#/s/a/r/4/messages", { view: "request", session: "a", seq: 4, tab: "messages" }],
    ["#/s/a/r/4/compare/3", { view: "compare", session: "a", seq: 4, base: 3 }],
    ["#/s/a/r/4/compare", { view: "compare", session: "a", seq: 4, base: undefined }],
  ];

  it("reads back every address it writes", () => {
    for (const [hash, route] of places) {
      expect(parseRoute(hash)).toEqual(route);
      expect(formatRoute(route)).toBe(hash);
    }
  });

  it("leads anything it does not understand to the nearest place that exists", () => {
    expect(parseRoute("")).toEqual(HOME);
    expect(parseRoute("#content")).toEqual(HOME);
    expect(parseRoute("#/s")).toEqual(HOME);
    expect(parseRoute("#/s/a/r/nope")).toEqual({ view: "session", session: "a", tab: "replay" });
    expect(parseRoute("#/s/a/r/0")).toEqual({ view: "session", session: "a", tab: "replay" });
    // An unknown tab is no tab: the request decides where it opens.
    expect(parseRoute("#/s/a/r/4/flow")).toEqual({ view: "request", session: "a", seq: 4 });
    expect(parseRoute("#/s/a%2Fb/r/4")).toMatchObject({ session: "a/b", seq: 4 });
    expect(formatRoute({ view: "session", session: "a/b", tab: "replay" })).toBe("#/s/a%2Fb");
  });

  it("goes one level up at a time", () => {
    const compare = parseRoute("#/s/a/r/4/compare/3");
    const request = parentRoute(compare)!;
    expect(formatRoute(request)).toBe("#/s/a/r/4");
    const session = parentRoute(request)!;
    expect(formatRoute(session)).toBe("#/s/a");
    expect(parentRoute(session)).toEqual(HOME);
    expect(parentRoute(HOME)).toBeNull();
    expect(routeSession(compare)).toBe("a");
    expect(routeSession(HOME)).toBeNull();
  });
});

describe("what tells one session from another", () => {
  const entry = (seq: number, extra: Partial<EntrySummary> = {}): EntrySummary => ({
    id: `s/${seq}`,
    session: "s",
    seq,
    ts: seq,
    status: 200,
    ...extra,
  });
  const asked: RequestRecord = {
    id: "s/2",
    seq: 2,
    model: "big",
    request: { body: { model: "big" } },
    parsed: {
      view: { system: [], tools: [], messages: [{ role: "user", type: "text", text: "what time is it?" }] },
    },
  };

  it("counts requests, models and how they ended, and quotes the first prompt", () => {
    const entries = [
      entry(1, { method: "GET", url: "/v1/models" }),
      entry(2, { model: "big", nMessages: 1 }),
      entry(3, { model: "small", nMessages: 2, status: 500 }),
      entry(4, { model: "big", nMessages: 3, status: null, error: "client disconnected" }),
    ];
    // A model listing carries no conversation, so it is not where the session starts.
    expect(firstConversation(entries)?.id).toBe("s/2");
    expect(sessionIdentity(entries, asked)).toEqual({
      requests: 4,
      models: ["big", "small"],
      failed: 1,
      cancelled: 1,
      prompt: "what time is it?",
    });
    expect(sessionIdentity([], null)).toEqual({
      requests: 0,
      models: [],
      failed: 0,
      cancelled: 0,
      prompt: null,
    });
  });

  it("names one model and counts several", () => {
    expect(modelsLabel([])).toBe("");
    expect(modelsLabel(["big"])).toBe("big");
    expect(modelsLabel(["big", "small"])).toBe("2 models");
  });
});
