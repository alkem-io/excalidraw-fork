import React from "react";

// Confetti feature removed — provide a no-op stub to avoid build errors
export const Confetti: React.FC<{ x?: number; y?: number; onDone?: () => void; intensity?: number }> = () => null;

Confetti.displayName = "Confetti";
