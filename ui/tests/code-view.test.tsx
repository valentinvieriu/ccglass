import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { CodeView, ContentBlock } from "../src/components/JsonView";
import { formatJson, tokenizeJson } from "../src/lib/json";

afterEach(() => vi.unstubAllGlobals());

describe("payload presentation", () => {
  it("formats nested JSON and colors keys, strings, numbers, booleans, and null without interpreting captured markup", () => {
    const source = JSON.stringify({
      name: "<img src=x onerror=alert(1)>",
      count: -12.5,
      enabled: true,
      missing: null,
      nested: { value: 'quote " and \\ slash' },
    });
    const { container } = render(<CodeView text={source} />);
    const code = screen.getByLabelText("Formatted JSON");
    expect(code.textContent).toBe(JSON.stringify(JSON.parse(source), null, 2));
    for (const kind of ["key", "string", "number", "boolean", "null"])
      expect(code.querySelector(`.json-${kind}`)).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Original" }));
    expect(screen.getByLabelText("Original JSON").textContent).toBe(source);
    fireEvent.click(screen.getByRole("button", { name: "Formatted" }));
    expect(screen.getByLabelText("Formatted JSON").textContent).toContain('\n  "nested": {');
  });

  it("preserves escaped strings and scientific notation when tokenizing the original JSON", () => {
    const source = String.raw`{"quoted\"key":"line\n\u263a","n":-1.2e+3,"ok":false}`;
    const tokens = tokenizeJson(source);
    expect(tokens.map((token) => token.text).join("")).toBe(source);
    expect(tokens.find((token) => token.kind === "number")?.text).toBe("-1.2e+3");
    expect(tokens.find((token) => token.kind === "key")?.text).toBe(String.raw`"quoted\"key"`);
  });

  it("leaves malformed JSON and streamed response text intact", () => {
    for (const text of ['{"broken":', 'data: {"partial":true}\n\ndata: [DONE]', "plain text"]) {
      expect(formatJson(text)).toEqual({ json: false, formatted: text });
    }
    render(<CodeView text={'{"broken":'} />);
    expect(screen.getByLabelText("Text content").textContent).toBe('{"broken":');
    expect(screen.queryByRole("button", { name: "Formatted" })).not.toBeInTheDocument();
  });

  it("keeps copied source exact while supporting formatted display and line wrapping", async () => {
    const source = '{"payload":[1,2,3]}';
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ContentBlock title="Request JSON" value={source} />);
    expect(screen.getByRole("button", { name: "Copy Request JSON" })).toHaveTextContent("Copy");
    fireEvent.click(screen.getByRole("button", { name: "Copy Request JSON" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(source));
    fireEvent.click(screen.getByRole("button", { name: "Wrap lines" }));
    expect(screen.getByLabelText("Formatted JSON")).toHaveClass("code-nowrap");
    expect(screen.getByRole("button", { name: "Wrap lines" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows an explicit large-payload notice instead of generating an unbounded token DOM", () => {
    const source = JSON.stringify({ content: "x".repeat(100_001) });
    const { container } = render(<CodeView text={source} />);
    expect(screen.getByText(/syntax colors are paused/)).toBeInTheDocument();
    expect(screen.getByLabelText("Formatted JSON").textContent).toBe(
      JSON.stringify(JSON.parse(source), null, 2),
    );
    expect(container.querySelector(".json-string")).toBeNull();
  });
});
