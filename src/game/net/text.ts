const INVISIBLE_FORMAT = /\p{Cf}|\p{Cc}|\p{Zl}|\p{Zp}/u;

/** Make invisible separators/directional controls visible instead of allowing visual spoofing. */
export function networkText(text: string): string {
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0)!;
    const invisible =
      INVISIBLE_FORMAT.test(character) ||
      code < 32 ||
      (code >= 127 && code <= 159) ||
      code === 0xad ||
      code === 0x34f ||
      code === 0x61c ||
      code === 0x180e ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff;
    out += invisible
      ? code > 0xffff
        ? `\\u{${code.toString(16)}}`
        : `\\u${code.toString(16).padStart(4, '0')}`
      : character;
  }
  return out;
}
