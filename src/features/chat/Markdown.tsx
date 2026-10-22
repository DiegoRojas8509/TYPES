import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openExternal } from "../../lib/api";
import { useApp } from "../../store/app";
import { canonPath, relativeTo } from "./describeTool";

// react-markdown escapes raw HTML (no rehype-raw here) and its default URL transform
// drops javascript:/data: links, so assistant text can never inject markup.

const REMOTE = /^https?:\/\//i;

/** Workspace-relative path for a link written relative to the space, or null. */
function resolveInSpace(href: string, space: string | null, root: string | undefined): string | null {
  if (!space || !root || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return null;
  let target = href.split("#")[0].split("?")[0];
  try {
    target = decodeURIComponent(target);
  } catch {
    /* keep as written */
  }
  if (!target) return null;
  const rel = relativeTo(canonPath(`${root}/${space}/${target}`), root);
  return rel && rel !== "." ? rel : null;
}

function Link({ href, children }: ComponentProps<"a">) {
  const space = useApp((s) => s.activeSpace);
  const root = useApp((s) => s.settings?.workspaceRoot);
  const open = useApp((s) => s.open);
  if (href && REMOTE.test(href)) {
    return (
      <a
        href={href}
        title={href}
        onClick={(e) => {
          e.preventDefault();
          void openExternal(href).catch(() => {});
        }}
      >
        {children}
      </a>
    );
  }
  const file = href ? resolveInSpace(href, space, root) : null;
  if (file) {
    return (
      <a
        href={file}
        title={file}
        onClick={(e) => {
          e.preventDefault();
          open(file);
        }}
      >
        {children}
      </a>
    );
  }
  return <span>{children}</span>;
}

// Remote images would load from the network: show their description instead.
function Image({ alt }: ComponentProps<"img">) {
  return <span className="chat-md-img">{alt || "imagen"}</span>;
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="chat-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: Link, img: Image }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
