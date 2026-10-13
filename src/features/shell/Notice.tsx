import { useEffect } from "react";
import { useApp } from "../../store/app";
import { IconClose } from "./icons";

/** Small non-blocking toast for command errors and info. Auto-dismisses. */
export function Notice() {
  const notice = useApp((s) => s.notice);
  const dismiss = useApp((s) => s.dismissNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismiss, 7000);
    return () => clearTimeout(t);
  }, [notice, dismiss]);

  if (!notice) return null;
  return (
    <div className="notice" role={notice.tone === "error" ? "alert" : "status"} data-tone={notice.tone}>
      <p>{notice.message}</p>
      <button className="icon-btn" aria-label="Cerrar aviso" onClick={dismiss}>
        <IconClose />
      </button>
    </div>
  );
}
