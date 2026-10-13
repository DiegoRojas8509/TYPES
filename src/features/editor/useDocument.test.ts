import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { ...actual.api, readText: vi.fn(), writeText: vi.fn() } };
});

import { api } from "../../lib/api";
import { initialState, useApp } from "../../store/app";
import { AUTOSAVE_MS, useDocument } from "./useDocument";

const readText = vi.mocked(api.readText);
const writeText = vi.mocked(api.writeText);
const PATH = "Ropa/Telas.md";

let disk: string;
let seq = 0;

/** Simulates the watcher telling the store that a file changed. */
async function fsChanged(...paths: string[]) {
  await act(async () => {
    useApp.setState({ fsChange: { seq: ++seq, paths } });
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function open(path: string | null = PATH) {
  const hook = renderHook(({ p }) => useDocument(p), { initialProps: { p: path } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  useApp.setState(initialState());
  disk = "# Telas\n\n| Tela | Precio |\n| --- | --- |\n| Lino | 120 |\n";
  readText.mockReset().mockImplementation(async () => disk);
  writeText.mockReset().mockImplementation(async (_p, c) => {
    disk = c;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDocument", () => {
  it("opening_does_not_write", async () => {
    const { result, unmount } = await open();
    expect(result.current.status).toBe("clean");
    expect(result.current.content).toBe(disk);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    unmount();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("edit_autosaves_after_800ms", async () => {
    const { result } = await open();
    act(() => result.current.onChange("uno"));
    expect(result.current.status).toBe("dirty");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    });
    expect(writeText).not.toHaveBeenCalled();
    // A second edit restarts the wait.
    act(() => result.current.onChange("uno dos"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    });
    expect(writeText).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(PATH, "uno dos");
    expect(result.current.status).toBe("clean");
  });

  it("external_change_when_clean_reloads", async () => {
    const { result } = await open();
    const rev = result.current.revision;
    disk = "# Telas\n\nClaude agregó esto\n";
    await fsChanged(PATH);
    expect(result.current.status).toBe("clean");
    expect(result.current.content).toBe(disk);
    expect(result.current.revision).toBe(rev + 1);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("ignores_changes_to_other_files", async () => {
    const { result } = await open();
    const reads = readText.mock.calls.length;
    await fsChanged("Ropa/Otra.md");
    expect(readText.mock.calls.length).toBe(reads);
    expect(result.current.status).toBe("clean");
  });

  it("external_change_when_dirty_sets_conflict_and_keeps_text", async () => {
    const { result } = await open();
    act(() => result.current.onChange("mi texto"));
    disk = "texto de Claude";
    await fsChanged(PATH);
    expect(result.current.status).toBe("conflict");
    // The pending autosave must not overwrite Claude's version.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(disk).toBe("texto de Claude");

    // "Conservar lo mío" writes his text.
    await act(async () => {
      result.current.keepMine();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(writeText).toHaveBeenCalledWith(PATH, "mi texto");
    expect(result.current.status).toBe("clean");
  });

  it("conflict_reload_discards_mine_and_shows_disk", async () => {
    const { result } = await open();
    act(() => result.current.onChange("mi texto"));
    disk = "texto de Claude";
    await fsChanged(PATH);
    await act(async () => {
      result.current.reloadFromDisk();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("clean");
    expect(result.current.content).toBe("texto de Claude");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("own_write_is_ignored", async () => {
    const { result } = await open();
    const rev = result.current.revision;
    act(() => result.current.onChange("escrito por mí"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    await fsChanged(PATH); // the watcher echoes our own write
    expect(result.current.status).toBe("clean");
    expect(result.current.revision).toBe(rev);
    expect(result.current.content).not.toBe("escrito por mí");
  });

  it("own_write_echo_while_a_later_write_is_in_flight_is_not_a_conflict", async () => {
    const { result } = await open();
    const releases: Array<() => void> = [];
    writeText.mockImplementation(
      (_p, c) =>
        new Promise<void>((resolve) => {
          releases.push(() => {
            disk = c;
            resolve();
          });
        }),
    );
    act(() => result.current.onChange("A"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    });
    releases[0]();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.onChange("B"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    });
    expect(result.current.status).toBe("saving");
    await fsChanged(PATH); // late echo of write A: disk still holds A
    expect(result.current.status).toBe("saving");
    releases[1]();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("clean");
    expect(disk).toBe("B");
  });

  it("editing_back_to_the_disk_text_does_not_write", async () => {
    const { result } = await open();
    act(() => result.current.onChange("otra cosa"));
    act(() => result.current.onChange(disk));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(result.current.status).toBe("clean");
  });

  it("flushes_pending_edit_when_switching_files", async () => {
    const { result, rerender } = await open();
    act(() => result.current.onChange("pendiente"));
    rerender({ p: "Ropa/Otra.md" });
    expect(writeText).toHaveBeenCalledWith(PATH, "pendiente");
  });

  it("flushes_pending_edit_on_unmount", async () => {
    const { result, unmount } = await open();
    act(() => result.current.onChange("pendiente"));
    unmount();
    expect(writeText).toHaveBeenCalledWith(PATH, "pendiente");
  });

  it("switching_during_conflict_never_overwrites_the_disk", async () => {
    const { result, rerender } = await open();
    act(() => result.current.onChange("mi texto"));
    disk = "texto de Claude";
    await fsChanged(PATH);
    rerender({ p: "Ropa/Otra.md" });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("Ropa/Telas (mi versión).md", "mi texto");
    expect(writeText).not.toHaveBeenCalledWith(PATH, expect.anything());
  });

  it("failed_read_shows_error_status_not_a_crash", async () => {
    readText.mockRejectedValue({ kind: "NotFound", message: "no existe" });
    const { result } = await open();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/No pude abrir/);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("file_deleted_while_clean_reports_error_and_recovers_when_it_returns", async () => {
    const { result } = await open();
    readText.mockRejectedValueOnce({ kind: "NotFound", message: "no existe" });
    await fsChanged(PATH);
    expect(result.current.status).toBe("error");
    disk = "de vuelta";
    await fsChanged(PATH);
    expect(result.current.status).toBe("clean");
    expect(result.current.content).toBe("de vuelta");
  });

  it("failed_write_keeps_text_pending_and_notifies", async () => {
    const { result } = await open();
    writeText.mockRejectedValueOnce({ kind: "Io", message: "disco lleno" });
    act(() => result.current.onChange("importante"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    });
    expect(result.current.status).toBe("dirty");
    expect(useApp.getState().notice?.message).toMatch(/disco lleno/);
  });
});
