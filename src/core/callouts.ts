import { COLOR } from "./style";

/** Callout types, by lower-case name. Adding a type is one entry here. */
export interface CalloutStyle {
  color: string;
  /** "display": the title is the big highlight. "label": type name above a normal title. */
  title: "display" | "label";
}

const NOTE: CalloutStyle = { color: COLOR.cyan, title: "label" };

const CALLOUTS: Record<string, CalloutStyle> = {
  note: NOTE,
  reward: { color: COLOR.yellow, title: "display" },
};

/** Unknown types render as a generic note labelled with their own name. */
export function calloutStyle(kind: string): CalloutStyle {
  return CALLOUTS[kind.toLowerCase()] ?? NOTE;
}
