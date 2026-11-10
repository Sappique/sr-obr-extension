import OBR from "@owlbear-rodeo/sdk";
import { readSpec, SPEC_KEY } from "./items";
import { WindowKind, WindowSpec } from "./layout";
import { KIND_EDITORS } from "./kinds";
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

let kind: WindowKind = "markdown";

function showKind(next: WindowKind) {
  kind = next;
  const editor = KIND_EDITORS[kind];
  textLabel.textContent = editor.label;
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
  };
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
  showKind(spec.kind ?? "markdown");
  frameId = id;
}

OBR.onReady(async () => {
  for (const field of [title, tag, markdown]) field.addEventListener("input", scheduleSave);
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
