// Risk-only colour mapping shared by report and comparison cards.
import { Badge } from "@/components/ui/badge";
import type { RiskLevel } from "@shared/schemas";
const colours = { red: "bg-red-100 text-red-900", amber: "bg-amber-100 text-amber-900", green: "bg-green-100 text-green-900" };
export function RiskBadge({ risk }: { risk: RiskLevel }) { return <Badge className={colours[risk]}>{risk} · {risk === "red" ? "review closely" : risk === "amber" ? "worth asking about" : "lower concern"}</Badge>; }
