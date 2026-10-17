import { AnimatePresence, motion } from "motion/react";
import { Clock, House, LayoutGrid, PanelLeft, Puzzle } from "lucide-react";
import { ChiefButton } from "./Chief";
import { IconButton, POP, SPRING } from "./ui";

export type SideMode = "home" | "activity" | "agents";

const ITEMS: { mode: SideMode; label: string; Icon: typeof House }[] = [
  { mode: "home", label: "Teams", Icon: House },
  { mode: "activity", label: "Activity", Icon: Clock },
];

export function Rail({
  mode,
  onMode,
  sidebarOpen,
  onToggleSidebar,
  needsYou,
  skills,
  chief,
}: {
  mode: SideMode;
  onMode: (m: SideMode) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  needsYou: number;
  /** The skill library, opened as a workspace tab rather than a sidebar mode. */
  skills: { active: boolean; onClick: () => void };
  /** The CEO agent at the bottom of the rail, with her shortcuts menu. */
  chief: { open: boolean; unread: boolean; onClick: () => void };
}) {
  const item = (m: SideMode, label: string, Icon: typeof House, badge?: number) => {
    const active = sidebarOpen && mode === m;
    return (
      <button
        key={m}
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={active}
        onClick={() => onMode(m)}
        className={`tap relative grid size-10 place-items-center rounded-[11px] ${
          active ? "text-ink" : "text-[#767676] hover:bg-black/[0.05] hover:text-ink"
        }`}
      >
        {active && (
          <motion.span layoutId="rail-active" transition={SPRING} className="absolute inset-0 rounded-[11px] bg-[#d6d6d6]" />
        )}
        <Icon
          className="relative size-[21px]"
          strokeWidth={active ? 2.1 : 1.7}
          fill={active && m === "home" ? "currentColor" : "none"}
        />
        <AnimatePresence>
          {badge ? (
            <motion.span
              key={badge}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={POP}
              className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber px-1 text-[10px] font-semibold text-white ring-2 ring-frame"
            >
              {badge}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </button>
    );
  };

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center" aria-label="Main">
      <div className="flex h-11 items-center">
        <IconButton label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} onClick={onToggleSidebar}>
          <PanelLeft className="size-[18px]" strokeWidth={1.7} />
        </IconButton>
      </div>
      <div className="flex flex-col items-center gap-2 pt-1.5">
        {ITEMS.map(({ mode: m, label, Icon }) => item(m, label, Icon, m === "activity" ? needsYou : undefined))}
        <div className="my-1 h-px w-6 bg-black/10" />
        {item("agents", "All agents", LayoutGrid)}
        <button
          type="button"
          aria-label="Skills"
          title="Skills"
          aria-pressed={skills.active}
          onClick={skills.onClick}
          className={`tap relative grid size-10 place-items-center rounded-[11px] ${
            skills.active ? "text-ink" : "text-[#767676] hover:bg-black/[0.05] hover:text-ink"
          }`}
        >
          {skills.active && (
            <motion.span layoutId="rail-skills" transition={SPRING} className="absolute inset-0 rounded-[11px] bg-[#d6d6d6]" />
          )}
          <Puzzle className="relative size-[21px]" strokeWidth={skills.active ? 2.1 : 1.7} />
        </button>
      </div>
      <div className="flex-1" />
      <ChiefButton {...chief} />
    </nav>
  );
}
