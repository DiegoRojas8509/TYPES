import { useApp } from "../../store/app";

/**
 * PLACEHOLDER for the right pane body. Task 7 replaces it with the real chat.
 * The shell (App.tsx) already draws the pane header ("Claude" + collapse button),
 * so render only the body. Read `activeSpace` from the store: one conversation per space.
 */
export function ChatPanel() {
  const activeSpace = useApp((s) => s.activeSpace);

  if (!activeSpace) {
    return (
      <div className="empty">
        <h2>Chat con Claude</h2>
        <p>Selecciona un espacio y aquí podrás pedirle a Claude que analice y trabaje sobre sus archivos.</p>
      </div>
    );
  }
  return (
    <div className="empty">
      <h2>{activeSpace}</h2>
      <p>El chat de este espacio estará aquí.</p>
    </div>
  );
}
