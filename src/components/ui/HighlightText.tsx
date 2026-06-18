import React from 'react';
import { Text, StyleProp, TextStyle } from 'react-native';
import { Colors } from '../../constants/theme';

interface HighlightTextProps {
  text: string;
  highlight: string;
  style?: StyleProp<TextStyle>;
  highlightStyle?: StyleProp<TextStyle>;
}

export function HighlightText({ text, highlight, style, highlightStyle }: HighlightTextProps) {
  if (!highlight.trim()) {
    return <Text style={style}>{text}</Text>;
  }

  // Escape special regex characters in the highlight string
  const escapeRegExp = (string: string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  const regex = new RegExp(`(${escapeRegExp(highlight)})`, 'gi');
  const parts = text.split(regex);

  return (
    <Text style={style}>
      {parts.map((part, index) =>
        regex.test(part) ? (
          <Text key={index} style={[highlightStyle, { color: Colors.dark.primaryOrange }]}>
            {part}
          </Text>
        ) : (
          <Text key={index}>{part}</Text>
        )
      )}
    </Text>
  );
}
