// Renders stored text with its mentions highlighted, for React Native.
//
// The web renders mentions into DOM spans; there is no dangerouslySetInnerHTML
// here, so tokens map to styled <Text> runs instead. The resolution rules are
// the web's: the badge shows the person's current name from the directory, and
// an id that does not resolve renders as plain text rather than a badge.

import { Text, StyleSheet, type TextProps } from 'react-native';
import { expandLegacyMentions, tokenizeMentions } from '../utils/mentions';
import { useUserDirectory } from '../hooks/useUserDirectory';

export function MentionText({
  text,
  style,
  ...rest
}: { text: string | null | undefined } & TextProps) {
  const directory = useUserDirectory();
  if (!text) return null;

  const segments = expandLegacyMentions(tokenizeMentions(text), directory.nameIndex);

  return (
    <Text style={style} {...rest}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <Text key={i}>{seg.value}</Text>;

        const user = directory.byId.get(seg.id);
        // Until the directory arrives, trust the stored name rather than
        // flashing prose where a badge is about to appear.
        if (!user && directory.loaded) return <Text key={i}>@{seg.name}</Text>;

        const inactive = user ? user.is_active === 0 : false;
        return (
          <Text key={i} style={inactive ? styles.inactive : styles.mention}>
            @{user?.name ?? seg.name}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  mention: { color: '#0066cc', fontWeight: '600' },
  inactive: { color: '#94a3b8', textDecorationLine: 'line-through' },
});
