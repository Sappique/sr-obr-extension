import { SAMPLE_CALENDAR, SAMPLE_TODAY } from "../calendar/format";
import type { WindowKind, WindowSpec } from "./layout";

/** Starting content for a new window of each kind; width in design px (x SCALE x uiScale = scene units). */
export const SAMPLES: Record<WindowKind, { spec: WindowSpec; width: number; label: string }> = {
  markdown: {
    label: "Window",
    width: 460,
    spec: { title: "Neues Fenster", tag: "", variant: "standard", markdown: "## Allgemein\n\nText", kind: "markdown" },
  },
  calendar: {
    label: "Calendar",
    // Three months of about the old middle month's size each.
    width: 2050,
    spec: { title: "Chrono // Kalender 2077", tag: "Chrono", variant: "standard", markdown: SAMPLE_CALENDAR, kind: "calendar", today: SAMPLE_TODAY },
  },
};
