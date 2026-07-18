import { useCallback, useEffect, useState } from "react";
import { Badge, Banner, Button, Input, Select, Switch, Table } from "@cloudflare/kumo";
import { StatCards } from "../components/StatCards";
import { getOverview, listReservations } from "../api";
import type { AdminListFilterDto, AdminOverviewDto, AdminReservationSummaryDto } from "../../shared/dto";

const STATUS_BADGE: Record<AdminReservationSummaryDto["status"], "warning" | "success" | "neutral"> = {
	pending: "warning",
	confirmed: "success",
	cancelled: "neutral",
};

interface Filters {
	status?: "pending" | "confirmed";
	dateFrom?: string;
	dateTo?: string;
	email?: string;
	showCancelled: boolean;
}

const EMPTY_FILTERS: Filters = { showCancelled: false };

interface ListViewProps {
	onSelect: (id: string, fromHistory: boolean) => void;
}

export function ListView({ onSelect }: ListViewProps) {
	const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
	const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
	const [items, setItems] = useState<AdminReservationSummaryDto[]>([]);
	const [cursor, setCursor] = useState<string | undefined>(undefined);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [overview, setOverview] = useState<AdminOverviewDto | null>(null);

	const load = useCallback((filters: Filters, cursorArg?: string) => {
		setLoading(true);
		setError(null);
		const query: AdminListFilterDto = { ...filters, cursor: cursorArg };
		listReservations(query)
			.then((res) => {
				setItems(res.items);
				setCursor(res.cursor);
				setHasMore(res.hasMore);
			})
			.catch((err) => setError(err instanceof Error ? err.message : String(err)))
			.finally(() => setLoading(false));
	}, []);

	// Reset to the first page whenever the applied filter set changes (ADMIN_SPEC §3:
	// storage's cursor pagination is forward-only, no going back to a specific page).
	useEffect(() => {
		load(applied);
	}, [applied, load]);

	useEffect(() => {
		getOverview()
			.then(setOverview)
			.catch(() => {});
	}, []);

	function applyFilters(event: React.FormEvent) {
		event.preventDefault();
		setApplied(draft);
	}

	function resetFilters() {
		setDraft(EMPTY_FILTERS);
		setApplied(EMPTY_FILTERS);
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
			<StatCards overview={overview} />

			<form onSubmit={applyFilters} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
				<Select
					label="Status"
					aria-label="Status"
					value={draft.status ?? ""}
					onValueChange={(value) => setDraft((prev) => ({ ...prev, status: (value as Filters["status"]) || undefined }))}
					items={{ "": "All", pending: "Pending", confirmed: "Confirmed" }}
					disabled={draft.showCancelled}
				/>
				<Input
					label="From"
					type="date"
					value={draft.dateFrom ?? ""}
					onChange={(event) => setDraft((prev) => ({ ...prev, dateFrom: event.target.value || undefined }))}
				/>
				<Input
					label="To"
					type="date"
					value={draft.dateTo ?? ""}
					onChange={(event) => setDraft((prev) => ({ ...prev, dateTo: event.target.value || undefined }))}
				/>
				<Input
					label="Email"
					type="email"
					value={draft.email ?? ""}
					onChange={(event) => setDraft((prev) => ({ ...prev, email: event.target.value || undefined }))}
				/>
				<Switch
					label="Show cancelled"
					checked={draft.showCancelled}
					onCheckedChange={(showCancelled) => setDraft((prev) => ({ ...prev, showCancelled }))}
				/>
				<Button type="submit" variant="primary">
					Apply
				</Button>
				<Button type="button" variant="ghost" onClick={resetFilters}>
					Reset
				</Button>
			</form>

			{error && <Banner variant="error" title="Couldn't load reservations" description={error} />}

			<Table>
				<Table.Header>
					<Table.Row>
						<Table.Head>Date</Table.Head>
						<Table.Head>Time</Table.Head>
						<Table.Head>Name</Table.Head>
						<Table.Head>Email</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Created</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{items.map((item) => (
						<Table.Row
							key={item.id}
							onClick={() => onSelect(item.id, item.fromHistory)}
							style={{ cursor: "pointer" }}
						>
							<Table.Cell>{item.date}</Table.Cell>
							<Table.Cell>{item.startTime}</Table.Cell>
							<Table.Cell>{item.name}</Table.Cell>
							<Table.Cell>{item.email}</Table.Cell>
							<Table.Cell>
								<Badge variant={STATUS_BADGE[item.status]}>{item.status}</Badge>
							</Table.Cell>
							<Table.Cell>{new Date(item.createdAt).toLocaleString()}</Table.Cell>
						</Table.Row>
					))}
					{!loading && items.length === 0 && (
						<Table.Row>
							<Table.Cell colSpan={6} style={{ textAlign: "center", color: "var(--kumo-subtle, #6b7280)" }}>
								No reservations found.
							</Table.Cell>
						</Table.Row>
					)}
				</Table.Body>
			</Table>

			{/* Cursor pagination is forward-only (storage API has no "previous page" -- ADMIN_SPEC
			§3); a plain "Next" button matches that instead of Kumo's page-number Pagination,
			which assumes random access we don't have. */}
			{hasMore && (
				<Button variant="secondary" onClick={() => load(applied, cursor)} loading={loading}>
					Next
				</Button>
			)}
		</div>
	);
}
