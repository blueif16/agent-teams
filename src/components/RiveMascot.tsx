"use client";

import { useEffect } from "react";
import { Alignment, Fit, Layout, useRive, useViewModel, useViewModelInstance, useViewModelInstanceEnum } from "@rive-app/react-canvas";
import { RuntimeLoader } from "@rive-app/canvas";
import type { AgentStatus, MascotRig } from "@/lib/types";

/*
 * Rive mascots, built in /home/ran/rive/felipe-rig (rive/cast.py): one character per agent type, each a
 * placeholder shape animated. Plush texture from the same SVG filter, no hands at rest; working brings out a
 * keyboard and two mittens; needs-you and done have their own actions. The view model's `action` enum uses the app's status names, so a status
 * goes straight in. The wasm is served from public/rive, not the CDN.
 */

RuntimeLoader.setWasmUrl("/rive/rive.wasm");

const RIG_SRC = (rig: MascotRig) => `/rive/${rig}.riv`;

/**
 * Below this size motion can't be seen, and a list of messages would mean dozens of live instances:
 * the look's SVG is drawn instead (the rig is drawn from it, so it is the same character). Headers,
 * the profile and the team panel are live.
 */
export const RIVE_MIN_SIZE = 48;

const LAYOUT = new Layout({ fit: Fit.Contain, alignment: Alignment.Center });

export function RiveMascot({
  rig,
  status,
  size,
  className = "",
}: {
  rig: MascotRig;
  status: AgentStatus;
  size: number;
  className?: string;
}) {
  const { rive, RiveComponent } = useRive({
    src: RIG_SRC(rig),
    stateMachine: "Agent",
    autoplay: true,
    layout: LAYOUT,
  });
  const vm = useViewModel(rive, { name: "Agent" });
  // A new instance per mascot, so each one keeps its own action.
  const vmi = useViewModelInstance(vm, { useNew: true, rive });
  const { setValue: setAction } = useViewModelInstanceEnum("action", vmi);

  useEffect(() => {
    if (vmi) setAction(status);
  }, [vmi, status, setAction]);

  return (
    <span
      aria-hidden
      className={`relative inline-block ${className}`}
      style={{ width: size, height: size, opacity: vmi ? 1 : 0, transition: "opacity 120ms" }}
    >
      <RiveComponent style={{ width: size, height: size }} />
    </span>
  );
}
