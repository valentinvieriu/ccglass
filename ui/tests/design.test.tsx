import { existsSync, readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { FilterBar } from "../src/components/FlowItems";
import { MiddleTruncate } from "../src/components/MiddleTruncate";

describe("names that are cut in the middle", () => {
  it("keeps both ends of a long name and the whole of it for a tooltip, a copy and a screen reader", () => {
    const model = "nemotron-3.5-lightning:30b-mlx";
    const { container } = render(<MiddleTruncate text={model} className="request-model" />);
    const name = screen.getByTitle(model);
    expect(name).toHaveClass("mid", "request-model");
    expect(container.querySelector(".mid-head")).toHaveTextContent("nemotron-3.5-lightning");
    expect(container.querySelector(".mid-tail")).toHaveTextContent(":30b-mlx");
    // Read as one word: nothing is inserted between the two halves.
    expect(name.textContent).toBe(model);
  });

  it("leaves a short name alone", () => {
    const { container } = render(<MiddleTruncate text="open_canvas" />);
    expect(screen.getByTitle("open_canvas")).toHaveTextContent("open_canvas");
    expect(container.querySelector(".mid")).toBeNull();
  });
});

describe("filter chips", () => {
  it("carry the colour of the role they filter for, as the rows do", () => {
    render(
      <FilterBar
        filters={[
          { value: "all", label: "Everything", count: 9 },
          { value: "prompt", label: "Prompts", count: 2 },
          { value: "assistant", label: "Assistant", count: 3 },
          { value: "tool", label: "Tool calls", count: 4 },
          { value: "failed", label: "Failed", count: 1 },
          { value: "cancelled", label: "Cancelled", count: 1 },
          { value: "harness", label: "Harness", count: 0 },
        ]}
        filter="all"
        onFilter={vi.fn()}
        search=""
        onSearch={vi.fn()}
        searchLabel="Find"
      />,
    );
    const role = (name: RegExp) => screen.getByRole("button", { name }).getAttribute("data-role");
    expect(role(/^Everything/)).toBeNull();
    expect(role(/^Prompts/)).toBe("user");
    expect(role(/^Assistant/)).toBe("assistant");
    expect(role(/^Tool calls/)).toBe("tool");
    expect(role(/^Failed/)).toBe("failed");
    expect(role(/^Cancelled/)).toBe("cancelled");
    // A filter that would show nothing is not offered.
    expect(screen.queryByRole("button", { name: /^Harness/ })).not.toBeInTheDocument();
  });
});

describe("the typeface", () => {
  const stylesheet = readFileSync("ui/src/styles.css", "utf8");

  it("is bundled with its licence, so the dashboard loads nothing from the network", () => {
    expect(stylesheet).toMatch(/@font-face\s*\{[^}]*url\("\.\/fonts\/InterVariable\.woff2"\)/);
    expect(existsSync("ui/src/fonts/InterVariable.woff2")).toBe(true);
    expect(readFileSync("ui/src/fonts/LICENSE.txt", "utf8")).toMatch(/SIL Open Font License/i);
    expect(stylesheet).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
    expect(readFileSync("ui/index.html", "utf8")).not.toMatch(/<link[^>]+href="https?:/);
  });
});
