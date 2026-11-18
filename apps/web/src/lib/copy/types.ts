// Live text: web-only shapes. Everything the API sends or takes (CopyState, CopyAdminState, CopyCatalog, …)
// lives in packages/shared/src/types.ts and is imported from `#shared`.

/** An unpublished edit by the owner. `text: null` means "back to the words in the code". */
export interface Pending {
  text: string | null;
  /** The default from the code the edit was written against (its hash is the key's). */
  original: string;
  context: string | null;
}
