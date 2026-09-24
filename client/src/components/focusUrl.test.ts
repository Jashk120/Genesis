import { describe, expect, it } from "vitest";
import { docUrl, focusUrl, parseAppUrl } from "./focusUrl";

describe("docUrl", () => {
  it("builds a plain page url", () => {
    expect(docUrl("p1")).toBe("/doc/p1");
  });

  it("encodes the page id", () => {
    expect(docUrl("a/b")).toBe("/doc/a%2Fb");
  });
});

describe("focusUrl", () => {
  it("builds a focused passage url", () => {
    expect(focusUrl("p1", { from: "b1", to: "b2" })).toBe("/doc/p1/view?from=b1&to=b2");
  });

  it("encodes page and block ids", () => {
    expect(focusUrl("a/b", { from: "x y", to: "z" })).toBe("/doc/a%2Fb/view?from=x%20y&to=z");
  });
});

describe("parseAppUrl", () => {
  it("returns nulls for the root", () => {
    expect(parseAppUrl("/", "")).toEqual({ pageId: null, focus: null });
  });

  it("parses a plain page url", () => {
    expect(parseAppUrl("/doc/p1", "")).toEqual({ pageId: "p1", focus: null });
  });

  it("tolerates a trailing slash", () => {
    expect(parseAppUrl("/doc/p1/", "")).toEqual({ pageId: "p1", focus: null });
  });

  it("parses a focused passage url", () => {
    expect(parseAppUrl("/doc/p1/view", "?from=b1&to=b2")).toEqual({
      pageId: "p1",
      focus: { from: "b1", to: "b2" },
    });
  });

  it("returns no focus when the scope is missing", () => {
    expect(parseAppUrl("/doc/p1/view", "")).toEqual({ pageId: "p1", focus: null });
  });

  it("returns no focus when one side is missing", () => {
    expect(parseAppUrl("/doc/p1/view", "?from=b1")).toEqual({ pageId: "p1", focus: null });
  });

  it("returns no focus when a side is empty", () => {
    expect(parseAppUrl("/doc/p1/view", "?from=&to=b2")).toEqual({ pageId: "p1", focus: null });
  });

  it("decodes encoded ids", () => {
    expect(parseAppUrl("/doc/a%2Fb/view", "?from=x%20y&to=z")).toEqual({
      pageId: "a/b",
      focus: { from: "x y", to: "z" },
    });
  });

  it("returns nulls for an unknown subpath", () => {
    expect(parseAppUrl("/doc/p1/other", "")).toEqual({ pageId: null, focus: null });
  });

  it("returns nulls for a non-doc path", () => {
    expect(parseAppUrl("/nope", "")).toEqual({ pageId: null, focus: null });
  });

  it("returns nulls for an empty id", () => {
    expect(parseAppUrl("/doc/", "")).toEqual({ pageId: null, focus: null });
  });

  it("does not throw on a malformed percent-escape", () => {
    expect(parseAppUrl("/doc/%", "")).toEqual({ pageId: null, focus: null });
  });
});
