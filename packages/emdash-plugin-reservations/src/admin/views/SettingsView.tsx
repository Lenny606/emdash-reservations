import { useEffect, useState } from "react";
import { Banner, Button, Checkbox, Input, Switch } from "@cloudflare/kumo";
import { ColorField } from "../components/ColorField";
import { getSettings, saveSettings } from "../api";
import type { ReservationSettings } from "../../server/model";

const DAY_LABELS: Array<{ value: number; label: string }> = [
	{ value: 1, label: "Mon" },
	{ value: 2, label: "Tue" },
	{ value: 3, label: "Wed" },
	{ value: 4, label: "Thu" },
	{ value: 5, label: "Fri" },
	{ value: 6, label: "Sat" },
	{ value: 7, label: "Sun" },
];

export function SettingsView() {
	const [settings, setSettings] = useState<ReservationSettings | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [banner, setBanner] = useState<{ variant: "default" | "error"; text: string } | null>(null);

	useEffect(() => {
		let cancelled = false;
		getSettings()
			.then((data) => {
				if (!cancelled) setSettings(data);
			})
			.catch((error) => {
				if (!cancelled) setBanner({ variant: "error", text: String(error) });
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	function patch(partial: Partial<ReservationSettings>) {
		setSettings((prev) => (prev ? { ...prev, ...partial } : prev));
	}

	function toggleDay(day: number) {
		if (!settings) return;
		const activeDays = settings.activeDays.includes(day)
			? settings.activeDays.filter((d) => d !== day)
			: [...settings.activeDays, day].sort((a, b) => a - b);
		patch({ activeDays });
	}

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		if (!settings) return;
		setSaving(true);
		setBanner(null);
		try {
			const updated = await saveSettings(settings);
			setSettings(updated);
			setBanner({ variant: "default", text: "Settings saved." });
		} catch (error) {
			setBanner({ variant: "error", text: String(error instanceof Error ? error.message : error) });
		} finally {
			setSaving(false);
		}
	}

	if (loading) return <div>Loading settings…</div>;
	if (!settings) return <Banner variant="error" title="Couldn't load settings" description={banner?.text} />;

	return (
		<form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 480 }}>
			{banner && (
				<Banner
					variant={banner.variant === "error" ? "error" : "default"}
					title={banner.variant === "error" ? "Save failed" : "Saved"}
					description={banner.text}
				/>
			)}

			<Switch label="Reservations enabled" checked={settings.enabled} onCheckedChange={(enabled) => patch({ enabled })} />

			<div style={{ display: "flex", gap: 12 }}>
				<Input
					label="Opening time"
					type="time"
					step={1800}
					value={settings.openingTime}
					onChange={(event) => patch({ openingTime: event.target.value })}
					className="flex-1"
				/>
				<Input
					label="Closing time"
					type="time"
					step={1800}
					value={settings.closingTime}
					onChange={(event) => patch({ closingTime: event.target.value })}
					className="flex-1"
				/>
			</div>

			<div>
				<div style={{ marginBottom: 6, fontWeight: 500 }}>Active days</div>
				<div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
					{DAY_LABELS.map((day) => (
						<Checkbox
							key={day.value}
							label={day.label}
							checked={settings.activeDays.includes(day.value)}
							onCheckedChange={() => toggleDay(day.value)}
						/>
					))}
				</div>
			</div>

			<Input
				label="Max days ahead"
				type="number"
				min={1}
				max={365}
				value={settings.maxDaysAhead}
				onChange={(event) => patch({ maxDaysAhead: Number(event.target.value) })}
			/>

			<Switch
				label="Auto-confirm new reservations"
				checked={settings.autoConfirm}
				onCheckedChange={(autoConfirm) => patch({ autoConfirm })}
			/>

			<div>
				<div style={{ marginBottom: 6, fontWeight: 500 }}>Calendar colors</div>
				<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
					<ColorField label="Free" value={settings.colorFree} onChange={(colorFree) => patch({ colorFree })} />
					<ColorField label="Reserved" value={settings.colorReserved} onChange={(colorReserved) => patch({ colorReserved })} />
					<ColorField label="Pending" value={settings.colorPending} onChange={(colorPending) => patch({ colorPending })} />
					<ColorField label="Closed" value={settings.colorClosed} onChange={(colorClosed) => patch({ colorClosed })} />
				</div>
			</div>

			<Input
				label="Captcha plugin ID"
				description="Leave empty to disable captcha"
				value={settings.captchaPluginId}
				onChange={(event) => patch({ captchaPluginId: event.target.value })}
			/>

			<Switch
				label="Email notifications"
				checked={settings.notifyEnabled}
				onCheckedChange={(notifyEnabled) => patch({ notifyEnabled })}
			/>
			<Input
				label="Notification email"
				type="email"
				value={settings.notifyEmail}
				onChange={(event) => patch({ notifyEmail: event.target.value })}
			/>

			<Button type="submit" variant="primary" loading={saving}>
				Save settings
			</Button>
		</form>
	);
}
