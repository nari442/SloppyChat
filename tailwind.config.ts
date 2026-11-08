import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        md3: {
          primary: 'rgb(var(--md3-primary) / <alpha-value>)',
          onPrimary: 'rgb(var(--md3-on-primary) / <alpha-value>)',
          primaryContainer: 'rgb(var(--md3-primary-container) / <alpha-value>)',
          onPrimaryContainer: 'rgb(var(--md3-on-primary-container) / <alpha-value>)',
          secondary: 'rgb(var(--md3-secondary) / <alpha-value>)',
          onSecondary: 'rgb(var(--md3-on-secondary) / <alpha-value>)',
          secondaryContainer: 'rgb(var(--md3-secondary-container) / <alpha-value>)',
          onSecondaryContainer: 'rgb(var(--md3-on-secondary-container) / <alpha-value>)',
          tertiary: 'rgb(var(--md3-tertiary) / <alpha-value>)',
          onTertiary: 'rgb(var(--md3-on-tertiary) / <alpha-value>)',
          tertiaryContainer: 'rgb(var(--md3-tertiary-container) / <alpha-value>)',
          onTertiaryContainer: 'rgb(var(--md3-on-tertiary-container) / <alpha-value>)',
          error: 'rgb(var(--md3-error) / <alpha-value>)',
          onError: 'rgb(var(--md3-on-error) / <alpha-value>)',
          errorContainer: 'rgb(var(--md3-error-container) / <alpha-value>)',
          onErrorContainer: 'rgb(var(--md3-on-error-container) / <alpha-value>)',
          background: 'rgb(var(--md3-background) / <alpha-value>)',
          onBackground: 'rgb(var(--md3-on-background) / <alpha-value>)',
          surface: 'rgb(var(--md3-surface) / <alpha-value>)',
          onSurface: 'rgb(var(--md3-on-surface) / <alpha-value>)',
          surfaceVariant: 'rgb(var(--md3-surface-variant) / <alpha-value>)',
          onSurfaceVariant: 'rgb(var(--md3-on-surface-variant) / <alpha-value>)',
          outline: 'rgb(var(--md3-outline) / <alpha-value>)',
          outlineVariant: 'rgb(var(--md3-outline-variant) / <alpha-value>)',
          surfaceContainerLow: 'rgb(var(--md3-surface-container-low) / <alpha-value>)',
          surfaceContainer: 'rgb(var(--md3-surface-container) / <alpha-value>)',
          surfaceContainerHigh: 'rgb(var(--md3-surface-container-high) / <alpha-value>)',
          surfaceContainerHighest: 'rgb(var(--md3-surface-container-highest) / <alpha-value>)',
          inverseSurface: 'rgb(var(--md3-inverse-surface) / <alpha-value>)',
          inverseOnSurface: 'rgb(var(--md3-inverse-on-surface) / <alpha-value>)',
          inversePrimary: 'rgb(var(--md3-inverse-primary) / <alpha-value>)'
        }
      },
      boxShadow: {
        lift: '0 20px 60px -32px var(--md3-shadow)'
      }
    }
  },
  plugins: []
} satisfies Config
