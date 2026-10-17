import { useId } from "react";
import type { AgentStatus, MascotLook, MascotShape } from "@/lib/types";
import { mix } from "@/lib/color";
import { RIVE_MIN_SIZE, RiveMascot } from "./RiveMascot";

/*
 * Placeholder plush mascots drawn in SVG: a shaded body with a fuzz filter,
 * eyes, and one accessory. All geometry lives in a 100x100 box.
 */

interface Anchor {
  cx: number;
  eyeY: number;
  eyeDx: number;
  top: number;
  bottom: number;
  halfW: number;
}

const ANCHORS: Record<MascotShape, Anchor> = {
  cloud: { cx: 52, eyeY: 58, eyeDx: 8, top: 25, bottom: 90, halfW: 37 },
  pear: { cx: 50, eyeY: 62, eyeDx: 9, top: 22, bottom: 94, halfW: 28 },
  bean: { cx: 50, eyeY: 50, eyeDx: 8, top: 22, bottom: 94, halfW: 24 },
  heart: { cx: 50, eyeY: 52, eyeDx: 10, top: 30, bottom: 90, halfW: 34 },
  egg: { cx: 50, eyeY: 58, eyeDx: 9, top: 18, bottom: 94, halfW: 32 },
  frog: { cx: 50, eyeY: 42, eyeDx: 16, top: 31, bottom: 90, halfW: 34 },
  blob: { cx: 50, eyeY: 56, eyeDx: 9, top: 29, bottom: 91, halfW: 34 },
  pixel: { cx: 50, eyeY: 55, eyeDx: 10, top: 25, bottom: 95, halfW: 35 },
};

function Body({ shape, fill }: { shape: MascotShape; fill: string }) {
  switch (shape) {
    case "cloud":
      return (
        <g fill={fill}>
          <circle cx="36" cy="60" r="21" />
          <circle cx="55" cy="47" r="23" />
          <circle cx="72" cy="62" r="18" />
          <circle cx="52" cy="70" r="20" />
          <circle cx="31" cy="72" r="14" />
          <circle cx="70" cy="76" r="13" />
        </g>
      );
    case "pear":
      return (
        <path
          fill={fill}
          d="M50 22C60 22 64 33 62 42C74 50 80 62 78 74C76 88 64 94 50 94C36 94 24 88 22 74C20 62 26 50 38 42C36 33 40 22 50 22Z"
        />
      );
    case "bean":
      return <rect fill={fill} x="26" y="22" width="48" height="72" rx="24" transform="rotate(-8 50 58)" />;
    case "heart":
      return (
        <path
          fill={fill}
          d="M50 90C26 75 14 61 16 45C18 31 30 25 40 27C46 28 49 32 50 35C51 32 54 28 60 27C70 25 82 31 84 45C86 61 74 75 50 90Z"
        />
      );
    case "egg":
      return (
        <path
          fill={fill}
          d="M50 18C68 18 82 44 82 64C82 82 68 94 50 94C32 94 18 82 18 64C18 44 32 18 50 18Z"
        />
      );
    case "frog":
      return (
        <g fill={fill}>
          <ellipse cx="50" cy="66" rx="35" ry="25" />
          <circle cx="34" cy="43" r="12" />
          <circle cx="66" cy="43" r="12" />
        </g>
      );
    case "blob":
      return <ellipse fill={fill} cx="50" cy="60" rx="34" ry="31" />;
    case "pixel": {
      const cells: React.ReactNode[] = [];
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 7; c++) {
          const corner = (r === 0 || r === 6) && (c === 0 || c === 6);
          if (!corner) cells.push(<rect key={`${r}-${c}`} x={15 + c * 10} y={25 + r * 10} width="10.4" height="10.4" />);
        }
      return <g fill={fill}>{cells}</g>;
    }
  }
}

