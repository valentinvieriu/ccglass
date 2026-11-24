import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import RequestDetail from "../src/components/RequestDetail";
import { buildMessages, countMessages, splitEnvelopes } from "../src/lib/messages";
import {
  buildTools,
  callIssues,
  matchesTool,
  schemaParams,
  schemaType,
  sortTools,
} from "../src/lib/tools";
import type { RequestRecord } from "../src/types";

const longOutput = Array.from({ length: 120 }, (_, line) => `line ${line}`).join("\n");

const record: RequestRecord = {
  id: "saved/7",
  seq: 7,
  request: {
    method: "POST",
    url: "/v1/messages",
    body: { model: "test-model", tool_choice: { type: "auto" } },
  },
  response: { status: 200 },
  parsed: {
    view: {
      system: [],
      tools: [
        {
          name: "Read",
          description: "Reads a file.\nSecond line of the description.",
          schema: {
            type: "object",
            properties: {
              file_path: { type: "string", description: "Absolute path" },
              limit: { type: "integer", default: 2000 },
            },
            required: ["file_path"],
            additionalProperties: false,
          },
        },
        {
          name: "Edit",
          description: "Replaces text in a file.",
          schema: {
            type: "object",
            properties: {
              file_path: { type: "string" },
              old_string: { type: "string" },
              new_string: { type: "string" },
              mode: { type: "string", enum: ["one", "all"] },
              ranges: {
                type: "array",
                items: {
                  type: "object",
                  properties: { from: { type: "integer" }, to: { type: ["integer", "null"] } },
                  required: ["from"],
                },
              },
            },
            required: ["file_path", "old_string", "new_string"],
            additionalProperties: false,
          },
        },
        { name: "Unused", description: "", schema: { type: "object", properties: {} } },
      ],
      messages: [
        {
          label: "msg[0].user[0]",
          role: "user",
          type: "text",
          text: "<system-reminder>\nUse pnpm.\n</system-reminder>",
        },
        {
          label: "msg[0].user[1]",
          role: "user",
          type: "text",
          text: "<current_datetime>half past nine</current_datetime>\n\nfix the flaky test\n\n<canvas-context>closed</canvas-context>\nThis note explains the canvas.",
          cache: true,
        },
        {
          label: "msg[1].assistant[0]",
          role: "assistant",
          type: "thinking",
          text: "Read the spec first.",
        },
        { label: "msg[1].assistant[1]", role: "assistant", type: "text", text: "\n" },
        {
          label: "msg[1].assistant[2]",
          role: "assistant",
          type: "tool_use",
          name: "Read",
          callId: "call-read",
          text: '{\n  "file_path": "/repo/spec.ts"\n}',
        },
        {
          label: "msg[2].user[0]",
          role: "user",
          type: "tool_result",
          callId: "call-read",
          text: longOutput,
        },
        {
          label: "msg[3].assistant[0]",
          role: "assistant",
          type: "tool_use",
          name: "Edit",
          callId: "call-edit",
          text: '{"file_path":"/repo/cart.ts","replaceAll":true}',
        },
        {
          label: "msg[3].assistant[1]",
          role: "assistant",
          type: "tool_use",
          name: "Ghost",
          callId: "call-ghost",
          text: "{}",
        },
        {
          label: "msg[4].user[0]",
          role: "user",
          type: "tool_result",
          callId: "call-edit",
          isError: true,
          text: "String to replace not found",
        },
        { label: "msg[4].user[1]", role: "user", type: "text", text: "try again" },
      ],
    },
    response: {
      stop_reason: "tool_use",
      usage: {},
      content: [
        { type: "tool_use", name: "Read", id: "call-next", input: { file_path: "/repo/cart.ts" } },
      ],
    },
  },
};

const openTab = (name: RegExp) => fireEvent.click(screen.getByRole("tab", { name }));
const message = (name: string) => screen.getByRole("article", { name });

