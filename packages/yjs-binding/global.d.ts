// Package-local ambient declarations. The binding imports
// `@excalidraw/excalidraw/types`, so `tsc` (via the monorepo `paths` →
// source) follows into the Excalidraw editor source tree during `gen:types`.
// That source relies on these ambient augmentations, so we pull them in here —
// mirroring `@excalidraw/utils/global.d.ts`, the other leaf package that
// compiles against Excalidraw source.
/// <reference types="vite/client" />
import "@excalidraw/excalidraw/global";
import "@excalidraw/excalidraw/css";
