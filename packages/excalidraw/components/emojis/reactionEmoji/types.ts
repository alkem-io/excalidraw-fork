/**
 * Single emoji entry in the picker configuration.
 */
export interface EmojiReactionConfigEntry {
  readonly emoji: string;
  readonly label: string;
  readonly keywords?: readonly string[];
  readonly category?: string;
}

/**
 * Complete emoji configuration for the picker.
 */
export interface EmojiReactionConfiguration {
  readonly emojis: readonly EmojiReactionConfigEntry[];
  readonly version: string;
}
