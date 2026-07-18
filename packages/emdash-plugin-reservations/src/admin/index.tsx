// Placeholder -- replaced by the real settings/list/detail views in NATIVE_PLAN N3-N6.
// Exists so `adminEntry` (src/index.ts) resolves to a real module during the N1 scaffold
// step; an admin/index.tsx doesn't exist yet without this, so the Vite import would fail.
function ReservationsAdminPage() {
	return <div>Reservations admin is being migrated to native (React) -- see NATIVE_PLAN.md.</div>;
}

export const pages = {
	"/reservations": ReservationsAdminPage,
};
