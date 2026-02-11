/**
 * Single emoji entry in the picker configuration.
 */
export interface InsertEmojiConfigEntry {
  readonly emoji: string;
  readonly label: string;
  readonly keywords?: readonly string[];
  readonly category?: string;
}

/**
 * Complete emoji configuration for the picker.
 */
export interface InsertEmojiConfiguration {
  readonly emojis: readonly InsertEmojiConfigEntry[];
  readonly version: string;
}
