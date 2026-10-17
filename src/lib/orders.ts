/*
 * Reactions are quick orders, not decoration. Each emoji maps to one
 * instruction the agent acts on. Keep this list short and conventional:
 * these are meanings teams already give these emoji in Slack.
 */

export type OrderKey = "go" | "dig" | "redo" | "hold" | "pin";

export interface Order {
  key: OrderKey;
  emoji: string;
  label: string;
  /** What the human means, shown on hover. */
  meaning: string;
  /** What the agent receives. */
  instruction: string;
  /** The agent's "now" line after this order; none when the order doesn't change what it's doing. */
  doing?: string;
}

export const ORDERS: Order[] = [
  { key: "go", emoji: "👍", label: "Go ahead", meaning: "Proceed with what you proposed", instruction: "Go ahead with this", doing: "Going ahead with" },
  { key: "dig", emoji: "👀", label: "Dig in", meaning: "Look deeper and report back", instruction: "Dig deeper on this and report back", doing: "Digging into" },
  { key: "redo", emoji: "🔁", label: "Redo", meaning: "Take another pass at it", instruction: "Take another pass at this", doing: "Redoing" },
  { key: "hold", emoji: "✋", label: "Hold", meaning: "Pause this until I say go", instruction: "Hold this until I say go", doing: "On hold:" },
  { key: "pin", emoji: "📌", label: "Remember", meaning: "Keep this as a standing instruction", instruction: "Remember this as a standing instruction" },
];

export const ORDERS_BY_KEY = Object.fromEntries(ORDERS.map((o) => [o.key, o])) as Record<OrderKey, Order>;

export function excerpt(text: string, max = 140): string {
  const plain = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/** The message an agent receives when you react to one of its messages. */
export function orderText(order: Order, quoted: string): string {
  return `${order.emoji} ${order.instruction}: “${excerpt(quoted)}”`;
}
