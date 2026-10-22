import type { MouseEvent } from "react";
import "./site-nav.css";

/** The official AutoLab mark, copied from the site's assets/brand/favicon.svg. */
const BRAND_MARK = `${import.meta.env.BASE_URL}brand-mark.svg`;

export type SiteNavProps = Readonly<{
  /** Marks Build as the current page. False inside the Owner's Guide surface. */
  buildIsCurrent?: boolean;
  /**
   * Inside the configurator's own Owner's Guide surface, Build switches back to
   * the configuration workspace in place instead of reloading the page.
   */
  onBuild?: () => void;
}>;

function isPlainClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * The site navigation shared by every AutoLab page: the brand goes home and
 * Build, Learn and Create lead to the configurator, the Owner's Guide and the
 * 3D creation engine. It sits in the viewport's top-left corner; the page has
 * no top bar.
 */
export function SiteNav({ buildIsCurrent = true, onBuild }: SiteNavProps) {
  const onBuildClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    // The build lives in this page's query string. Following the link to the
    // page it is already on would reset it to the default build.
    event.preventDefault();
    onBuild?.();
  };

  return (
    <nav className="site-nav" aria-label="AutoLab">
      <a className="site-nav__brand" href="../">
        <img src={BRAND_MARK} alt="" width="22" height="22" decoding="async" />
        <span>AutoLab</span>
      </a>
      <ul className="site-nav__links">
        <li>
          <a href="./" aria-current={buildIsCurrent ? "page" : undefined} onClick={onBuildClick}>Build</a>
        </li>
        <li><a href="../garage/">Learn</a></li>
        <li><a href="../engine/">Create</a></li>
      </ul>
    </nav>
  );
}
