// Remote control («Cel»): mirrors the backend process that lets the Claude phone app drive a session.
import { create } from "zustand";
import { api, errorMessage, onRemoteEvent, type RemoteStatus } from "../../lib/api";

interface RemoteState {
  status: RemoteStatus;
  /** Subscribes to backend events once and loads the current status. Safe to call repeatedly. */
  init(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  trust(): Promise<void>;
}

const OFF: RemoteStatus = { state: "off" };
let initialized = false;

const fail = (e: unknown): RemoteStatus => ({ state: "error", message: errorMessage(e) });

export const useRemote = create<RemoteState>((set) => ({
  status: OFF,
  async init() {
    if (initialized) return;
    initialized = true;
    try {
      let sawEvent = false;
      await onRemoteEvent((status) => {
        sawEvent = true;
        set({ status });
      });
      const current = await api.remoteStatus();
      if (!sawEvent) set({ status: current }); // a newer event wins over this snapshot
    } catch {
      // Outside Tauri (or an old backend) the button just stays off.
    }
  },
  async start() {
    set({ status: { state: "starting" } });
    try {
      set({ status: await api.remoteStart() });
    } catch (e) {
      set({ status: fail(e) });
    }
  },
  async stop() {
    try {
      set({ status: await api.remoteStop() });
    } catch (e) {
      set({ status: fail(e) });
    }
  },
  async trust() {
    try {
      await api.remoteTrust();
    } catch (e) {
      set({ status: fail(e) });
    }
  },
}));

export function resetRemoteForTests() {
  initialized = false;
  useRemote.setState({ status: OFF });
}
