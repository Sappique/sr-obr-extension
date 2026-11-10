/**
 * Dice rule: roll the attribute die, plus the skill die, plus the specialisation die.
 * Result = highest value + 1 for every OTHER die that shows its maximum face.
 * Among dice tied for the highest value the base is one NOT on its max face, so a
 * maxed die still counts as +1 (d4=4, d6=4 → 5). The base never adds +1 for itself.
 */
export interface Die {
  size: number;
  value: number;
}

export interface Outcome {
  base: number; // index of the base die
  bonus: number[]; // indices of dice that add +1
  total: number;
}

export function evaluate(dice: Die[]): Outcome {
  if (!dice.length) return { base: -1, bonus: [], total: 0 };
  const high = Math.max(...dice.map((d) => d.value));
  const tied = dice.map((d, i) => ({ d, i })).filter(({ d }) => d.value === high);
  const base = (tied.find(({ d }) => d.value < d.size) ?? tied[0]).i;
  const bonus = dice.map((_, i) => i).filter((i) => i !== base && dice[i].value === dice[i].size);
  return { base, bonus, total: high + bonus.length };
}

/** Uniform 1..size. */
export function rollDie(size: number, random: () => number = Math.random): number {
  return 1 + Math.floor(random() * size);
}

/** A roll as broadcast to every client; all of them animate the same values. */
export interface RollMessage {
  id: string;
  title: string;
  color: string;
  dice: Die[];
  /** Seed for the flicker so the animation looks the same everywhere. */
  seed: number;
}

export function makeRoll(title: string, color: string, sizes: number[], random: () => number = Math.random): RollMessage {
  return {
    id: `${Date.now().toString(36)}-${Math.floor(random() * 1e9).toString(36)}`,
    title,
    color,
    dice: sizes.map((size) => ({ size, value: rollDie(size, random) })),
    seed: Math.floor(random() * 2 ** 31),
  };
}

export function isRollMessage(value: unknown): value is RollMessage {
  const v = value as RollMessage;
  return !!v && typeof v.id === "string" && typeof v.title === "string" && Array.isArray(v.dice) &&
    v.dice.length > 0 && v.dice.length <= 6 && v.dice.every((d) => [4, 6, 8, 10, 12].includes(d.size) && d.value >= 1 && d.value <= d.size);
}
