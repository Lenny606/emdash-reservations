import { Input } from "@cloudflare/kumo";

interface ColorFieldProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
}

/** Native `<input type="color">` (not Kumo `Input` with `type="color"`) next to a hex text
 * field -- Kumo `Input` adds a Field wrapper (label/error/description) built for text
 * inputs, but the native color swatch is a small square that doesn't need it (NATIVE_SPEC
 * §5.3). Both stay in sync through the same `value`/`onChange`. */
export function ColorField({ label, value, onChange }: ColorFieldProps) {
	return (
		<div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
			<input
				type="color"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				aria-label={`${label} – color picker`}
				style={{ height: 36, width: 48, flexShrink: 0, cursor: "pointer", borderRadius: 8, border: "1px solid var(--kumo-line, #d1d5db)", padding: 2 }}
			/>
			<Input label={label} value={value} onChange={(event) => onChange(event.target.value)} className="flex-1" />
		</div>
	);
}
