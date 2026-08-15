// ===== HTML SANITISATION =====
// Wiki pages are stored as HTML authored by users and rendered into other users'
// browsers. Unsanitised, any author could run script on the app's origin and read
// every viewer's session token. Bodies are cleaned on write so the stored data is
// safe; the client sanitises again on render as defence in depth.

const sanitizeHtml = require('sanitize-html');

const OPTIONS = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'div', 'span', 'blockquote', 'pre', 'code',
    'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark', 'small',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'a', 'img', 'figure', 'figcaption',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    // The seeded pages use inline styles for callouts and tables; keep them but
    // restrict to presentational properties (see allowedStyles).
    //
    // data-mention-id carries the user a mention points at. It is allowlisted
    // by name, not as a blanket data-* rule — the renderer only ever reads it
    // as a lookup key, and nothing else data-shaped should survive from
    // author-supplied HTML.
    '*': ['style', 'class', 'colspan', 'rowspan', 'data-mention-id'],
  },
  // Only http(s) and mailto — blocks javascript:, data:, vbscript:
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  allowedStyles: {
    '*': {
      color: [/^.*$/],
      'background': [/^(?!.*(url|expression|javascript)).*$/i],
      'background-color': [/^(?!.*(url|expression|javascript)).*$/i],
      'text-align': [/^(left|right|center|justify)$/],
      'font-size': [/^[\d.]+(px|em|rem|%)$/],
      'font-family': [/^[\w\s,'"-]+$/],
      'font-weight': [/^(normal|bold|[1-9]00)$/],
      'padding': [/^[\d.\s]+(px|em|rem)?$/],
      'margin': [/^[\d.\s]+(px|em|rem)?$/],
      'border': [/^[\w\s#().,%-]+$/],
      'border-left': [/^[\w\s#().,%-]+$/],
      'border-radius': [/^[\d.\s]+(px|em|rem|%)$/],
      'border-collapse': [/^(collapse|separate)$/],
      'width': [/^[\d.]+(px|em|rem|%)$/],
    },
  },
  // Links out of the wiki should not be able to reach back via window.opener.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
  disallowedTagsMode: 'discard',
};

/** Strip anything executable from user-authored HTML. Returns '' for empty input. */
function sanitizeRichText(html) {
  if (typeof html !== 'string' || !html) return '';
  return sanitizeHtml(html, OPTIONS);
}

module.exports = { sanitizeRichText };
