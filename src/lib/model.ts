/** Models the chat can ask Claude Code for. "" = whatever the installed Claude Code uses by default. */
export const MODELS: { id: string; label: string }[] = [
  { id: "", label: "Predeterminado" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
];

const KEY = "types.model";

export function getModel(): string {
  try {
    const m = localStorage.getItem(KEY) ?? "";
    return MODELS.some((x) => x.id === m) ? m : "";
  } catch {
    return "";
  }
}

export function setModel(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* preference only: the page works without it */
  }
}
