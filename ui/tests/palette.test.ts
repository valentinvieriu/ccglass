import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const stylesheet = readFileSync("ui/src/styles.css", "utf8");
const darkBlock = stylesheet.match(/:root\[data-theme="dark"\]\s*\{[^}]*\}/)![0];
const parseTokens = (css: string) =>
  Object.fromEntries(
    [...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
  );
const lightTokens = parseTokens(stylesheet.replace(darkBlock, ""));
const themes = { light: lightTokens, dark: { ...lightTokens, ...parseTokens(darkBlock) } };
let tokens: Record<string, string> = lightTokens;

function luminance(name: string, overrides: Record<string, string> = {}): number {
  const values = { ...tokens, ...overrides };
  const resolve = (value: string): string =>
    value.replace(/var\((--[\w-]+)\)/g, (_, key: string) => {
      if (!(key in values)) throw new Error(`Missing palette token ${key}`);
      return resolve(values[key]);
    });
  const color = resolve(values[`--color-${name}`]);
  const match = color.match(/^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!match) throw new Error(`Expected OKLCH color for ${name}: ${color}`);
  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue),
    b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return (
    0.2126 * clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) +
    0.7152 * clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) +
    0.0722 * clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  );
}

function contrast(foreground: string, background: string, overrides?: Record<string, string>) {
  const a = luminance(foreground, overrides),
    b = luminance(background, overrides);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.each(["light", "dark"] as const)("accessible semantic palette (%s)", (theme) => {
  beforeAll(() => {
    tokens = themes[theme];
  });

  it("keeps text readable on normal, selected and status surfaces", () => {
    const pairs = [
      ...[
        "surface",
        "canvas",
        "surface-muted",
        "surface-hover",
        "accent-soft",
        "accent-soft-hover",
      ].flatMap((surface) => ["ink", "muted", "subtle"].map((text) => [text, surface])),
      ["accent-ink", "accent-soft"],
      ["accent-ink", "surface"],
      ["success", "success-soft"],
      ["danger", "danger-soft"],
      ["danger", "danger-hover"],
      ["warning", "warning-soft"],
      ["warning", "surface"],
      ["tool", "tool-soft"],
      // The assistant's tile: the surface colour on ink.
      ["surface", "ink"],
      ...["surface-subtle"].flatMap((surface) => ["ink", "muted", "subtle"].map((text) => [text, surface])),
      ...["json-key", "json-string", "json-number", "json-boolean"].map((text) => [
        text,
        "surface-muted",
      ]),
      ["on-accent", "accent"],
      ["on-accent", "accent-hover"],
    ];
    for (const [text, surface] of pairs)
      expect(contrast(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps input boundaries and focus indicators distinguishable", () => {
    for (const surface of ["surface", "surface-muted", "surface-hover", "canvas"]) {
      expect(
        contrast("control-border", surface),
        `control border on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
      expect(contrast("accent", surface), `focus indicator on ${surface}`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it("marks a selected row with a bar that stands out from the row and from its neighbours", () => {
    // The accent bar on the leading edge is what says "selected": 3:1 against
    // the row's own soft fill and against the surfaces a row sits on.
    for (const surface of ["accent-soft", "accent-soft-hover", "surface", "surface-subtle", "surface-muted"])
      expect(contrast("accent", surface), `selection bar on ${surface}`).toBeGreaterThanOrEqual(3);
  });

  it("keeps each role's mark distinguishable from the surface it sits on", () => {
    // Tiles and chip dots: the user in the accent, tools in teal, the assistant
    // in ink, failures in red, cancellations in amber.
    for (const role of ["accent", "tool", "ink", "danger", "warning"])
      for (const surface of ["surface", "surface-muted"])
        expect(contrast(role, surface), `${role} mark on ${surface}`).toBeGreaterThanOrEqual(3);
    // An outlined tile's edge is a boundary like an input's.
    expect(contrast("tool", "tool-soft")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("tool-border", "surface")).toBeGreaterThan(1.5);
  });

  it("defines one type scale, three weights and four radii, and uses nothing else", () => {
    for (const step of ["caption", "meta", "body", "prose", "title", "page"]) {
      expect(lightTokens[`--text-${step}`], `--text-${step}`).toMatch(/^\d+px$/);
      expect(lightTokens[`--text-${step}--line-height`]).toMatch(/^\d+px$/);
    }
    const rules = stylesheet.slice(stylesheet.indexOf("* {"));
    expect(rules.match(/font-size:\s*[\d.]+(px|rem|em)/g) ?? []).toEqual([]);
    expect(rules.match(/font-weight:\s*\d+/g) ?? []).toEqual([]);
    const radii = new Set(
      [...rules.matchAll(/border-radius:\s*([^;]+);/g)].flatMap((match) => match[1].split(/\s+/)),
    );
    expect([...radii].sort()).toEqual(
      [
        "0",
        "50%",
        "inherit",
        "var(--radius-card)",
        "var(--radius-control)",
        "var(--radius-mark)",
        "var(--radius-pill)",
        "var(--radius-shell)",
        "var(--radius-tag)",
      ].filter((value) => radii.has(value)),
    );
  });

  it("lets the brand hue change without sacrificing button text contrast", () => {
    for (let hue = 0; hue < 360; hue += 15) {
      const overrides = { "--brand-hue": String(hue) };
      expect(contrast("on-accent", "accent", overrides), `brand hue ${hue}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});
