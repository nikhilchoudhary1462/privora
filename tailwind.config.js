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
        background: '#f8fafc',
        surface: '#ffffff',
        'surface-light': '#f1f5f9',
        'surface-hover': '#e2e8f0',
        'surface-border': '#e2e8f0',
        primary: '#4f46e5',
        'primary-light': '#eef2ff',
        'primary-hover': '#4338ca',
        accent: '#0284c7',
        'accent-purple': '#7c3aed',
        'accent-green': '#059669',
        'accent-rose': '#e11d48',
        'accent-amber': '#d97706',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['Fira Code', 'JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'glass': '0 8px 30px rgba(0, 0, 0, 0.04)',
        'glass-hover': '0 14px 35px rgba(0, 0, 0, 0.08)',
        'glow-primary': '0 0 25px -5px rgba(79, 70, 229, 0.25)',
        'glow-emerald': '0 0 25px -5px rgba(5, 150, 105, 0.25)',
      },
    },
  },
  plugins: [],
}