function Eyes({ a, look }: { a: Anchor; look: MascotLook }) {
  const xs = [a.cx - a.eyeDx, a.cx + a.eyeDx];
  if (look.shape === "pixel") {
    return (
      <g fill="#141414">
        {xs.map((x) => (
          <rect key={x} x={x - 3} y={a.eyeY - 5} width="6" height="10" />
        ))}
      </g>
    );
  }
  return (
    <g>
      {look.shape === "frog" &&
        xs.map((x) => <circle key={`w${x}`} cx={x} cy={a.eyeY} r="7" fill="#fff" />)}
      {xs.map((x) =>
        look.eyes === "diamond" ? (
          <g key={x}>
            <polygon points={`${x},${a.eyeY - 5} ${x + 4},${a.eyeY} ${x},${a.eyeY + 5} ${x - 4},${a.eyeY}`} fill="#141414" />
            <circle cx={x + 1} cy={a.eyeY - 1.6} r="1" fill="#fff" />
          </g>
        ) : (
          <g key={x}>
            <ellipse cx={x} cy={a.eyeY} rx="3.4" ry="4.8" fill="#141414" />
            <circle cx={x + 1} cy={a.eyeY - 1.8} r="1.1" fill="#fff" />
          </g>
        ),
      )}
      {look.cheeks &&
        xs.map((x, i) => (
          <ellipse
            key={`c${x}`}
            cx={x + (i === 0 ? -6 : 6)}
            cy={a.eyeY + 8}
            rx="5"
            ry="3"
            fill="#ff8fa3"
            opacity="0.55"
          />
        ))}
    </g>
  );
}

function Accessory({ a, look }: { a: Anchor; look: MascotLook }) {
  const { cx, top, eyeY, eyeDx, bottom, halfW } = a;
  const ink = "#1d1d21";
  const glasses = (
    <g fill="rgba(255,255,255,0.18)" stroke={ink} strokeWidth="2.4">
      <circle cx={cx - eyeDx} cy={eyeY} r="7.5" />
      <circle cx={cx + eyeDx} cy={eyeY} r="7.5" />
      <path d={`M${cx - eyeDx + 7.5} ${eyeY - 1}Q${cx} ${eyeY - 4} ${cx + eyeDx - 7.5} ${eyeY - 1}`} fill="none" />
    </g>
  );
  const bowtie = (
    <g fill="#d9434f">
      <path d={`M${cx} ${bottom - 12}L${cx - 11} ${bottom - 19}L${cx - 11} ${bottom - 5}Z`} />
      <path d={`M${cx} ${bottom - 12}L${cx + 11} ${bottom - 19}L${cx + 11} ${bottom - 5}Z`} />
      <circle cx={cx} cy={bottom - 12} r="2.8" fill="#b8323e" />
    </g>
  );
  switch (look.accessory) {
    case "beret":
      return (
        <g>
          <ellipse cx={cx - 2} cy={top + 1} rx="25" ry="11" transform={`rotate(-14 ${cx - 2} ${top + 1})`} fill={ink} />
          <ellipse cx={cx - 6} cy={top - 2} rx="15" ry="4" transform={`rotate(-14 ${cx - 6} ${top - 2})`} fill="#3a3a40" opacity="0.6" />
          <rect x={cx - 4} y={top - 13} width="3.4" height="6" rx="1.5" fill={ink} transform={`rotate(-14 ${cx} ${top - 10})`} />
        </g>
      );
    case "glasses":
      return glasses;
    case "bowtie":
      return bowtie;
    case "glasses-bowtie":
      return (
        <g>
          {glasses}
          {bowtie}
        </g>
      );
    case "cap":
      return (
        <g>
          <path d={`M${cx - 19} ${top + 8}A19 15 0 0 1 ${cx + 19} ${top + 8}Z`} fill="#2d3a8c" />
          <ellipse cx={cx + 14} cy={top + 8} rx="15" ry="3.6" fill="#24306f" />
          <circle cx={cx} cy={top - 6.5} r="2" fill="#24306f" />
        </g>
      );
    case "headphones":
      return (
        <g>
          <path
            d={`M${cx - halfW + 3} ${eyeY - 4}C${cx - halfW + 3} ${top - 16} ${cx + halfW - 3} ${top - 16} ${cx + halfW - 3} ${eyeY - 4}`}
            fill="none"
            stroke="#2b2b30"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <rect x={cx - halfW - 3} y={eyeY - 12} width="10" height="17" rx="4.5" fill="#2b2b30" />
          <rect x={cx + halfW - 7} y={eyeY - 12} width="10" height="17" rx="4.5" fill="#2b2b30" />
        </g>
      );
    case "flower": {
      const fx = cx + halfW * 0.5;
      const fy = top + 4;
      return (
        <g>
          {[0, 72, 144, 216, 288].map((deg) => (
            <circle
              key={deg}
              cx={fx + 4.6 * Math.cos((deg * Math.PI) / 180)}
              cy={fy + 4.6 * Math.sin((deg * Math.PI) / 180)}
              r="4.2"
              fill="#fff"
            />
          ))}
          <circle cx={fx} cy={fy} r="3.2" fill="#ffcf3f" />
        </g>
      );
    }
    case "crown":
      return (
        <polygon
          points={`${cx - 14},${top + 4} ${cx - 14},${top - 9} ${cx - 7},${top - 2} ${cx},${top - 13} ${cx + 7},${top - 2} ${cx + 14},${top - 9} ${cx + 14},${top + 4}`}
          fill="#ffc93c"
          stroke="#e3a700"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      );
    case "sprout":
      return (
        <g>
          <path d={`M${cx} ${top + 3}V${top - 8}`} stroke="#3c9a4a" strokeWidth="2.6" strokeLinecap="round" />
          <ellipse cx={cx - 6} cy={top - 9} rx="6.5" ry="3.4" transform={`rotate(-25 ${cx - 6} ${top - 9})`} fill="#4cb45c" />
          <ellipse cx={cx + 6} cy={top - 11} rx="6.5" ry="3.4" transform={`rotate(25 ${cx + 6} ${top - 11})`} fill="#5fc56e" />
        </g>
      );
    default:
      return null;
  }
}

