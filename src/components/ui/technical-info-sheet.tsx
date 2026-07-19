import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BORDER_RADIUS, Colors, Fonts, Spacing } from '../../constants/theme';

export interface TechnicalInfoRow {
  label: string;
  value: string;
}

export interface TechnicalInfoSection {
  title: string;
  rows: TechnicalInfoRow[];
}

interface TechnicalInfoSheetProps {
  modalRef: React.RefObject<BottomSheetModal | null>;
  sections: TechnicalInfoSection[];
  title?: string;
}

export function TechnicalInfoSheet({
  modalRef,
  sections,
  title = '技術情報',
}: TechnicalInfoSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <BottomSheetModal
      ref={modalRef}
      index={0}
      snapPoints={['55%', '85%']}
      enablePanDownToClose
      backdropComponent={(props) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.6}
        />
      )}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handle}
    >
      <View style={styles.header}>
        <Text style={styles.title} selectable>{title}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="技術情報を閉じる"
          onPress={() => modalRef.current?.dismiss()}
          style={styles.closeButton}
        >
          <Text style={styles.closeText}>閉じる</Text>
        </TouchableOpacity>
      </View>

      <BottomSheetScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, Spacing.four) }]}
        showsVerticalScrollIndicator
      >
        {sections.filter((section) => section.rows.length > 0).map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle} selectable>{section.title}</Text>
            <View style={styles.card}>
              {section.rows.map((row, index) => (
                <View
                  key={`${row.label}-${index}`}
                  style={[styles.row, index > 0 && styles.rowBorder]}
                >
                  <Text style={styles.label} selectable>{row.label}</Text>
                  <Text style={styles.value} selectable>{row.value}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: '#16171B',
  },
  handle: {
    backgroundColor: '#555861',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  title: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  closeText: {
    color: Colors.dark.textSecondary,
    fontSize: 15,
  },
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    letterSpacing: 1.5,
  },
  card: {
    backgroundColor: '#111216',
    borderWidth: 1,
    borderColor: '#2E3135',
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.one,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#2E3135',
  },
  label: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
  },
  value: {
    color: Colors.dark.text,
    fontSize: 14,
    fontFamily: Fonts?.mono,
    lineHeight: 20,
  },
});
