import type { AdminOverviewDto } from "../../shared/dto";

const CARDS: Array<{ key: keyof AdminOverviewDto; label: string }> = [
	{ key: "thisWeek", label: "This week" },
	{ key: "pending", label: "Pending" },
	{ key: "confirmed", label: "Confirmed" },
	{ key: "cancelled", label: "Cancelled" },
];

export function StatCards({ overview }: { overview: AdminOverviewDto | null }) {
	return (
		<div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
			{CARDS.map((card) => (
				<div
					key={card.key}
					style={{
						flex: "1 1 120px",
						border: "1px solid var(--kumo-line, #e5e7eb)",
						borderRadius: 8,
						padding: "12px 16px",
					}}
				>
					<div style={{ fontSize: 13, color: "var(--kumo-subtle, #6b7280)" }}>{card.label}</div>
					<div style={{ fontSize: 24, fontWeight: 600 }}>{overview ? overview[card.key] : "–"}</div>
				</div>
			))}
		</div>
	);
}
