import { create } from "zustand";

export const useMarkdown = create<{
  modes: Record<string, "source" | "preview">;
  setMode: (file: string, mode: "source" | "preview") => void;
  fragment: { file: string; value: string; serial: number } | null;
  navigate: (file: string, value: string) => void;
}>((set) => ({
  modes: {}, fragment: null,
  setMode: (file, mode) => set((s) => ({ modes: { ...s.modes, [file]: mode } })),
  navigate: (file, value) => set((s) => ({ modes: { ...s.modes, [file]: "preview" }, fragment: { file, value, serial: (s.fragment?.serial ?? 0) + 1 } })),
}));
