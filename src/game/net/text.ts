/** Make invisible separators/directional controls visible instead of allowing visual spoofing. */
export function networkText(text: string): string {
  return text.replace(
    /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
