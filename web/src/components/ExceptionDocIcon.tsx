import { useState } from "react";

const SIZE_CLASS = {
  sm: "h-9 w-9 rounded-lg",
  md: "h-[72px] w-[72px] rounded-2xl",
} as const;

export function ExceptionDocIcon({ size = "md" }: { size?: keyof typeof SIZE_CLASS }) {
  const [failed, setFailed] = useState(false);
  const cls = `${SIZE_CLASS[size]} shrink-0 object-contain`;

  if (failed) {
    return (
      <svg className={cls} viewBox="0 0 48 48" fill="none" aria-hidden>
        <rect x="2" y="2" width="44" height="44" rx="13" fill="#E7E6FB" />
        <path d="M15 13h11l6 6v15a2 2 0 0 1-2 2H15a2 2 0 0 1-2-2V15a2 2 0 0 1 2-2Z" fill="#6E72E4" />
        <path d="M26 13l6 6h-4.5A1.5 1.5 0 0 1 26 17.5V13Z" fill="#ADAEF1" />
        <rect x="17" y="23" width="10" height="2.6" rx="1.3" fill="#AEB0F2" />
        <rect x="17" y="28" width="6.5" height="2.6" rx="1.3" fill="#AEB0F2" />
        <path
          d="M30.5 26.5l6.2 2.25v4.4c0 3.6-2.45 6.6-6.2 7.7-3.75-1.1-6.2-4.1-6.2-7.7v-4.4l6.2-2.25Z"
          fill="#6366F1"
          stroke="#ffffff"
          strokeWidth="2.3"
          strokeLinejoin="round"
        />
        <path d="m27.6 33 1.9 1.9 3.4-3.6" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <img
      src="/exception-shield.png"
      alt=""
      aria-hidden
      onError={() => setFailed(true)}
      className={cls}
    />
  );
}
