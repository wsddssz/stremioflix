/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        netflix: {
          black: '#141414',
          dark: '#181818',
          card: '#222222',
          red: '#E50914',
          redHover: '#F6121D',
          gray: '#808080',
          light: '#E5E5E5',
        },
      },
      fontFamily: {
        netflix: ['"Netflix Sans"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 0 12px rgba(0,0,0,0.8)',
        modal: '0 24px 80px rgba(0,0,0,0.85)',
      },
    },
  },
  plugins: [],
};
