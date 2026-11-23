import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync("ui/src/styles.css", "utf8");
const tokens = Object.fromEntries(
  [...stylesheet.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
);

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

describe("accessible semantic palette", () => {
  it("keeps text readable on normal, selected, status, and sidebar surfaces", () => {
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
      ["info", "info-soft"],
      ...["json-key", "json-string", "json-number", "json-boolean"].map((text) => [
        text,
        "surface-muted",
      ]),
      ["on-accent", "accent"],
      ["on-accent", "accent-hover"],
      ...["sidebar", "sidebar-hover", "sidebar-selected"].flatMap((surface) =>
        ["sidebar-ink", "sidebar-muted", "sidebar-accent"].map((text) => [text, surface]),
      ),
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

  it("lets the brand hue change without sacrificing button text contrast", () => {
    for (let hue = 0; hue < 360; hue += 15) {
      const overrides = { "--brand-hue": String(hue) };
      expect(contrast("on-accent", "accent", overrides), `brand hue ${hue}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});
