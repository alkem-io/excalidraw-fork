import React, { useEffect, useState } from "react";

// Lifetime ms for each floating emoji
const LIFETIME = 1800;

export const FloatingEmoji: React.FC<{
  emoji: string;
  x: number;
  y: number;
  onDone: () => void;
}> = ({ emoji, x, y, onDone }) => {
  const [seed] = useState(() => Math.random());
  const rot = (seed * 40 - 20).toFixed(2); // -20..20
  const scale = (1 + seed * 0.4).toFixed(2); // 1..1.4
  const driftX = (seed * 60 - 30).toFixed(2); // -30..30px horizontal
  const driftY = (seed * -80 - 60).toFixed(2); // -60..-140px upward
  const wiggle = (seed * 6 + 4).toFixed(2); // amplitude helper

  useEffect(() => {
    const t = setTimeout(onDone, LIFETIME);
    return () => clearTimeout(t);
  }, [onDone]);

  const uniq = Math.floor(seed * 100000);
  const ascendKey = `emojiAscend_${uniq}`;
  const wiggleKey = `emojiWiggle_${uniq}`;
  const fadeKey = `emojiFade_${uniq}`;

  return (
    <span
      className="floating-emoji"
      style={{
        position: "fixed",
        left: x,
        top: y,
        fontSize: 32,
        pointerEvents: "none",
        zIndex: 1000,
        animation: `${ascendKey} ${LIFETIME}ms ease-out forwards, ${fadeKey} ${LIFETIME}ms linear forwards`,
        willChange: "opacity, transform",
      }}
    >
      <span
        style={{
          display: "inline-block",
          animation: `${wiggleKey} 600ms ease-in-out ${
            seed * 200
          }ms infinite alternate`,
        }}
      >
        {emoji}
      </span>
      <style>
        {`
          @keyframes ${ascendKey} {
            0% { transform: translate(0px,0px) rotate(${rot}deg) scale(${scale}); }
            100% { transform: translate(${driftX}px, ${driftY}px) rotate(${rot}deg) scale(${scale}); }
          }
          @keyframes ${fadeKey} {
            0% { opacity:0; }
            10% { opacity:1; }
            65% { opacity:1; }
            78% { opacity:0.85; }
            86% { opacity:0.65; }
            92% { opacity:0.42; }
            97% { opacity:0.18; }
            100% { opacity:0; }
          }
          @keyframes ${wiggleKey} {
            0% { transform: translate(0px,0px); }
            50% { transform: translate(${Number(wiggle) / 2}px,-4px); }
            100% { transform: translate(${wiggle}px,0px); }
          }
        `}
      </style>
    </span>
  );
};

FloatingEmoji.displayName = "FloatingEmoji";