describe("messages model", () => {
  it("separates what was typed from the envelopes a harness wraps around it", () => {
    expect(
      splitEnvelopes(
        "<current_datetime>now</current_datetime>\n\nhello\n<canvas-context>x</canvas-context>\nnote",
      ),
    ).toEqual([
      {
        kind: "envelope",
        name: "current_datetime",
        text: "<current_datetime>now</current_datetime>",
      },
      { kind: "text", text: "hello", human: true },
      { kind: "envelope", name: "canvas-context", text: "<canvas-context>x</canvas-context>" },
      { kind: "text", text: "note", human: false },
    ]);
    expect(splitEnvelopes("use <b>bold</b> here")).toEqual([
      { kind: "text", text: "use <b>bold</b> here", human: true },
    ]);
  });

  it("groups content blocks by message, names who wrote each, and pairs calls with outputs", () => {
    const model = buildMessages(record);
    expect(countMessages(record.parsed!.view!.messages)).toBe(5);
    expect(model.groups.map((group) => [group.path, group.label, group.parts.length])).toEqual([
      ["messages[0]", "User", 2],
      ["messages[1]", "Assistant", 3],
      ["messages[2]", "Tool output", 1],
      ["messages[3]", "Assistant", 2],
      ["messages[4]", "User", 2],
    ]);
    const output = model.groups[2].parts[0];
    expect(output.toolName).toBe("Read");
    expect(output.pair).toEqual({ id: "m-4", group: 1 });
    expect(model.parts[4].pair).toEqual({ id: "m-5", group: 2 });
    expect(model.parts[7].pair).toBeUndefined();
    // The model's last reply and everything after it is what this request adds.
    expect(model.newFrom).toBe(3);
    expect(model.largest?.id).toBe("m-5");
    expect(model.parts[1].cache).toBe(true);
  });

  it("labels a user-role message nobody typed as the harness and keeps unlabelled blocks apart", () => {
    const model = buildMessages({
      id: "x",
      parsed: {
        view: {
          system: [],
          tools: [],
          messages: [
            {
              label: "msg[1].user",
              role: "user",
              type: "message",
              text: "<system_reminder>be terse</system_reminder>",
            },
            {
              label: "msg[2].developer",
              role: "developer",
              type: "message",
              text: "Follow the style guide.",
            },
            { label: "Call", type: "tool_use", name: "shell", callId: "c", text: "{}" },
            { label: "Result", type: "tool_result", callId: "c", text: "ok", role: "tool" },
          ],
        },
      },
    });
    expect(model.groups.map((group) => [group.label, group.path ?? group.number])).toEqual([
      ["Harness", "messages[1]"],
      ["Developer", "messages[2]"],
      ["Assistant", 3],
      ["Tool output", 4],
    ]);
  });
});

describe("tools model", () => {
  it("flattens a schema into parameters with types, requirements, choices and defaults", () => {
    const edit = record.parsed!.view!.tools[1].schema;
    const { params, clipped } = schemaParams(edit);
    expect(clipped).toBe(false);
    expect(params.map((param) => [param.path, param.type, param.required])).toEqual([
      ["file_path", "string", true],
      ["old_string", "string", true],
      ["new_string", "string", true],
      ["mode", "string", false],
      ["ranges", "object[]", false],
      ["ranges[].from", "integer", true],
      ["ranges[].to", "integer | null", false],
    ]);
    expect(params[3].values).toEqual(["one", "all"]);
    expect(schemaParams(record.parsed!.view!.tools[0].schema).params[1].fallback).toBe(2000);
    expect(
      schemaType({ anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] }),
    ).toBe("string | string[]");
    expect(schemaType({ const: "x" })).toBe('"x"');
    expect(schemaType(undefined)).toBe("any");
    expect(schemaParams("not a schema").params).toEqual([]);
  });

  it("checks a call's arguments against the schema without guessing about open schemas", () => {
    const edit = record.parsed!.view!.tools[1].schema;
    expect(callIssues(edit, '{"file_path":"/a","replaceAll":true}')).toEqual([
      "Missing required: old_string, new_string",
      "Not in the schema: replaceAll",
    ]);
    expect(callIssues(edit, "{oops")).toEqual(["Arguments are not valid JSON"]);
    expect(
      callIssues({ type: "object", properties: { a: {} }, additionalProperties: true }, '{"b":1}'),
    ).toEqual([]);
    expect(callIssues({ type: "object" }, '{"anything":1}')).toEqual([]);
  });

  it("counts calls from the conversation and the response, and reports tools that were never defined", () => {
    const model = buildTools(record);
    expect(model.tools.map((tool) => [tool.name, tool.calls.length, tool.failed])).toEqual([
      ["Read", 2, 0],
      ["Edit", 1, 1],
      ["Unused", 0, 0],
    ]);
    expect(model.called).toBe(2);
    expect(model.undefinedTools).toEqual(["Ghost"]);
    expect(model.settings).toEqual([["tool_choice", '{"type":"auto"}']]);
    expect(model.tools[0].summary).toBe("Reads a file.");
    expect(model.tools.reduce((total, tool) => total + tool.share, 0)).toBeCloseTo(1);
    expect(sortTools(model.tools, "size").map((tool) => tool.name)).toEqual([
      "Edit",
      "Read",
      "Unused",
    ]);
    expect(sortTools(model.tools, "calls")[0].name).toBe("Read");
    expect(
      model.tools.filter((tool) => matchesTool("unused", "", tool)).map((tool) => tool.name),
    ).toEqual(["Unused"]);
    expect(
      model.tools
        .filter((tool) => matchesTool("all", "ranges[].from", tool))
        .map((tool) => tool.name),
    ).toEqual(["Edit"]);
  });
});