export function Mascot({
  look,
  size = 32,
  bob = false,
  status = "idle",
  className = "",
}: {
  look: MascotLook;
  size?: number;
  bob?: boolean;
  /** Drives the rig's action (rigged looks only). */
  status?: AgentStatus;
  /** Kept for callers; the current rig doesn't use it. */
  phase?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  // The rig animates on its own (no CSS bob). Small sizes fall through to the SVG it was drawn from.
  if (look.rig && size >= RIVE_MIN_SIZE) {
    return <RiveMascot rig={look.rig} status={status} size={size} className={className} />;
  }
  const a = ANCHORS[look.shape];
  const fuzzy = look.shape !== "pixel" && size >= 28;
  const light = mix(look.color, "#ffffff", 0.45);
  const dark = mix(look.color, "#0b1530", 0.28);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden
      className={`${bob ? "mascot-bob" : ""} ${className}`}
      style={{ overflow: "visible" }}
    >
      <defs>
        <radialGradient id={`g${id}`} gradientUnits="userSpaceOnUse" cx="38" cy="36" r="66">
          <stop offset="0" stopColor={light} />
          <stop offset="0.45" stopColor={look.color} />
          <stop offset="1" stopColor={dark} />
        </radialGradient>
        {fuzzy && (
          <filter id={`f${id}`} x="-15%" y="-15%" width="130%" height="130%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale={size > 60 ? 5 : 3.5} xChannelSelector="R" yChannelSelector="G" result="d" />
            <feTurbulence type="fractalNoise" baseFrequency="2.4" numOctaves="1" seed="9" result="g" />
            <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.55 0 0 0 -0.18" result="ga" />
            <feComposite in="ga" in2="d" operator="in" result="speck" />
            <feMerge>
              <feMergeNode in="d" />
              <feMergeNode in="speck" />
            </feMerge>
          </filter>
        )}
      </defs>
      {size >= 48 && <ellipse cx="50" cy="97" rx="24" ry="3" fill="#000" opacity="0.07" />}
      <g filter={fuzzy ? `url(#f${id})` : undefined}>
        <Body shape={look.shape} fill={`url(#g${id})`} />
        {look.accessory === "beret" && <Accessory a={a} look={look} />}
      </g>
      <Eyes a={a} look={look} />
      {look.accessory !== "beret" && <Accessory a={a} look={look} />}
    </svg>
  );
}
