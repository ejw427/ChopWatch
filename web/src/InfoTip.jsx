import { useId, useState } from "react";

/**
 * Hover/focus tooltip. Wrap status pills or labels.
 */
export default function InfoTip({ text, children, wide }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!text) return children;

  return (
    <span
      className={`info-tip${wide ? " wide" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span
        className="info-tip-anchor"
        tabIndex={0}
        aria-describedby={open ? id : undefined}
      >
        {children}
      </span>
      {open && (
        <span role="tooltip" id={id} className="info-tip-bubble">
          {text}
        </span>
      )}
    </span>
  );
}
