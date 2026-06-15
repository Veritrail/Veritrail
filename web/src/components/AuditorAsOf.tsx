import { createContext, useContext, useState, type ReactNode } from "react";

type AsOfCtx = {
  /** YYYY-MM-DD when sampling a past date, or null for live posture. */
  asOf: string | null;
  setAsOf: (v: string | null) => void;
};

const Ctx = createContext<AsOfCtx>({ asOf: null, setAsOf: () => {} });

export function AuditorAsOfProvider({ children }: { children: ReactNode }) {
  const [asOf, setAsOf] = useState<string | null>(null);
  return <Ctx.Provider value={{ asOf, setAsOf }}>{children}</Ctx.Provider>;
}

export function useAuditorAsOf() {
  return useContext(Ctx);
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Global "sample by date" control. Auditors view posture + evidence as it stood
    on a chosen date. Empty = live. */
export function AuditorAsOfBar() {
  const { asOf, setAsOf } = useAuditorAsOf();
  const today = new Date().toISOString().slice(0, 10);
  const active = asOf != null;

  return (
    <div className={`aud-asof${active ? " aud-asof--active" : ""}`}>
      <div className="aud-asof__status">
        <span className={`aud-asof__pip${active ? " aud-asof__pip--active" : ""}`} aria-hidden />
        {active ? (
          <span>
            Sampling evidence <strong>as of {formatDate(asOf!)}</strong>
          </span>
        ) : (
          <span>
            Viewing <strong>live posture</strong>
          </span>
        )}
      </div>

      <div className="aud-asof__controls">
        <label className="aud-asof__field">
          <span className="aud-asof__field-label">As of date</span>
          <input
            type="date"
            max={today}
            value={asOf ?? today}
            onChange={(e) => setAsOf(e.target.value || null)}
            className="aud-asof__input"
          />
        </label>
        {active && (
          <button type="button" onClick={() => setAsOf(null)} className="aud-asof__reset">
            Back to live
          </button>
        )}
      </div>
    </div>
  );
}
