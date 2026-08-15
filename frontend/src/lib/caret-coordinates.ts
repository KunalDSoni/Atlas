// Viewport coordinates of the caret inside a textarea or input.
//
// The DOM exposes no such API, so this uses the standard mirror technique: a
// hidden div is given the field's own computed typography and box metrics, then
// filled with the text up to the caret. A span marks the spot, and its position
// within the mirror maps back onto the real field.
//
// The previous implementation derived a line number from scrollTop alone, which
// does not track the caret at all, and then reported the result in viewport
// coordinates to a `position: absolute` element — two unrelated coordinate
// spaces, so the dropdown landed nowhere near the text.

// Properties that affect where a glyph lands. Copied wholesale onto the mirror.
const COPIED = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
  'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontFamily',
  'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform',
  'textAlign', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize',
] as const;

export interface CaretPoint {
  /** Viewport x of the caret. */
  left: number;
  /** Viewport y of the caret's baseline row top. */
  top: number;
  /** Height of one line, so callers can offset below the text. */
  lineHeight: number;
}

export function getCaretCoordinates(
  field: HTMLTextAreaElement | HTMLInputElement,
  caret: number,
): CaretPoint {
  const style = window.getComputedStyle(field);
  const rect = field.getBoundingClientRect();

  const mirror = document.createElement('div');
  for (const prop of COPIED) {
    mirror.style[prop as any] = style[prop as any];
  }
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '0';
  // A textarea wraps; an input never does.
  mirror.style.whiteSpace = field instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.height = 'auto';

  mirror.textContent = field.value.slice(0, caret);

  const marker = document.createElement('span');
  // A zero-width string would collapse and report no position, so use a
  // character with width and measure its leading edge.
  marker.textContent = field.value.slice(caret) || '.';
  mirror.appendChild(marker);

  document.body.appendChild(mirror);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 16;
  const left = rect.left + marker.offsetLeft - field.scrollLeft;
  const top = rect.top + marker.offsetTop - field.scrollTop;
  document.body.removeChild(mirror);

  return { left, top, lineHeight };
}
