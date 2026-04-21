/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0fafa',
          100: '#d0f0f0',
          200: '#a0e0e0',
          300: '#60c8c8',
          400: '#30b0b0',
          500: '#0d9488',
          600: '#0b7a70',
          700: '#096058',
          800: '#074840',
          900: '#053028',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    }
  },
  plugins: []
}
