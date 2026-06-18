import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FontAwesome5, FontAwesome } from '@expo/vector-icons';
import { Mail } from 'lucide-react-native';
import { Colors, Fonts } from '../constants/theme';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');

export default function LoginScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      
      {/* Glow Effect (Top Right) */}
      <View style={styles.glowEffect} pointerEvents="none" />
      <LinearGradient
        colors={['rgba(255, 107, 53, 0.15)', 'transparent']}
        style={styles.glowGradient}
        pointerEvents="none"
      />

      {/* Watermark */}
      <Text style={styles.watermark} pointerEvents="none" allowFontScaling={false}>
        記
      </Text>

      {/* Main Content Area */}
      <View style={styles.content}>
        
        {/* Branding Section */}
        <View style={styles.branding}>
          <View style={styles.appIconContainer}>
            <View style={styles.appIcon}>
              <Text style={styles.appIconText}>記</Text>
            </View>
          </View>
          
          <Text style={styles.title}>Kioku</Text>
          <Text style={styles.subtitle}>記憶</Text>

          <Text style={styles.description}>
            日本語を、正しく。{'\n'}職人品質の単語学習。
          </Text>
        </View>

        {/* Spacer */}
        <View style={styles.spacer} />

        {/* Actions Section */}
        <View style={styles.actions}>
          {/* Apple Button */}
          <TouchableOpacity style={[styles.button, styles.appleButton]} activeOpacity={0.8}>
            <View style={styles.buttonIcon}>
              <FontAwesome5 name="apple" size={22} color="#000" />
            </View>
            <Text style={[styles.buttonText, styles.appleButtonText]}>Apple でサインイン</Text>
          </TouchableOpacity>

          {/* Google Button */}
          <TouchableOpacity style={[styles.button, styles.googleButton]} activeOpacity={0.8}>
            <View style={styles.buttonIcon}>
              <FontAwesome name="google" size={20} color="#EA4335" />
            </View>
            <Text style={[styles.buttonText, styles.googleButtonText]}>Google で続行</Text>
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.dividerContainer}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>または</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Email Button */}
          <TouchableOpacity style={[styles.button, styles.emailButton]} activeOpacity={0.8}>
            <View style={styles.buttonIcon}>
              <Mail size={18} color="#FFF" />
            </View>
            <Text style={[styles.buttonText, styles.emailButtonText]}>メールで続ける</Text>
          </TouchableOpacity>

          {/* Terms Text */}
          <Text style={styles.termsText}>
            続行すると利用規約とプライバシーに同意したものとみなされます。
          </Text>
        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0C10',
  },
  glowEffect: {
    position: 'absolute',
    top: -100,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: Colors.dark.primaryOrange,
    opacity: 0.1,
    shadowColor: Colors.dark.primaryOrange,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 100,
    elevation: 20,
  },
  glowGradient: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: width,
    height: height * 0.5,
  },
  watermark: {
    position: 'absolute',
    top: height * 0.05,
    left: -40,
    fontSize: 400,
    fontWeight: 'bold',
    color: '#FFFFFF',
    opacity: 0.03,
    fontFamily: Platform.OS === 'ios' ? 'Hiragino Mincho ProN' : 'serif',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: height * 0.15,
    paddingBottom: 20,
  },
  branding: {
    alignItems: 'center',
  },
  appIconContainer: {
    shadowColor: Colors.dark.primaryOrange,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 25,
    elevation: 15,
    marginBottom: 24,
  },
  appIcon: {
    width: 88,
    height: 88,
    backgroundColor: Colors.dark.primaryOrange,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appIconText: {
    fontSize: 44,
    fontWeight: '900',
    color: '#0B0C10',
    fontFamily: Platform.OS === 'ios' ? 'Hiragino Mincho ProN' : 'serif',
  },
  title: {
    fontSize: 44,
    color: '#FFFFFF',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.primaryOrange,
    letterSpacing: 4,
    marginBottom: 32,
  },
  description: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    lineHeight: 26,
    letterSpacing: 0.5,
  },
  spacer: {
    flex: 1,
  },
  actions: {
    width: '100%',
    gap: 14,
  },
  button: {
    flexDirection: 'row',
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonIcon: {
    position: 'absolute',
    left: 20,
    justifyContent: 'center',
    alignItems: 'center',
    width: 24,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  appleButton: {
    backgroundColor: '#FFFFFF',
  },
  appleButtonText: {
    color: '#000000',
  },
  googleButton: {
    backgroundColor: '#16171B',
    borderWidth: 1,
    borderColor: '#2E3135',
  },
  googleButtonText: {
    color: '#FFFFFF',
  },
  emailButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#2E3135',
  },
  emailButtonText: {
    color: '#FFFFFF',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
    paddingHorizontal: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#2E3135',
  },
  dividerText: {
    color: '#707070',
    marginHorizontal: 16,
    fontSize: 12,
  },
  termsText: {
    color: '#707070',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 18,
  },
});
