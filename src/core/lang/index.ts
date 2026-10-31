/**
 * Marks a branch the type system has proven unreachable. Adding a member to a
 * union without handling it turns every `switch` that ends here into a compile
 * error, which is how new formats and node types find all their call sites.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${JSON.stringify(value)}`);
}

/** `text` as a regular expression source that matches it literally. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A character class matching any one of `chars`, e.g. `[*_~]`. */
export function charClass(chars: readonly string[]): string {
  return `[${chars.map((char) => char.replace(/[\]\\^-]/g, '\\$&')).join('')}]`;
}
