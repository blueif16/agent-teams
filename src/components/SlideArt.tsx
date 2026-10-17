/*
 * The Aster slide art from the reference: ivory panel, cobalt type,
 * and a phone on a cobalt backdrop. Sized in em so one font-size scales it.
 */

export function PhoneArt({ score = 82, emphasis = false }: { score?: number; emphasis?: boolean }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#2c45b8]" style={{ containerType: "size" }}>
      <div className="absolute left-[-30%] top-[8%] aspect-square w-[95%] rounded-full bg-[#2139a6]" />
      <div className="absolute bottom-[-6%] left-[-8%] h-[26%] w-[80%] rounded-[50%] bg-[#e8dcc7]" />
      <svg viewBox="0 0 60 100" className="absolute right-[-6%] top-[-4%] h-[88%]" aria-hidden>
        <path d="M50 100C44 70 40 40 30 4" stroke="#6b7a3a" strokeWidth="1.2" fill="none" />
        {[12, 24, 36, 48, 60, 72].map((y, i) => (
          <ellipse
            key={y}
            cx={i % 2 ? 40 : 28}
            cy={y}
            rx="9"
            ry="3.2"
            transform={`rotate(${i % 2 ? 35 : -35} ${i % 2 ? 40 : 28} ${y})`}
            fill={i % 2 ? "#8e9a55" : "#a8b26a"}
          />
        ))}
      </svg>
      <div
        className="absolute left-1/2 top-[9%] flex h-[88%] -translate-x-[58%] flex-col rounded-[1.4em] border-[0.28em] border-[#151515] bg-white px-[0.7em] pt-[1.1em] text-[#151515] shadow-[0_0.6em_1.4em_rgba(0,0,0,0.25)]"
        style={{ aspectRatio: "9 / 17.5", fontSize: "6.2cqh" }}
      >
        <div className="absolute left-1/2 top-[0.35em] h-[0.55em] w-[2.2em] -translate-x-1/2 rounded-full bg-[#151515]" />
        <div className="font-serif text-[0.95em] leading-none">Aster</div>
        <div className="mt-[0.5em] font-serif text-[1.05em] leading-none">Today</div>
        <div className="mt-[0.2em] text-[0.32em] text-[#8a8a8a]">Monday, October 20</div>
        <div className="mt-[0.7em] flex flex-1 flex-col items-center rounded-[0.5em] bg-[#f4e7da] pt-[0.5em]">
          <div className="text-[0.3em] uppercase tracking-wide text-[#8a7a6a]">Daily score</div>
          <div
            className={`mt-[0.35em] grid aspect-square place-items-center rounded-full border-[#2c45b8] bg-white ${emphasis ? "w-[3.4em] border-[0.32em]" : "w-[2.6em] border-[0.24em]"}`}
          >
            <span className={emphasis ? "text-[1.1em]" : "text-[0.85em]"}>{score}</span>
          </div>
          {!emphasis && (
            <div className="mt-[0.5em] w-[80%] space-y-[0.25em]">
              <div className="h-[0.22em] rounded bg-[#e2d2c2]" />
              <div className="h-[0.22em] w-2/3 rounded bg-[#e2d2c2]" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SlideVariant({
  label,
  title,
  body,
  cta,
  emphasis,
}: {
  label: string;
  title: string;
  body: string;
  cta: string;
  emphasis?: boolean;
}) {
  return (
    <div className="grid h-full grid-cols-[1fr_1.05fr] gap-[0.8em]">
      <div className="flex flex-col pt-[0.4em]">
        <div className="text-[0.55em] font-semibold uppercase tracking-[0.06em] text-cobalt">{label}</div>
        <div className="mt-[0.6em] text-[1.25em] leading-[1.15] text-[#151515]">{title}</div>
        <div className="mt-[1.6em] text-[0.6em] leading-[1.45] text-[#333]">{body}</div>
        <div className="flex-1" />
        <div className="mb-[0.4em] w-fit rounded-[0.25em] bg-[#2c45b8] px-[1.1em] py-[0.55em] text-[0.5em] font-medium text-white">
          {cta}
        </div>
      </div>
      <div className="overflow-hidden">
        <PhoneArt emphasis={emphasis} />
      </div>
    </div>
  );
}

/** The chat attachment card: section label, big headline, phone on the right. */
export function SlideCard({ section, title }: { section: string; title: string }) {
  return (
    <div className="grid h-full grid-cols-[1.3fr_1fr] bg-paper">
      <div className="px-4 pt-3.5">
        <div className="text-[15px] text-cobalt sm:text-[16px]">{section}</div>
        <div className="mt-4 text-[19px] leading-[1.2] text-[#151515] sm:mt-5 sm:text-[25px]">{title}</div>
      </div>
      <PhoneArt />
    </div>
  );
}
