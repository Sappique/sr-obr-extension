import OBR from "@owlbear-rodeo/sdk";
import { readSpec, SPEC_KEY } from "./items";
import { WindowKind, WindowSpec } from "./layout";
import { KIND_EDITORS } from "./kinds";
import { parseDate, shiftDay } from "../calendar/format";
import "./editor.css";

/** Embedded in the context menu; edits the selected window. */
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const title = get<HTMLInputElement>("title");
const tag = get<HTMLInputElement>("tag");
const variant = get<HTMLSelectElement>("variant");
const markdown = get<HTMLTextAreaElement>("markdown");
const tools = get<HTMLDivElement>("tools");
const textLabel = get<HTMLSpanElement>("textLabel");
const help = get<HTMLPreElement>("help");
const todayRow = get<HTMLDivElement>("todayRow");
const today = get<HTMLInputElement>("today");

let kind: WindowKind = "markdown";

function showKind(next: WindowKind) {
  kind = next;
  const editor = KIND_EDITORS[kind];
  textLabel.textContent = editor.label;
  todayRow.hidden = kind !== "calendar";
  help.textContent = editor.help;
  tools.replaceChildren(
    ...editor.actions.map((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => {
        markdown.value = action.apply(markdown.value);
        save();
      });
      return button;
    }),
  );
}

let frameId: string | null = null;
/** The calendar's last saved date, kept while the field holds an unfinished one. */
let lastToday: string | undefined;
let timer: number | undefined;

function save() {
  clearTimeout(timer);
  timer = undefined;
  if (!frameId) return;
  const spec: WindowSpec = {
    title: title.value,
    tag: tag.value,
    variant: variant.value as WindowSpec["variant"],
    markdown: markdown.value,
    kind,
    // Only a valid date is saved; the field keeps what is being typed.
    ...(kind === "calendar" && parseDate(today.value, 2077) ? { today: today.value.trim() } : {}),
  };
  if (kind === "calendar" && !spec.today && lastToday) spec.today = lastToday;
  if (spec.today) lastToday = spec.today;
  void OBR.scene.items.updateItems([frameId], (drafts) => {
    for (const draft of drafts) draft.metadata[SPEC_KEY] = spec;
  });
}

function scheduleSave() {
  clearTimeout(timer);
  timer = window.setTimeout(save, 250);
}

async function load(id: string) {
  frameId = null;
  const [frame] = await OBR.scene.items.getItems([id]);
  if (!frame) return;
  const spec = readSpec(frame);
  title.value = spec.title;
  tag.value = spec.tag;
  variant.value = spec.variant;
  markdown.value = spec.markdown;
  lastToday = spec.today;
  today.value = spec.today ?? "";
  showKind(spec.kind ?? "markdown");
  frameId = id;
}

OBR.onReady(async () => {
  for (const field of [title, tag, markdown, today]) field.addEventListener("input", scheduleSave);
  for (const [id, days] of [["todayMinus", -1], ["todayPlus", 1]] as const) {
    get<HTMLButtonElement>(id).addEventListener("click", () => {
      today.value = shiftDay(lastToday ?? today.value, days);
      save();
    });
  }
  variant.addEventListener("change", save);
  // Closing the menu can tear this page down; don't lose the last keystrokes.
  window.addEventListener("pagehide", () => {
    if (timer !== undefined) save();
  });

  const selected = async (selection: string[] | undefined) => {
    const id = selection?.[0];
    if (!id || id === frameId) return;
    if (timer !== undefined) save();
    await load(id);
  };
  await selected(await OBR.player.getSelection());
  OBR.player.onChange((player) => void selected(player.selection));
});
