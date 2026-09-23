import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ZAYRO Brand Colors — light, cool, premium-service palette
        'zayro-primary': '#3D7DFF', // Blue
        'zayro-primary-deep': '#2557D6',
        'zayro-sky': '#8ED8FF',
        'zayro-violet': '#625CFF',
        'zayro-dark': '#0B1220', // Deep navy (not pure black)
        'zayro-bg': '#F4F8FC', // Cool off-white background
        'zayro-white': '#FFFFFF',
        'zayro-gray': '#5B6472', // Secondary text
        'zayro-border': '#E3E9F2',

        // Semantic colors
        'primary': '#3D7DFF',
        'dark': '#0B1220',
        'light': '#F4F8FC',
        'text-primary': '#0B1220',
        'text-secondary': '#5B6472',
        'border-color': '#E3E9F2',
      },
      backgroundImage: {
        'gradient-cta': 'linear-gradient(135deg, #6FC3FF 0%, #3D7DFF 50%, #5750E8 100%)',
        'gradient-soft': 'linear-gradient(160deg, #EAF4FF 0%, #F4F8FC 60%)',
        'gradient-dark': 'linear-gradient(160deg, #101832 0%, #0B1220 70%)',
      },
      borderRadius: {
        'md-plus': '18px',
        'xl-plus': '28px',
      },
      boxShadow: {
        'soft': '0 8px 24px rgba(11, 18, 32, 0.08)',
        'lift': '0 20px 48px rgba(11, 18, 32, 0.10)',
        'glow': '0 8px 30px rgba(61, 125, 255, 0.35)',
      },
      fontFamily: {
        'sans': ['system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        'xs': '0.75rem',
        'sm': '0.875rem',
        'base': '1rem',
        'lg': '1.125rem',
        'xl': '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
        '4xl': '2.25rem',
        '5xl': '3rem',
        '6xl': '3.75rem',
      },
      spacing: {
        'gutter': '2rem',
        'gutter-lg': '3rem',
        'gutter-xl': '4rem',
      },
      letterSpacing: {
        'tight': '-0.02em',
      },
      lineHeight: {
        'tight': '1.2',
        'snug': '1.375',
        'normal': '1.5',
        'relaxed': '1.625',
        'loose': '2',
      },
      transitionDuration: {
        '250': '250ms',
        '300': '300ms',
      },
    },
  },
  plugins: [],
};

export default config;
