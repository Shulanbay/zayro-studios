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
        // ZAYRO Brand Colors
        'zayro-primary': '#315CFF', // Electric Blue
        'zayro-dark': '#0A0A0B', // Dark/Black
        'zayro-bg': '#F7F7F5', // Off-white background
        'zayro-white': '#FFFFFF', // White
        'zayro-gray': '#8A8A8F', // Gray

        // Semantic colors
        'primary': '#315CFF',
        'dark': '#0A0A0B',
        'light': '#F7F7F5',
        'text-primary': '#0A0A0B',
        'text-secondary': '#8A8A8F',
        'border-color': '#E5E5E3',
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