describe("messages tab", () => {
  it("reads as a transcript: one entry per message with its position, role and size", () => {
    render(<RequestDetail record={record} />);
    expect(
      within(screen.getByRole("tab", { name: /^messages/i })).getByText("5"),
    ).toBeInTheDocument();
    openTab(/^messages/i);
    expect(screen.getAllByRole("article")).toHaveLength(5);
    const first = message("User · messages[0]");
    expect(within(first).getByText("fix the flaky test")).toBeInTheDocument();
    expect(within(first).getByText(/Cache breakpoint/)).toBeInTheDocument();
    // Tool traffic sent in the user role is not presented as something the user said.
    expect(within(message("Tool output · messages[2]")).getByText(/role user/)).toBeInTheDocument();
    expect(screen.getByText("Earlier turns")).toBeInTheDocument();
    expect(screen.getByText("New since the last reply")).toBeInTheDocument();
    expect(screen.getByText(/whitespace/)).toHaveTextContent(
      "Empty text block · 1 character of whitespace",
    );
  });

  it("keeps harness envelopes folded beside the typed text until they are opened", () => {
    render(<RequestDetail record={record} />);
    openTab(/^messages/i);
    const first = message("User · messages[0]");
    const envelope = within(first).getByRole("button", { name: /current_datetime/ });
    expect(envelope).toHaveAttribute("aria-expanded", "false");
    expect(
      within(first).queryByText("<current_datetime>half past nine</current_datetime>"),
    ).toBeNull();
    fireEvent.click(envelope);
    expect(
      within(first).getByText("<current_datetime>half past nine</current_datetime>"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(within(first).getByText("<canvas-context>closed</canvas-context>")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(within(first).queryByText("<canvas-context>closed</canvas-context>")).toBeNull();
  });

  it("names the tool behind each output, links it to its call, and mounts long output on demand", () => {
    render(<RequestDetail record={record} />);
    openTab(/^messages/i);
    const output = message("Tool output · messages[2]");
    expect(within(output).getByText("Read")).toBeInTheDocument();
    expect(within(output).queryByText(/line 119/)).toBeNull();
    fireEvent.click(within(output).getByRole("button", { name: /Show all · 120 lines/ }));
    expect(within(output).getByText(/line 119/)).toBeInTheDocument();
    fireEvent.click(within(output).getByRole("button", { name: /^Call/ }));
    expect(document.querySelector(".msg-flash")).toHaveTextContent("Read");
    expect(document.querySelector(".msg-flash")).toHaveTextContent('"file_path": "/repo/spec.ts"');
    const calls = message("Assistant · messages[3]");
    expect(within(calls).getByText("Called without arguments.")).toBeInTheDocument();
    expect(
      within(calls).getByText("Not among the tools defined in this request"),
    ).toBeInTheDocument();
    expect(within(calls).getByText("no output captured")).toBeInTheDocument();
  });

  it("filters to errors and finds text inside folded content", () => {
    render(<RequestDetail record={record} />);
    openTab(/^messages/i);
    fireEvent.click(screen.getByRole("button", { name: /^Errors/ }));
    expect(
      screen.getAllByRole("article").map((article) => article.getAttribute("aria-label")),
    ).toEqual(["Assistant · messages[3]", "User · messages[4]"]);
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find in messages" }), {
      target: { value: "LINE 118" },
    });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(document.querySelector(".msg-body mark")).toHaveTextContent("line 118");
    fireEvent.change(screen.getByRole("searchbox", { name: "Find in messages" }), {
      target: { value: "nothing like this" },
    });
    expect(screen.getByText(/No message matches/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear the filter" }));
    expect(screen.getAllByRole("article")).toHaveLength(5);
  });

  it("leads from the last message to the reply", () => {
    render(<RequestDetail record={record} />);
    openTab(/^messages/i);
    fireEvent.click(screen.getByRole("button", { name: "See what the model replied" }));
    expect(screen.getByRole("tab", { name: "response" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("tools tab", () => {
  it("lists every tool with what it costs and whether it was called", () => {
    render(<RequestDetail record={record} />);
    openTab(/^tools/i);
    const list = screen.getByRole("group", { name: "Tools offered" });
    expect(
      within(list)
        .getAllByRole("button")
        .map((row) => row.getAttribute("aria-label")?.split(" · ").slice(0, 3)),
    ).toEqual([
      ["Read", "Reads a file.", "2 calls"],
      ["Edit", "Replaces text in a file.", "1 call"],
      ["Unused", "No description", "not called"],
    ]);
    expect(screen.getByText(/Called but not defined in this request: Ghost/)).toBeInTheDocument();
    expect(screen.getByText(/tool_choice/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort tools" }), {
      target: { value: "size" },
    });
    expect(within(list).getAllByRole("button")[0]).toHaveAccessibleName(/^Edit/);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a tool or parameter" }), {
      target: { value: "old_string" },
    });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a tool or parameter" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Never called/ }));
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    const pane = screen.getByRole("complementary", { name: "Tool definition" });
    expect(within(pane).getByText(/No description was sent/)).toBeInTheDocument();
    expect(within(pane).getByText("Takes no arguments.")).toBeInTheDocument();
    expect(
      within(pane).getByText("The model has not called this tool so far."),
    ).toBeInTheDocument();
  });

  it("explains one tool: description, parameters, the calls made to it and the raw schema", () => {
    render(<RequestDetail record={record} />);
    openTab(/^tools/i);
    const pane = screen.getByRole("complementary", { name: "Tool definition" });
    expect(within(pane).getByRole("heading", { name: "Read" })).toBeInTheDocument();
    expect(within(pane).getByText(/Second line of the description/)).toBeInTheDocument();
    expect(within(pane).getByText("Parameters · 2 · 1 required")).toBeInTheDocument();
    expect(within(pane).getByText("Absolute path")).toBeInTheDocument();
    expect(within(pane).getByText("2000")).toBeInTheDocument();
    expect(within(pane).getByText("in this response")).toBeInTheDocument();
    expect(within(pane).queryByLabelText("Formatted JSON")).toBeNull();
    fireEvent.click(within(pane).getByRole("button", { name: /Input schema as sent/ }));
    expect(within(pane).getByLabelText("Formatted JSON")).toHaveTextContent(
      '"additionalProperties": false',
    );
    fireEvent.keyDown(screen.getByRole("group", { name: "Tools offered" }), { key: "ArrowDown" });
    expect(within(pane).getByRole("heading", { name: "Edit" })).toBeInTheDocument();
    expect(within(pane).getByText("called 1× · 1 failed")).toBeInTheDocument();
    expect(within(pane).getByText("Missing required: old_string, new_string")).toBeInTheDocument();
    expect(within(pane).getByText("Not in the schema: replaceAll")).toBeInTheDocument();
    expect(within(pane).getByText("one")).toBeInTheDocument();
  });

  it("jumps between a call in the conversation and the definition of its tool", () => {
    render(<RequestDetail record={record} />);
    openTab(/^messages/i);
    const calls = message("Assistant · messages[3]");
    fireEvent.click(within(calls).getByRole("button", { name: "Definition" }));
    expect(screen.getByRole("tab", { name: /^tools/i })).toHaveAttribute("aria-selected", "true");
    const pane = screen.getByRole("complementary", { name: "Tool definition" });
    expect(within(pane).getByRole("heading", { name: "Edit" })).toBeInTheDocument();
    fireEvent.click(within(pane).getByTitle("Open this call in Messages"));
    expect(screen.getByRole("tab", { name: /^messages/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(document.querySelector(".msg-flash")).toHaveTextContent("Edit");
    // A call the model has only just asked for lives in the response.
    openTab(/^tools/i);
    fireEvent.click(screen.getByRole("button", { name: /^Read/ }));
    fireEvent.click(screen.getByTitle("Open this call in Response"));
    expect(screen.getByRole("tab", { name: "response" })).toHaveAttribute("aria-selected", "true");
  });
});
