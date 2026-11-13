/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./docs/**/*.html"],
  theme: {
    extend: {
      // Steam store palette
      colors: {
        steam: {
          header: "#171a21",
          bg: "#1b2838",
          panel: "#2a475e",
          text: "#c7d5e0",
          muted: "#8f98a0",
          link: "#66c0f4",
          buy: "#5c7e10",
        },
      },
    },
  },
  plugins: [],
};
