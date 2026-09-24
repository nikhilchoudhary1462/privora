/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#F1F3F5',
        'bg-warm': '#FAF9F6',
        card: '#FFFFFF',
        txt: '#212529',
        txt2: '#757575',
        'input-bg': '#E9F2F7',
        purple: '#9C8DD4',
        'purple-btn': '#A99DD8',
        'pill-bg': '#E2E1E6',
        red: '#E77A73',
        green: '#4ADE80',
        background: '#F1F3F5',
        surface: '#FFFFFF',
        'surface-light': '#FAF9F6',
        'surface-hover': '#E2E1E6',
        'surface-border': 'rgba(0,0,0,0.06)',
        primary: '#9C8DD4',
        'primary-light': '#F1EEFB',
        'primary-hover': '#8A7BC7',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['Fira Code', 'monospace'],
      },
      boxShadow: {
        'minimal': '0 4px 12px rgba(0,0,0,0.05)',
        'minimal-hover': '0 12px 32px rgba(0,0,0,0.08)',
        'purple-glow': '0 8px 24px rgba(156,141,212,0.4)',
      },
    },
  },
  plugins: [],
}