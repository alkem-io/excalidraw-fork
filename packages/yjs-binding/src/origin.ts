/**
 * The binding's transaction-origin sentinel.
 *
 * Every Yjs write the binding performs is wrapped in
 * `ydoc.transact(fn, BINDING_ORIGIN)`. The observe/observeDeep handlers
 * short-circuit when `transaction.origin === BINDING_ORIGIN`, which is how the
 * binding ignores its own writes and avoids a re-entrant `updateScene` feedback
 * loop (FR-B-004, the echo guard).
 *
 * It is a unique, opaque object — identity is the only thing that matters, so it
 * is compared by reference. One module-level singleton is shared by every helper
 * so a write made in `diff.ts` is recognised as "ours" by the observer in
 * `apply.ts`.
 */
export const BINDING_ORIGIN: { readonly name: "alkemio-yjs-binding" } = {
  name: "alkemio-yjs-binding",
};

export type BindingOrigin = typeof BINDING_ORIGIN;
