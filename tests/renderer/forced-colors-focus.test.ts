import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rendererStyles = readFileSync(new URL("../../src/renderer/styles.css", import.meta.url), "utf8");
const forcedColorsStart = rendererStyles.indexOf("@media (forced-colors: active)");
const forcedColors = rendererStyles.slice(forcedColorsStart);

describe("renderer forced-colors and keyboard-focus contract", () => {
  it("keeps an explicit system-color focus indicator on every audited interaction group", () => {
    expect(forcedColorsStart).toBeGreaterThanOrEqual(0);
    expect(forcedColors).toContain(":focus-visible { outline-color: Highlight; }");
    expect(forcedColors).toContain(".window-control-button:focus-visible { outline: 3px solid Highlight; outline-offset: -4px; }");
    expect(forcedColors).toMatch(/\.notification-card__actions :is\(\.button, \.icon-button\):focus-visible,[\s\S]*\.appearance-presets :is\(\.button, input, select\):focus-visible,[\s\S]*\.changelog-calendar :is\(\.button, input, select\):focus-visible \{ outline: 3px solid Highlight; outline-offset: 2px; \}/u);
    expect(forcedColors).toMatch(/\.appearance-presets \.field:has\(:focus-visible\),[\s\S]*\.changelog-calendar label:has\(:focus-visible\) \{ outline: 3px solid Highlight; outline-offset: 2px; \}/u);
  });

  it("does not leave notification and date-range state encoded only by opacity or author colors", () => {
    expect(forcedColors).toContain(".notification-card.is-read { opacity: 1; }");
    expect(forcedColors).toContain(".notification-card.is-dismissed { border-color: GrayText; }");
    expect(forcedColors).toMatch(/\.notification-card__actions \[aria-pressed="true"\],[\s\S]*\.assist-chip\.is-selected \{ forced-color-adjust: none; border: 2px solid Highlight; background: Highlight; color: HighlightText; \}/u);
    expect(forcedColors).toContain(".changelog-calendar__day.is-in-range { forced-color-adjust: none; border: 2px solid Highlight; background: Canvas; color: CanvasText; }");
    expect(forcedColors).toMatch(/\.changelog-calendar__day\.is-range-start,[\s\S]*\.changelog-calendar__day\.is-range-end \{ background: Highlight; color: HighlightText; \}/u);
    expect(forcedColors).toMatch(/\.changelog-calendar__day\.is-range-start:focus-visible,[\s\S]*\.changelog-calendar__day\.is-range-end:focus-visible \{ outline: 3px solid HighlightText; outline-offset: 0; \}/u);
  });
});
