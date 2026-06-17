import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Line } from 'react-native-svg';
import Animated, { 
    useSharedValue, 
    useAnimatedProps, 
    withTiming, 
    withDelay, 
    Easing,
    cancelAnimation
} from 'react-native-reanimated';
import { Colors, BORDER_RADIUS } from '../../constants/theme';
import { useSettings } from '../../context/SettingsContext';

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface KanjiStrokeBoardProps {
    paths: string[];
    // To trigger an animation sequence from 0
    trigger: number; 
    // To highlight a specific stroke (1-indexed). If 0, no specific highlight.
    activeStroke?: number; 
    // Optional explicit size. Defaults to full width minus padding if not provided.
    size?: number;
    // Hide crosshairs if false (defaults to true)
    showGuidelines?: boolean;
}

const PATH_LENGTH = 1000;
const { width } = Dimensions.get('window');
const DEFAULT_BOARD_SIZE = width - 64;

export const KanjiStrokeBoard: React.FC<KanjiStrokeBoardProps> = ({ paths, trigger, activeStroke = 0, size, showGuidelines = true }) => {
    
    const { strokeSpeed } = useSettings();

    // Create a shared value for each stroke
    const progressValues = paths.map(() => useSharedValue(0));

    useEffect(() => {
        // Reset all
        progressValues.forEach(v => {
            cancelAnimation(v);
            v.value = 0;
        });

        // Staggered animation
        if (activeStroke === 0) {
            // Animate all sequentially
            paths.forEach((_, index) => {
                // Delay based on speed, plus a little buffer
                progressValues[index].value = withDelay(
                    index * (strokeSpeed + 100),
                    withTiming(1, { duration: strokeSpeed, easing: Easing.inOut(Easing.ease) })
                );
            });
        } else {
            // Animate only the active stroke immediately
            paths.forEach((_, index) => {
                if (index === activeStroke - 1) {
                    progressValues[index].value = withTiming(1, { duration: strokeSpeed, easing: Easing.inOut(Easing.ease) });
                } else if (index < activeStroke - 1) {
                    // Previous strokes are already fully drawn
                    progressValues[index].value = 1;
                } else {
                    // Future strokes are hidden
                    progressValues[index].value = 0;
                }
            });
        }
    }, [trigger, activeStroke]);

    const actualSize = size || DEFAULT_BOARD_SIZE;
    const padding = size ? size * 0.22 : 24; // Scale padding with size

    return (
        <View style={[styles.board, { width: actualSize, height: actualSize, padding }]}>
            <Svg viewBox="0 0 109 109" style={styles.svg}>
                {/* Crosshairs */}
                {showGuidelines && (
                    <>
                        <Line x1="54.5" y1="0" x2="54.5" y2="109" stroke="#2E3135" strokeWidth="2" strokeDasharray="4 4" />
                        <Line x1="0" y1="54.5" x2="109" y2="54.5" stroke="#2E3135" strokeWidth="2" strokeDasharray="4 4" />
                    </>
                )}

                {/* Base strokes (background ghost) */}
                {paths.map((d, index) => (
                    <Path
                        key={`ghost-${index}`}
                        d={d}
                        stroke="#1C1D22" // Dark ghost color
                        strokeWidth="5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                    />
                ))}

                {/* Animated strokes */}
                {paths.map((d, index) => {
                    const isHighlight = activeStroke === index + 1;
                    const strokeColor = isHighlight ? Colors.dark.primaryOrange : Colors.dark.text;

                    const animatedProps = useAnimatedProps(() => {
                        return {
                            strokeDashoffset: PATH_LENGTH * (1 - progressValues[index].value)
                        };
                    });

                    return (
                        <AnimatedPath
                            key={`anim-${index}`}
                            d={d}
                            stroke={strokeColor}
                            strokeWidth="5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                            strokeDasharray={PATH_LENGTH}
                            animatedProps={animatedProps}
                        />
                    );
                })}
            </Svg>
        </View>
    );
};

const styles = StyleSheet.create({
    board: {
        backgroundColor: '#121316',
        borderRadius: BORDER_RADIUS.xl,
        borderWidth: 1,
        borderColor: '#2E3135',
        alignSelf: 'center',
    },
    svg: {
        flex: 1,
    }
});
