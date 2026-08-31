// One item, rendered and answered.
//
// Drives the item, measures latency, and reports the result on completion.

import { useCallback, useEffect, useRef } from "react";

import { useT } from "../../lib/i18n";
import RENDERERS from "./renderers";

export const LIGHT_COOL_BGS = [
  "bg-[#eef6ff]", // cool sky blue
  "bg-[#e6f7f5]", // calm ice teal
  "bg-[#f0f3ff]", // soft indigo
  "bg-[#eaf8fc]", // soothing light cyan
  "bg-[#eaf7f2]", // soft cool mint
  "bg-[#f3f0ff]", // light lavender
  "bg-[#edf2f7]", // cool slate tint
  "bg-[#eafaf7]", // light cool aqua
];

export function getLightCoolBgForItem(itemId) {
  let hash = 0;
  const str = String(itemId || "");
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % LIGHT_COOL_BGS.length;
  return LIGHT_COOL_BGS[index];
}

export default function ItemStage({ item, onDone }) {
  const t = useT();
  const startedRef = useRef(0);
  const doneRef = useRef(false);

  useEffect(() => {
    startedRef.current = Date.now();
    doneRef.current = false;
  }, [item]);

  const answer = useCallback(
    (wasCorrect) => {
      if (doneRef.current) return;
      doneRef.current = true;

      onDone({
        item,
        correct: wasCorrect,
        attempted: true,
        latencyMs: Date.now() - startedRef.current,
        status: "completed",
      });
    },
    [item, onDone]
  );

  const Renderer = RENDERERS[item.template];
  if (!Renderer) return null;

  return (
    <div className="w-full flex flex-col items-center justify-center">
      <Renderer item={item} t={t} correcting={false} onAnswer={answer} />
    </div>
  );
}
