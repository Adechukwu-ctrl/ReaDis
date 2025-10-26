/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eefae9',
          100: '#dbf3d3',
          200: '#bfe8af',
          300: '#9edd83',
          400: '#8fdc3f',
          500: '#37b24d',
          600: '#2f9e44',
          700: '#1f7a36',
          800: '#165c2a',
          900: '#0f3e1d',
        },
      },
    },
  },
  plugins: [],
};
