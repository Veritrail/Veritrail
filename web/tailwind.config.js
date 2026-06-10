/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontSize: {
        caption: ["11px", { lineHeight: "1.35", letterSpacing: "0.04em" }],
        meta: ["13px", { lineHeight: "1.4" }],
        body: ["14px", { lineHeight: "1.35", letterSpacing: "-0.01em" }],
        subtitle: ["15px", { lineHeight: "1.35" }],
      },
      keyframes: {
        "scan-indeterminate": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
        "toast-in": {
          "0%": { opacity: "0", transform: "translate(-50%, 12px)" },
          "100%": { opacity: "1", transform: "translate(-50%, 0)" },
        },
      },
      animation: {
        "scan-indeterminate": "scan-indeterminate 1.8s ease-in-out infinite",
        "toast-in": "toast-in 200ms ease-out",
      },
    },
  },
  plugins: [],
};
