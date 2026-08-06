import type { ReactNode } from 'react';

/**
 * Converts @mentions in text to styled React span elements.
 * Matches patterns like @john or @john_doe and renders them as badges.
 *
 * @param text The text containing mentions to render
 * @returns React nodes with mentions rendered as styled badges, or plain text if no mentions
 */
export function renderMentions(text: string): ReactNode {
  if (!text || !text.includes('@')) return text;

  // Match @mention patterns: @ followed by alphanumeric characters and underscores
  // This handles typical mention handles like @john_doe or @jane123
  const mentionPattern = /@[\w]+/g;
  const parts: (string | ReactNode)[] = [];
  let lastIndex = 0;

  text.replace(mentionPattern, (match, offset) => {
    // Add text before the mention
    if (offset > lastIndex) {
      parts.push(text.substring(lastIndex, offset));
    }
    // Add the mention as a styled span
    parts.push(
      <span key={`mention-${offset}`} className="mention" title={match}>
        {match}
      </span>
    );
    lastIndex = offset + match.length;
    return match;
  });

  // Add remaining text after the last mention
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  // Return array of parts if we have multiple parts, otherwise return original text
  return parts.length ? parts : text;
}
