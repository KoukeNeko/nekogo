import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors, Spacing } from '../../constants/theme';

interface LibraryItemProps {
    name: string;
    license: string;
    description: string;
    url: string;
}

export const LibraryItem = ({ name, license, description, url }: LibraryItemProps) => (
    <TouchableOpacity 
        style={styles.container}
        onPress={() => url && Linking.openURL(url)}
        activeOpacity={0.7}
    >
        <View style={styles.textContainer}>
            <Text style={styles.itemName}>{name}</Text>
            <Text style={styles.licenseText}>{license}</Text>
            <Text style={styles.descriptionText}>{description}</Text>
        </View>
        <ChevronRight size={20} color={Colors.dark.textSecondary} />
    </TouchableOpacity>
);

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    textContainer: {
        flex: 1,
        paddingRight: Spacing.four,
    },
    itemName: {
        fontSize: 16,
        fontWeight: 'bold',
        color: Colors.dark.text,
        marginBottom: Spacing.one,
    },
    licenseText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#68A5FF',
        marginBottom: Spacing.two,
    },
    descriptionText: {
        fontSize: 14,
        color: Colors.dark.textSecondary,
        lineHeight: 20,
    }
});
