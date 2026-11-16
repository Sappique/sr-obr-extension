import { SAMPLE_CALENDAR, SAMPLE_TODAY } from "../calendar/format";
import { SAMPLE_FEED } from "../feed/format";
import { SAMPLE_INFLUENCE } from "../influence/format";
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
    width: 1500,
    spec: { title: "Chrono // Kalender 2077", tag: "Chrono", variant: "standard", markdown: SAMPLE_CALENDAR, kind: "calendar", today: SAMPLE_TODAY },
  },
  feed: {
    label: "Matrix feed",
    width: 700,
    spec: { title: "Matrix // Feed", tag: "Feed", variant: "standard", markdown: SAMPLE_FEED, kind: "feed" },
  },
  influence: {
    label: "Influence chart",
    width: 1180,
    spec: { title: "Influence // London Factions", tag: "Index", variant: "standard", markdown: SAMPLE_INFLUENCE, kind: "influence" },
  },
};
