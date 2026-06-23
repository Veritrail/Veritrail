import type { BrowserId } from "../lib/browserDetect";
import { BROWSER_FAVICON } from "../lib/browserBrands";

type Props = {
  browser: BrowserId;
  className?: string;
};

export function BrowserIcon({ browser, className = "h-6 w-6" }: Props) {
  return (
    <img
      src={BROWSER_FAVICON[browser]}
      alt=""
      className={`${className} shrink-0 object-contain`}
      draggable={false}
    />
  );
}
