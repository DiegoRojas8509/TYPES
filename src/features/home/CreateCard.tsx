import { useState, type ReactNode } from "react";
import { NameInput } from "../sidebar/NameInput";
import { IconPlus } from "../shell/icons";

interface Props {
  label: string;
  inputLabel: string;
  icon?: ReactNode;
  /** Resolves with the created path, or null when it failed (the error is already shown). */
  onCreate(name: string): Promise<string | null>;
}

/** Dashed "+ Pizarra" style card that turns into an inline name field in place. */
export function CreateCard({ label, inputLabel, icon, onCreate }: Props) {
  const [naming, setNaming] = useState(false);
  return (
    <div role="listitem" className="card card-create">
      {naming ? (
        <div className="card-main card-create-input">
          <NameInput
            label={inputLabel}
            onSubmit={async (name) => {
              const ok = (await onCreate(name)) !== null;
              if (ok) setNaming(false);
              return ok;
            }}
            onCancel={() => setNaming(false)}
          />
        </div>
      ) : (
        <button type="button" data-card className="card-main card-add" onClick={() => setNaming(true)}>
          {icon ?? <IconPlus />}
          <span>{label}</span>
        </button>
      )}
    </div>
  );
}
