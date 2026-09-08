// Mount the Home exhibit on demand. The iframe owns its tour and discovery state;
// the page owns loading, retry and visibility, without exposing the Garage tools.
export function mountHomeDemo({ demo, play, src }) {
  const doc = demo.ownerDocument, win = doc.defaultView;
  const origin = new URL(src, win.location.href).origin;
  let frame = null, container = null, deadline = null, inView = true;
  const announceVisibility = () => frame?.contentWindow?.postMessage({
    type: "autolab-demo-visibility", visible: inView && !doc.hidden,
  }, origin);
  const clearDeadline = () => { win.clearTimeout(deadline); deadline = null; };
  const restorePlay = () => {
    clearDeadline();
    const hadFocus = container?.contains(doc.activeElement);
    container?.replaceWith(play);
    frame = container = null;
    demo.classList.remove("is-live");
    play.setAttribute("aria-label", "Retry the guided tour");
    const label = play.querySelector(".hero-demo__label");
    if (label) label.textContent = "Couldn’t load · Retry tour";
    if (hadFocus) play.focus({ preventScroll: true });
  };
  const start = () => {
    if (frame) return;
    const ownedFocus = doc.activeElement === play;
    frame = doc.createElement("iframe");
    frame.src = src;
    frame.title = "AutoLab guided tour and interactive vehicle discovery";
    frame.loading = "eager";
    frame.tabIndex = -1;
    container = doc.createElement("div");
    container.className = "hero-demo__frame";
    container.tabIndex = -1;
    container.setAttribute("role", "group");
    container.setAttribute("aria-label", "Guided tour");
    const loading = doc.createElement("div");
    loading.className = "hero-demo__loading";
    loading.setAttribute("role", "status");
    loading.textContent = "Preparing the guided tour…";
    container.append(frame, loading);
    frame.addEventListener("load", announceVisibility);
    play.replaceWith(container);
    if (ownedFocus) container.focus({ preventScroll: true });
    demo.classList.add("is-live");
    deadline = win.setTimeout(restorePlay, 20_000);
  };
  const onMessage = (event) => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== origin) return;
    if (event.data?.type === "autolab-demo-ready") {
      clearDeadline();
      container.querySelector(".hero-demo__loading")?.remove();
      frame.tabIndex = 0;
      announceVisibility();
      if (inView && !doc.hidden && container.contains(doc.activeElement)) frame.focus({ preventScroll: true });
    } else if (event.data?.type === "autolab-demo-error") restorePlay();
  };
  const observer = win.IntersectionObserver ? new win.IntersectionObserver((entries) => {
    const entry = entries.find(item => item.target === demo);
    if (entry) { inView = entry.isIntersecting; announceVisibility(); }
  }, { threshold: 0 }) : null;
  observer?.observe(demo);
  play.addEventListener("click", start);
  win.addEventListener("message", onMessage);
  doc.addEventListener("visibilitychange", announceVisibility);
  return { start, dispose() {
    clearDeadline(); observer?.disconnect();
    play.removeEventListener("click", start);
    win.removeEventListener("message", onMessage);
    doc.removeEventListener("visibilitychange", announceVisibility);
    frame?.remove();
  } };
}
