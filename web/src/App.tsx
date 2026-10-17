import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { authApi, AuthApiError } from "./lib/auth-api";
import type { AuthUser } from "./lib/auth-api";
import { propertyApi } from "./lib/property-api";
import type { Bed, Property, Room } from "./lib/property-api";
import { bookingApi } from "./lib/booking-api";
import type { Booking, BookingStatus } from "./lib/booking-api";
import { tenancyApi } from "./lib/tenancy-api";
import type { Tenancy } from "./lib/tenancy-api";
import { billingApi } from "./lib/billing-api";
import type { PaymentMethod, RentInvoice } from "./lib/billing-api";
import { OwnerMaintenancePage, TenantComplaintsPage } from "./complaints-pages";

const field = "mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100";
const button = "inline-flex items-center justify-center rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-wait disabled:opacity-60";
const secondary = "inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50";
const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
const utcDate = (offset = 0) => { const value = new Date(); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    let live = true;
    authApi.currentUser().then((value) => { if (live) setUser(value); }).catch((error: unknown) => {
      if (live && !(error instanceof AuthApiError && error.status === 401)) setSessionError(errorMessage(error));
    }).finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, []);
  async function logout() {
    setLogoutBusy(true); setSessionError(null);
    try { await authApi.logout(); setUser(null); navigate("/"); }
    catch (error) { setSessionError(errorMessage(error)); }
    finally { setLogoutBusy(false); }
  }
  if (checking) return <main className="grid min-h-screen place-items-center text-slate-600">Loading Staywise…</main>;
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link className="text-xl font-bold tracking-tight text-teal-950" to="/">Staywise</Link>
        <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
          <Link className="font-medium text-slate-600 hover:text-teal-800" to="/">Find a stay</Link>
          {user && (user.role === "OWNER" || user.role === "ADMIN") && <Link className="font-medium text-slate-600 hover:text-teal-800" to="/manage">Owner dashboard</Link>}
          {user?.role === "TENANT" && <Link className="font-medium text-slate-600 hover:text-teal-800" to="/bookings">My bookings</Link>}
          {user?.role === "TENANT" && <Link className="font-medium text-slate-600 hover:text-teal-800" to="/tenancies">My tenancy</Link>}
          {user?.role === "TENANT" && <Link className="font-medium text-slate-600 hover:text-teal-800" to="/billing">Billing</Link>}
          {user?.role === "TENANT" && <Link className="font-medium text-slate-600 hover:text-teal-800" to="/complaints">Maintenance</Link>}
          {user && (user.role === "OWNER" || user.role === "ADMIN") && <><Link className="font-medium text-slate-600 hover:text-teal-800" to="/manage/bookings">Booking requests</Link><Link className="font-medium text-slate-600 hover:text-teal-800" to="/manage/tenancies">Tenancies</Link><Link className="font-medium text-slate-600 hover:text-teal-800" to="/manage/rent">Rent</Link><Link className="font-medium text-slate-600 hover:text-teal-800" to="/manage/maintenance">Maintenance</Link></>}
          {user ? <><span className="hidden text-slate-500 sm:inline">{user.fullName}</span><button className={secondary} onClick={logout} disabled={logoutBusy}>{logoutBusy ? "Signing out…" : "Sign out"}</button></> : <Link className={button} to="/login">Sign in</Link>}
        </div>
      </nav>
    </header>
    {sessionError && <p className="mx-auto mt-4 max-w-7xl px-5 text-sm text-red-700" role="alert">{sessionError}</p>}
    <Routes>
      <Route path="/" element={<BrowsePage />} />
      <Route path="/properties/:propertyId" element={<PublicDetailPage user={user} />} />
      <Route path="/bookings" element={<TenantBookings user={user} />} />
      <Route path="/tenancies" element={<TenantTenancies user={user} />} />
      <Route path="/billing" element={<TenantBilling user={user} />} />
      <Route path="/complaints" element={<TenantComplaintsPage user={user} />} />
      <Route path="/login" element={<AuthPage onAuthenticated={setUser} />} />
      <Route path="/manage" element={<OwnerDashboard user={user} />} />
      <Route path="/manage/bookings" element={<OwnerBookings user={user} />} />
      <Route path="/manage/tenancies" element={<OwnerTenancies user={user} />} />
      <Route path="/manage/rent" element={<OwnerRentManagement user={user} />} />
      <Route path="/manage/maintenance" element={<OwnerMaintenancePage user={user} />} />
      <Route path="/manage/properties/:propertyId" element={<ManageProperty user={user} />} />
      <Route path="*" element={<main className="mx-auto max-w-5xl p-10"><h1 className="text-2xl font-semibold">Page not found</h1><Link to="/" className="mt-4 inline-block text-teal-800">Browse stays</Link></main>} />
    </Routes>
  </div>;
}

function AuthPage({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = mode === "register"
        ? await authApi.register({ fullName: String(form.get("fullName") ?? ""), email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") })
        : await authApi.login({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
      onAuthenticated(result); navigate(result.role === "OWNER" || result.role === "ADMIN" ? "/manage" : "/");
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 lg:grid-cols-2 lg:py-20">
    <section className="self-center"><p className="text-sm font-semibold uppercase tracking-[.2em] text-teal-800">Staywise</p><h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">A calmer way to find and manage a stay.</h1><p className="mt-5 max-w-lg leading-7 text-slate-600">Browse available rooms, or sign in to manage your account. New registrations start with tenant access.</p><Link className="mt-7 inline-block text-sm font-semibold text-teal-800" to="/">Explore available properties →</Link></section>
    <section className={`${card} mx-auto w-full max-w-md p-7 sm:p-9`}>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"><button className={`rounded-lg py-2 text-sm font-semibold ${mode === "login" ? "bg-white shadow-sm" : "text-slate-500"}`} onClick={() => { setMode("login"); setError(null); }}>Sign in</button><button className={`rounded-lg py-2 text-sm font-semibold ${mode === "register" ? "bg-white shadow-sm" : "text-slate-500"}`} onClick={() => { setMode("register"); setError(null); }}>Create account</button></div>
      <h2 className="mt-7 text-2xl font-bold">{mode === "login" ? "Welcome back" : "Create your account"}</h2>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        {mode === "register" && <label className="block text-sm font-medium">Full name<input name="fullName" className={field} required maxLength={160} autoComplete="name" /></label>}
        <label className="block text-sm font-medium">Email address<input name="email" type="email" className={field} required maxLength={320} autoComplete="email" /></label>
        <label className="block text-sm font-medium">Password<input name="password" type="password" className={field} required minLength={mode === "register" ? 12 : 1} maxLength={128} autoComplete={mode === "register" ? "new-password" : "current-password"} />{mode === "register" && <span className="mt-1 block text-xs font-normal text-slate-500">Use at least 12 characters.</span>}</label>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <button className={`${button} w-full`} type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
      </form>
      <p className="mt-5 text-xs leading-5 text-slate-500">Your session uses a secure HttpOnly cookie. Owner and admin accounts are provisioned separately.</p>
    </section>
  </main>;
}

function BrowsePage() {
  const [items, setItems] = useState<Property[]>([]); const [search, setSearch] = useState(""); const [input, setInput] = useState(""); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [page, setPage] = useState(1); const [totalPages, setTotalPages] = useState(1);
  const load = useCallback(() => { setLoading(true); setError(null); propertyApi.browse({ page, pageSize: 12, search: search || undefined }).then((result) => { setItems(result.items); setTotalPages(result.totalPages); }).catch((reason) => setError(errorMessage(reason))).finally(() => setLoading(false)); }, [page, search]);
  useEffect(() => { load(); }, [load]);
  return <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
    <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between"><div><p className="text-sm font-semibold text-teal-800">Find your next stay</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Places that feel like home.</h1><p className="mt-3 text-slate-600">Browse published properties and check bed availability.</p></div><form className="flex w-full max-w-lg gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(input.trim()); }}><input className={field} aria-label="Search properties" placeholder="Search by property or city" value={input} onChange={(e) => setInput(e.target.value)} /><button className={button}>Search</button></form></div>
    {loading ? <Loading /> : error ? <ErrorPanel message={error} retry={load} /> : items.length === 0 ? <Empty title="No published properties yet" body="Try another search, or check back as new places are added." /> : <><div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{items.map((p) => <PropertyCard key={p.id} property={p} />)}</div><div className="mt-8 flex items-center justify-between"><button className={secondary} disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Previous</button><span className="text-sm text-slate-500">Page {page} of {totalPages}</span><button className={secondary} disabled={page >= totalPages} onClick={() => setPage((n) => n + 1)}>Next</button></div></>}
  </main>;
}

function PropertyCard({ property }: { property: Property }) {
  const beds = property.rooms?.flatMap((r) => r.beds ?? []) ?? [];
  return <article className={`${card} flex flex-col`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-teal-800">{property.city}, {property.region}</p><h2 className="mt-2 text-xl font-bold">{property.name}</h2></div><span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-900">{beds.filter((b) => b.isAvailable).length} beds available</span></div><p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{property.description || "A welcoming place to stay."}</p><p className="mt-4 text-sm text-slate-500">{property.addressLine1}</p><div className="mt-auto pt-5"><Link className={secondary} to={`/properties/${property.id}`}>View property</Link></div></article>;
}

function PublicDetailPage({ user }: { user: AuthUser | null }) {
  const { propertyId = "" } = useParams();
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(utcDate());
  const [endDate, setEndDate] = useState(utcDate(1));
  const [pendingBed, setPendingBed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoading(true); setError(null);
    propertyApi.detail(propertyId, { startDate, endDate }).then(({ property: value }) => setProperty(value))
      .catch((reason) => setError(errorMessage(reason))).finally(() => setLoading(false));
  }, [propertyId, startDate, endDate]);
  useEffect(() => { load(); }, [load]);
  async function requestBed(bedId: string) {
    setPendingBed(bedId); setError(null); setNotice(null);
    try {
      const result = await bookingApi.request({ bedId, startDate, endDate });
      setNotice(`Request sent. It is pending owner approval; the bed is not reserved until it is confirmed (request ${result.booking.id.slice(0, 8)}).`);
      load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setPendingBed(null); }
  }
  if (loading) return <Loading />;
  if (error && !property) return <ErrorPanel message={error} retry={load} />;
  if (!property) return <Empty title="Property unavailable" body="This property is not published or could not be found." />;
  const beds = property.rooms?.flatMap((room) => room.beds ?? []) ?? [];
  const canBook = user?.role === "TENANT";
  return <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
    <Link className="text-sm font-semibold text-teal-800" to="/">← All properties</Link>
    <div className="mt-5 rounded-3xl bg-teal-950 p-7 text-white sm:p-10"><p className="text-sm font-semibold text-teal-200">{property.city}, {property.region}</p><h1 className="mt-2 text-3xl font-bold sm:text-4xl">{property.name}</h1><p className="mt-4 max-w-2xl leading-7 text-teal-50">{property.description || "A welcoming place to stay."}</p><p className="mt-5 text-sm text-teal-100">{property.addressLine1}{property.addressLine2 ? `, ${property.addressLine2}` : ""} · {property.postalCode}</p></div>
    <div className="mt-8 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-2xl font-bold">Rooms and bed availability</h2><p className="mt-1 text-sm text-slate-500">Availability for your selected dates is checked again when you request.</p></div><span className="rounded-full bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-900">{beds.filter((bed) => bed.isAvailable).length} available</span></div>
    <div className={`${card} mt-4 grid gap-3 sm:grid-cols-2`}><label className="text-sm font-medium">Start date<input className={field} type="date" min={utcDate()} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label className="text-sm font-medium">End date (exclusive)<input className={field} type="date" min={startDate || utcDate()} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
    {error && <ErrorPanel message={error} retry={load} />}{notice && <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900" role="status">{notice} <Link className="font-semibold underline" to="/bookings">View my bookings</Link></p>}
    {!property.rooms?.length ? <Empty title="No rooms listed" body="Room details will appear here when available." /> : <div className="mt-4 grid gap-4 sm:grid-cols-2">{property.rooms.map((room) => <PublicRoomCard key={room.id} room={room} canBook={canBook} pendingBed={pendingBed} onRequest={requestBed} />)}</div>}
    {user && !canBook && <p className="mt-5 text-sm text-slate-500">Only tenant accounts can request a booking.</p>}
    {!user && <p className="mt-5 text-sm text-slate-600"><Link className="font-semibold text-teal-800 underline" to="/login">Sign in or create a tenant account</Link> to request a bed.</p>}
  </main>;
}

function PublicRoomCard({ room, canBook, pendingBed, onRequest }: { room: Room; canBook: boolean; pendingBed: string | null; onRequest: (bedId: string) => void }) {
  return <article className={card}><div className="flex items-center justify-between"><h3 className="font-bold">Room {room.roomNumber}</h3><span className="text-xs text-slate-500">Floor {room.floor ?? "—"}</span></div><div className="mt-3 space-y-2">{room.beds?.map((bed) => <div key={bed.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"><span className={`text-sm font-semibold ${bed.isAvailable ? "text-emerald-800" : "text-slate-500"}`}>Bed {bed.label} · {bed.isAvailable ? "Available" : "Unavailable"}</span>{canBook && bed.isAvailable && <button className={button} disabled={pendingBed !== null} onClick={() => onRequest(bed.id)}>{pendingBed === bed.id ? "Sending…" : "Request booking"}</button>}</div>)}{!room.beds?.length && <p className="text-sm text-slate-500">No beds available for these dates.</p>}</div></article>;
}

function OwnerDashboard({ user }: { user: AuthUser | null }) {
  const [properties, setProperties] = useState<Property[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => { if (!user || (user.role !== "OWNER" && user.role !== "ADMIN")) return; setLoading(true); setError(null); propertyApi.managed().then((result) => setProperties(result.properties)).catch((reason) => setError(errorMessage(reason))).finally(() => setLoading(false)); }, [user]);
  useEffect(() => { load(); }, [load]);
  async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(null); const form = new FormData(event.currentTarget); const values = Object.fromEntries(form.entries()); try { await propertyApi.createProperty(values as never); event.currentTarget.reset(); load(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } }
  if (!user) return <AccessMessage title="Sign in to manage properties" />;
  if (user.role !== "OWNER" && user.role !== "ADMIN") return <AccessMessage title="Owner access required" />;
  return <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8"><div><p className="text-sm font-semibold text-teal-800">{user.role === "ADMIN" ? "Administration" : "Owner workspace"}</p><h1 className="mt-2 text-3xl font-bold">Property dashboard</h1><p className="mt-2 text-slate-600">Manage your property details, rooms and beds.</p><Link className="mt-3 inline-block text-sm font-semibold text-teal-800 underline" to="/manage/tenancies">Review tenancies and occupancy →</Link></div>{error && <ErrorPanel message={error} retry={load} />}<div className="mt-8 grid items-start gap-6 lg:grid-cols-[1.3fr_.7fr]"><section><h2 className="mb-4 text-xl font-bold">Your properties</h2>{loading ? <Loading /> : properties.length === 0 ? <Empty title="No properties yet" body="Add a property to start organizing its rooms and beds." /> : <div className="grid gap-4">{properties.map((property) => <article key={property.id} className={`${card} flex flex-col justify-between gap-4 sm:flex-row sm:items-center`}><div><h3 className="text-lg font-bold">{property.name}</h3><p className="mt-1 text-sm text-slate-600">{property.city}, {property.region}</p><span className="mt-2 inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">{property.status}</span></div><Link className={secondary} to={`/manage/properties/${property.id}`}>Manage property</Link></article>)}</div>}</section>{user.role === "OWNER" && <form onSubmit={create} className={`${card} space-y-3`}><h2 className="text-xl font-bold">Add a property</h2><p className="text-sm text-slate-500">New properties are private drafts until you publish them.</p><TextField label="Property name" name="name" required maxLength={160} /><TextField label="Address" name="addressLine1" required maxLength={200} /><TextField label="Address line 2" name="addressLine2" maxLength={200} /><div className="grid grid-cols-2 gap-3"><TextField label="City" name="city" required maxLength={120} /><TextField label="Region" name="region" required maxLength={120} /><TextField label="Postal code" name="postalCode" required maxLength={24} /><TextField label="Country code" name="countryCode" required maxLength={2} placeholder="IN" /></div><label className="block text-sm font-medium">Description<textarea className={field} rows={3} name="description" maxLength={5000} /></label><button className={button} disabled={busy}>{busy ? "Creating…" : "Create property"}</button></form>}</div></main>;
}

function TenantBookings({ user }: { user: AuthUser | null }) {
  const [bookings, setBookings] = useState<Booking[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { setLoading(true); setError(null); bookingApi.tenantList().then(({ bookings: rows }) => setBookings(rows)).catch((reason) => setError(errorMessage(reason))).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (user?.role === "TENANT") load(); else setLoading(false); }, [user, load]);
  async function cancel(id: string) { setBusy(id); setError(null); try { await bookingApi.cancelTenant(id); await load(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(null); } }
  if (!user) return <AccessMessage title="Sign in to see your booking requests" />;
  if (user.role !== "TENANT") return <AccessMessage title="Tenant access required" />;
  return <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8"><p className="text-sm font-semibold text-teal-800">Tenant account</p><h1 className="mt-2 text-3xl font-bold">My booking requests</h1><p className="mt-2 text-slate-600">A pending request does not reserve the bed. It becomes reserved after the owner confirms it.</p>{error && <ErrorPanel message={error} retry={load} />}{loading ? <Loading /> : bookings.length === 0 ? <Empty title="No booking requests yet" body="Browse properties and request a bed for your dates." /> : <div className="mt-6 grid gap-4">{bookings.map((booking) => <article key={booking.id} className={card}><div className="flex flex-wrap items-start justify-between gap-4"><div><Link className="text-lg font-bold text-teal-900 hover:underline" to={`/properties/${booking.bed.room.property.id}`}>{booking.bed.room.property.name}</Link><p className="mt-1 text-sm text-slate-600">{booking.bed.room.property.city} · Room {booking.bed.room.roomNumber} · Bed {booking.bed.label}</p><p className="mt-2 text-sm text-slate-500">{booking.startDate.slice(0, 10)} to {booking.endDate?.slice(0, 10)} (end date exclusive)</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold">{booking.status}</span></div>{(booking.status === "PENDING" || (booking.status === "CONFIRMED" && booking.startDate.slice(0, 10) > utcDate())) && <button className={`${secondary} mt-4`} disabled={busy === booking.id} onClick={() => cancel(booking.id)}>{busy === booking.id ? "Cancelling…" : "Cancel request"}</button>}</article>)}</div>}</main>;
}

function OwnerBookings({ user }: { user: AuthUser | null }) {
  const [filter, setFilter] = useState<BookingStatus | "ALL">("PENDING"); const [bookings, setBookings] = useState<Booking[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { setLoading(true); setError(null); bookingApi.ownerList(filter === "ALL" ? undefined : filter).then(({ bookings: rows }) => setBookings(rows)).catch((reason) => setError(errorMessage(reason))).finally(() => setLoading(false)); }, [filter]);
  useEffect(() => { if (user && (user.role === "OWNER" || user.role === "ADMIN")) load(); else setLoading(false); }, [user, load]);
  async function action(id: string, kind: "approve" | "reject" | "cancel" | "check-in") { setBusy(id); setError(null); setNotice(null); try { if (kind === "approve") await bookingApi.approve(id); else if (kind === "reject") await bookingApi.reject(id); else if (kind === "cancel") await bookingApi.cancelOwner(id); else { const result = await tenancyApi.checkIn(id); setNotice(result.repeated ? "This booking already has a tenancy." : "Tenant checked in and tenancy created."); } await load(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(null); } }
  if (!user) return <AccessMessage title="Sign in to review booking requests" />;
  if (user.role !== "OWNER" && user.role !== "ADMIN") return <AccessMessage title="Owner access required" />;
  return <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8"><p className="text-sm font-semibold text-teal-800">Owner workspace</p><h1 className="mt-2 text-3xl font-bold">Booking requests</h1><p className="mt-2 text-slate-600">Requests are scoped to your properties. Confirming a request reserves the bed for its date range.</p><label className="mt-5 block max-w-xs text-sm font-medium">Filter by status<select className={field} value={filter} onChange={(event) => setFilter(event.target.value as BookingStatus | "ALL")}><option value="PENDING">Pending</option><option value="CONFIRMED">Confirmed</option><option value="REJECTED">Rejected</option><option value="CANCELLED">Cancelled</option><option value="ALL">All requests</option></select></label>{notice && <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900" role="status">{notice}</p>}{error && <ErrorPanel message={error} retry={load} />}{loading ? <Loading /> : bookings.length === 0 ? <Empty title="No matching requests" body="Booking requests for your properties will appear here." /> : <div className="mt-6 grid gap-4">{bookings.map((booking) => <article key={booking.id} className={card}><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-bold">{booking.bed.room.property.name}</h2><p className="mt-1 text-sm text-slate-600">{booking.bed.room.property.city} · Room {booking.bed.room.roomNumber} · Bed {booking.bed.label}</p><p className="mt-2 text-sm text-slate-500">{booking.startDate.slice(0, 10)} to {booking.endDate?.slice(0, 10)} (end date exclusive)</p><p className="mt-2 text-sm text-slate-700">{booking.tenant?.fullName} · {booking.tenant?.email}</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold">{booking.status}</span></div>{booking.status === "PENDING" && <div className="mt-4 flex gap-2"><button className={button} disabled={busy === booking.id} onClick={() => action(booking.id, "approve")}>{busy === booking.id ? "Saving…" : "Approve"}</button><button className={secondary} disabled={busy === booking.id} onClick={() => action(booking.id, "reject")}>Reject</button></div>}{booking.status === "CONFIRMED" && booking.startDate.slice(0, 10) > utcDate() && <button className={`${secondary} mt-4`} disabled={busy === booking.id} onClick={() => action(booking.id, "cancel")}>{busy === booking.id ? "Saving…" : "Cancel confirmed booking"}</button>}{booking.status === "CONFIRMED" && booking.startDate.slice(0, 10) <= utcDate() && !booking.tenancy && <button className={`${button} mt-4`} disabled={busy === booking.id} onClick={() => action(booking.id, "check-in")}>{busy === booking.id ? "Checking in…" : "Check in and create tenancy"}</button>}</article>)}</div>}</main>;
}

function TenantTenancies({ user }: { user: AuthUser | null }) {
  const [rows, setRows] = useState<Tenancy[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setLoading(true); setError(null); tenancyApi.tenantList().then(({ tenancies }) => setRows(tenancies)).catch((reason) => setError(errorMessage(reason))).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (user?.role === "TENANT") load(); else setLoading(false); }, [user, load]);
  if (!user) return <AccessMessage title="Sign in to see your tenancy" />;
  if (user.role !== "TENANT") return <AccessMessage title="Tenant access required" />;
  return <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8"><h1 className="text-3xl font-bold">My tenancy</h1><p className="mt-2 text-slate-600">Tenancies begin when the property owner checks you in from a confirmed booking.</p>{error && <ErrorPanel message={error} retry={load} />}{loading ? <Loading /> : rows.length === 0 ? <Empty title="No active or past tenancies" body="After a confirmed booking begins, the owner can check you in here." /> : <div className="mt-6 grid gap-4">{rows.map((row) => <TenancyCard key={row.id} tenancy={row} />)}</div>}</main>;
}

function OwnerTenancies({ user }: { user: AuthUser | null }) {
  const [rows, setRows] = useState<Tenancy[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { setLoading(true); setError(null); tenancyApi.ownerList().then(({ tenancies }) => setRows(tenancies)).catch((reason) => setError(errorMessage(reason))).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (user && (user.role === "OWNER" || user.role === "ADMIN")) load(); else setLoading(false); }, [user, load]);
  async function checkOut(id: string) { setBusy(id); setError(null); try { await tenancyApi.checkOut(id); await load(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(null); } }
  if (!user) return <AccessMessage title="Sign in to manage tenancies" />;
  if (user.role !== "OWNER" && user.role !== "ADMIN") return <AccessMessage title="Owner access required" />;
  return <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8"><h1 className="text-3xl font-bold">Tenancies</h1><p className="mt-2 text-slate-600">Active tenancies are linked to their confirmed source bookings. Check-out ends active occupancy.</p>{error && <ErrorPanel message={error} retry={load} />}{loading ? <Loading /> : rows.length === 0 ? <Empty title="No tenancies yet" body="Check in from an eligible confirmed booking when the stay begins." /> : <div className="mt-6 grid gap-4">{rows.map((row) => <article key={row.id} className={card}><TenancyCard tenancy={row} /><p className="mt-3 text-sm text-slate-600">Tenant: {row.tenant.fullName} · {row.tenant.email}</p>{row.status === "ACTIVE" && <button className={`${button} mt-4`} disabled={busy === row.id} onClick={() => checkOut(row.id)}>{busy === row.id ? "Checking out…" : "Check out"}</button>}</article>)}</div>}</main>;
}

function TenancyCard({ tenancy }: { tenancy: Tenancy }) {
  return <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-bold">{tenancy.bed.room.property.name}</h2><p className="mt-1 text-sm text-slate-600">{tenancy.bed.room.property.city} · Room {tenancy.bed.room.roomNumber} · Bed {tenancy.bed.label}</p><p className="mt-2 text-sm text-slate-500">Booked interval: {tenancy.startDate.slice(0, 10)} to {tenancy.endDate?.slice(0, 10) ?? "open-ended"} (end exclusive)</p><p className="mt-1 text-sm text-slate-500">{tenancy.checkedInAt ? `Checked in ${new Date(tenancy.checkedInAt).toLocaleString()}` : "Check-in time unavailable"}{tenancy.checkedOutAt ? ` · Checked out ${new Date(tenancy.checkedOutAt).toLocaleString()}` : ""}</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold">{tenancy.status}</span></div>;
}

function TenantBilling({ user }: { user: AuthUser | null }) {
  const [invoices, setInvoices] = useState<RentInvoice[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setLoading(true); setError(null); billingApi.tenantList().then(({ invoices: rows }) => setInvoices(rows)).catch((reason) => setError(errorMessage(reason))).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (user?.role === "TENANT") load(); else setLoading(false); }, [user, load]);
  if (!user) return <AccessMessage title="Sign in to view your rent invoices" />;
  if (user.role !== "TENANT") return <AccessMessage title="Tenant access required" />;
  return <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8"><p className="text-sm font-semibold text-teal-800">Tenant account</p><h1 className="mt-2 text-3xl font-bold">Rent billing</h1><p className="mt-2 text-slate-600">Review invoice periods, due dates, recorded payments and remaining balances.</p>{error && <ErrorPanel message={error} retry={load} />}{loading ? <Loading /> : invoices.length === 0 ? <Empty title="No rent invoices yet" body="Invoices for your tenancy will appear here when issued by the property owner." /> : <div className="mt-6 grid gap-4">{invoices.map((invoice) => <InvoiceSummary key={invoice.id} invoice={invoice} />)}</div>}</main>;
}

function OwnerRentManagement({ user }: { user: AuthUser | null }) {
  const [invoices, setInvoices] = useState<RentInvoice[]>([]); const [tenancies, setTenancies] = useState<Tenancy[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([billingApi.ownerList(), tenancyApi.ownerList()]).then(([invoiceResult, tenancyResult]) => { setInvoices(invoiceResult.invoices); setTenancies(tenancyResult.tenancies); }).catch((reason) => setError(errorMessage(reason))).finally(() => setLoading(false));
  }, []);
  useEffect(() => { if (user && (user.role === "OWNER" || user.role === "ADMIN")) load(); else setLoading(false); }, [user, load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setBusy(true); setError(null); setNotice(null);
    try {
      await billingApi.createInvoice(String(values.get("tenancyId")), { periodStart: String(values.get("periodStart")), periodEnd: String(values.get("periodEnd")), dueDate: String(values.get("dueDate")), amount: String(values.get("amount")), currencyCode: String(values.get("currencyCode")) });
      form.reset(); setNotice("Invoice issued. The tenant can now see it on their billing page."); load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  if (!user) return <AccessMessage title="Sign in to manage rent" />;
  if (user.role !== "OWNER" && user.role !== "ADMIN") return <AccessMessage title="Owner access required" />;
  const eligible = tenancies.filter((tenancy) => tenancy.status === "ACTIVE" || tenancy.status === "ENDED");
  return <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8"><p className="text-sm font-semibold text-teal-800">Owner workspace</p><h1 className="mt-2 text-3xl font-bold">Rent management</h1><p className="mt-2 text-slate-600">Issue tenancy invoices and record manually received payments. Entries are not gateway-verified.</p>{notice && <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900" role="status">{notice}</p>}{error && <ErrorPanel message={error} retry={load} />}
    <div className="mt-7 grid items-start gap-6 xl:grid-cols-[.75fr_1.25fr]"><section className={`${card} space-y-4`}><h2 className="text-xl font-bold">Issue a rent invoice</h2>{loading ? <Loading /> : eligible.length === 0 ? <Empty title="No eligible tenancies" body="Check in a tenant before issuing an invoice." /> : <form onSubmit={create} className="space-y-3"><label className="block text-sm font-medium">Tenancy<select name="tenancyId" className={field} required defaultValue=""><option value="" disabled>Select a tenancy</option>{eligible.map((tenancy) => <option key={tenancy.id} value={tenancy.id}>{tenancy.bed.room.property.name} · {tenancy.tenant.fullName} · Room {tenancy.bed.room.roomNumber}, bed {tenancy.bed.label}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Period start<input className={field} name="periodStart" type="date" required defaultValue={utcDate()} /></label><label className="text-sm font-medium">Period end (exclusive)<input className={field} name="periodEnd" type="date" required defaultValue={utcDate(30)} /></label><label className="text-sm font-medium">Due date<input className={field} name="dueDate" type="date" required defaultValue={utcDate(7)} /></label><label className="text-sm font-medium">Amount<input className={field} name="amount" type="number" min="0.01" max="9999999999.99" step="0.01" required placeholder="15000.00" /></label><label className="text-sm font-medium sm:col-span-2">Currency code<input className={field} name="currencyCode" defaultValue="INR" pattern="[A-Za-z]{3}" maxLength={3} required /></label></div><button className={button} disabled={busy}>{busy ? "Issuing…" : "Issue invoice"}</button></form>}</section>
      <section><h2 className="mb-4 text-xl font-bold">Invoices and balances</h2>{loading ? <Loading /> : invoices.length === 0 ? <Empty title="No invoices yet" body="Issued invoices will appear here with payment history and balances." /> : <div className="grid gap-4">{invoices.map((invoice) => <OwnerInvoiceCard key={invoice.id} invoice={invoice} refresh={load} />)}</div>}</section></div>
  </main>;
}

function OwnerInvoiceCard({ invoice, refresh }: { invoice: RentInvoice; refresh: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const keys = useRef(new Map<string, string>());
  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    const input = { amount: String(values.get("amount")), paymentDate: String(values.get("paymentDate")), method: String(values.get("method")) as PaymentMethod, reference: String(values.get("reference") ?? "").trim() || undefined };
    const signature = JSON.stringify(input); const idempotencyKey = keys.current.get(signature) ?? crypto.randomUUID(); keys.current.set(signature, idempotencyKey);
    setBusy(true); setError(null); setNotice(null);
    try { const result = await billingApi.recordPayment(invoice.id, { ...input, idempotencyKey }); keys.current.delete(signature); form.reset(); setNotice(result.repeated ? "This payment was already recorded." : "Payment recorded and balance updated."); refresh(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <article className={card}><InvoiceSummary invoice={invoice} /><p className="mt-3 text-sm text-slate-700">Tenant: {invoice.tenancy.tenant.fullName} · {invoice.tenancy.tenant.email}</p>{notice && <p className="mt-3 text-sm text-emerald-800" role="status">{notice}</p>}{error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
    {invoice.status !== "PAID" && invoice.status !== "VOID" && <form onSubmit={record} className="mt-4 grid items-end gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-5"><label className="text-sm font-medium">Payment amount<input name="amount" className={field} type="number" min="0.01" max={invoice.balanceDue} step="0.01" required /></label><label className="text-sm font-medium">Payment date<input name="paymentDate" className={field} type="date" max={utcDate()} required defaultValue={utcDate()} /></label><label className="text-sm font-medium">Method<select name="method" className={field}><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="UPI">UPI</option><option value="CARD">Card</option><option value="CHEQUE">Cheque</option><option value="OTHER">Other</option></select></label><label className="text-sm font-medium">Reference (optional)<input name="reference" className={field} maxLength={200} /></label><button className={button} disabled={busy}>{busy ? "Recording…" : "Record payment"}</button></form>}
  </article>;
}

function InvoiceSummary({ invoice }: { invoice: RentInvoice }) {
  return <><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-bold">{invoice.tenancy.bed.room.property.name} · {invoice.currencyCode} {invoice.amount}</h3><p className="mt-1 text-sm text-slate-600">Room {invoice.tenancy.bed.room.roomNumber} · Bed {invoice.tenancy.bed.label}</p><p className="mt-2 text-sm text-slate-500">Period {invoice.periodStart.slice(0, 10)} to {invoice.periodEnd.slice(0, 10)} (end exclusive) · Due {invoice.dueDate.slice(0, 10)}</p><p className="mt-2 text-sm font-semibold">Paid {invoice.currencyCode} {invoice.amountPaid} · Outstanding {invoice.currencyCode} {invoice.balanceDue}</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold">{invoice.status}</span></div>
    <div className="mt-4 border-t border-slate-200 pt-3"><h4 className="text-sm font-bold">Payment history</h4>{invoice.payments.length === 0 ? <p className="mt-2 text-sm text-slate-500">No payments recorded.</p> : <ul className="mt-2 space-y-2">{invoice.payments.map((payment) => <li key={payment.id} className="flex flex-wrap justify-between gap-2 text-sm"><span>{payment.currencyCode.trim()} {payment.amount} · {payment.method.replaceAll("_", " ")} · {payment.status === "SUCCEEDED" ? "Manually recorded" : payment.status}</span><span className="text-slate-500">{payment.recordedAt ? payment.recordedAt.slice(0, 10) : "Date unavailable"}{payment.reference ? ` · Ref ${payment.reference}` : ""}</span></li>)}</ul>}</div></>;
}

function ManageProperty({ user }: { user: AuthUser | null }) {
  const { propertyId = "" } = useParams(); const [property, setProperty] = useState<Property | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setLoading(true); setError(null); propertyApi.managedProperty(propertyId).then(({ property: value }) => setProperty(value)).catch((reason) => setError(errorMessage(reason))).finally(() => setLoading(false)); }, [propertyId]);
  useEffect(() => { if (user && (user.role === "OWNER" || user.role === "ADMIN")) load(); else setLoading(false); }, [user, load]);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!property) return; const form = new FormData(event.currentTarget); const values = Object.fromEntries(form.entries()); setBusy(true); setError(null); try { await propertyApi.updateProperty(property.id, { ...values, status: values.status as Property["status"] }); load(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } }
  async function remove() { if (!property || !window.confirm("Delete this property? Properties with rooms or records cannot be deleted.")) return; try { await propertyApi.deleteProperty(property.id); window.location.assign("/manage"); } catch (reason) { setError(errorMessage(reason)); } }
  if (!user) return <AccessMessage title="Sign in to manage this property" />; if (user.role !== "OWNER" && user.role !== "ADMIN") return <AccessMessage title="Owner access required" />; if (loading) return <Loading />; if (!property) return <ErrorPanel message={error ?? "Property unavailable."} />;
  return <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8"><Link className="text-sm font-semibold text-teal-800" to="/manage">← Dashboard</Link><div className="mt-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-teal-800">Property management</p><h1 className="mt-1 text-3xl font-bold">{property.name}</h1></div><Link className={secondary} to={`/properties/${property.id}`}>Public view</Link></div>{error && <div className="mt-4"><ErrorPanel message={error} retry={load} /></div>}<form className={`${card} mt-6 grid gap-4 sm:grid-cols-2`} onSubmit={save}><h2 className="text-xl font-bold sm:col-span-2">Property details</h2><TextField label="Property name" name="name" defaultValue={property.name} required maxLength={160} /><TextField label="Address" name="addressLine1" defaultValue={property.addressLine1} required maxLength={200} /><TextField label="Address line 2" name="addressLine2" defaultValue={property.addressLine2 ?? ""} maxLength={200} /><TextField label="City" name="city" defaultValue={property.city} required maxLength={120} /><TextField label="Region" name="region" defaultValue={property.region} required maxLength={120} /><TextField label="Postal code" name="postalCode" defaultValue={property.postalCode} required maxLength={24} /><TextField label="Country code" name="countryCode" defaultValue={property.countryCode} required maxLength={2} /><label className="block text-sm font-medium">Status<select name="status" defaultValue={property.status} className={field}><option value="DRAFT">Draft</option><option value="ACTIVE">Published</option><option value="INACTIVE">Inactive</option></select></label><label className="block text-sm font-medium sm:col-span-2">Description<textarea name="description" defaultValue={property.description ?? ""} className={field} maxLength={5000} rows={4} /></label><div className="flex gap-3 sm:col-span-2"><button className={button} disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>{user.role === "OWNER" && <button type="button" onClick={remove} className={secondary}>Delete property</button>}</div></form><RoomsEditor property={property} refresh={load} reportError={setError} /></main>;
}

function RoomsEditor({ property, refresh, reportError }: { property: Property; refresh: () => void; reportError: (value: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  async function addRoom(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const roomNumber = String(form.get("roomNumber") ?? ""); const floorValue = String(form.get("floor") ?? ""); setBusy(true); reportError(null); try { await propertyApi.addRoom(property.id, { roomNumber, floor: floorValue ? Number(floorValue) : null }); event.currentTarget.reset(); refresh(); } catch (error) { reportError(errorMessage(error)); } finally { setBusy(false); } }
  return <section className="mt-9"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-2xl font-bold">Rooms and beds</h2><p className="mt-1 text-sm text-slate-500">Room and bed identifiers must be unique within their parent.</p></div><form onSubmit={addRoom} className="flex flex-wrap items-end gap-2"><label className="text-sm font-medium">Room number<input name="roomNumber" className={`${field} min-w-36`} required maxLength={40} /></label><label className="text-sm font-medium">Floor<input name="floor" type="number" className={`${field} w-24`} /></label><button disabled={busy} className={button}>{busy ? "Adding…" : "Add room"}</button></form></div>{!property.rooms?.length ? <Empty title="No rooms yet" body="Add the first room above." /> : <div className="mt-5 grid gap-4">{property.rooms.map((room) => <RoomManagement key={room.id} property={property} room={room} refresh={refresh} reportError={reportError} />)}</div>}</section>;
}

function RoomManagement({ property, room, refresh, reportError }: { property: Property; room: Room; refresh: () => void; reportError: (value: string | null) => void }) {
  const [label, setLabel] = useState(""); const [busy, setBusy] = useState(false); const [roomNumber, setRoomNumber] = useState(room.roomNumber); const [floor, setFloor] = useState(room.floor?.toString() ?? "");
  async function addBed(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); reportError(null); try { await propertyApi.addBed(property.id, room.id, { label }); setLabel(""); refresh(); } catch (error) { reportError(errorMessage(error)); } finally { setBusy(false); } }
  async function roomStatus(status: Room["status"]) { try { await propertyApi.updateRoom(property.id, room.id, { status }); refresh(); } catch (error) { reportError(errorMessage(error)); } }
  async function saveRoom(event: FormEvent<HTMLFormElement>) { event.preventDefault(); try { await propertyApi.updateRoom(property.id, room.id, { roomNumber, floor: floor ? Number(floor) : null }); refresh(); } catch (error) { reportError(errorMessage(error)); } }
  async function deleteRoom() { if (!window.confirm(`Delete room ${room.roomNumber}? It must have no beds.`)) return; try { await propertyApi.deleteRoom(property.id, room.id); refresh(); } catch (error) { reportError(errorMessage(error)); } }
  return <article className={card}><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-lg font-bold">Room {room.roomNumber}</h3><p className="text-sm text-slate-500">Floor {room.floor ?? "not set"} · {room.status}</p></div><div className="flex gap-2"><button className={secondary} onClick={() => roomStatus(room.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}>{room.status === "ACTIVE" ? "Set inactive" : "Set active"}</button><button className={secondary} onClick={deleteRoom}>Delete</button></div></div><form onSubmit={saveRoom} className="mt-4 flex flex-wrap items-end gap-2"><label className="text-sm font-medium">Room number<input className={`${field} min-w-36`} value={roomNumber} onChange={(event) => setRoomNumber(event.target.value)} required maxLength={40} /></label><label className="text-sm font-medium">Floor<input className={`${field} w-24`} type="number" value={floor} onChange={(event) => setFloor(event.target.value)} /></label><button className={secondary}>Save room</button></form><div className="mt-4 grid gap-2 sm:grid-cols-2">{room.beds?.map((bed) => <BedManagement key={bed.id} property={property} room={room} bed={bed} refresh={refresh} reportError={reportError} />)}</div><form className="mt-4 flex gap-2" onSubmit={addBed}><input className={field} aria-label={`Bed identifier for room ${room.roomNumber}`} placeholder="Bed identifier" value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={40} /><button className={button} disabled={busy}>{busy ? "Adding…" : "Add bed"}</button></form></article>;
}

function BedManagement({ property, room, bed, refresh, reportError }: { property: Property; room: Room; bed: Bed; refresh: () => void; reportError: (value: string | null) => void }) {
  const [label, setLabel] = useState(bed.label); const [status, setStatus] = useState<NonNullable<Bed["status"]>>(bed.status ?? "AVAILABLE");
  async function save() { try { await propertyApi.updateBed(property.id, room.id, bed.id, { label, status }); refresh(); } catch (error) { reportError(errorMessage(error)); } }
  async function remove() { if (!window.confirm(`Delete bed ${bed.label}?`)) return; try { await propertyApi.deleteBed(property.id, room.id, bed.id); refresh(); } catch (error) { reportError(errorMessage(error)); } }
  return <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3"><label className="text-xs font-medium">Bed ID<input className="mt-1 w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={40} /></label><select className="mt-4 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" aria-label={`Status for bed ${bed.label}`} value={status} onChange={(event) => setStatus(event.target.value as NonNullable<Bed["status"]>)}><option value="AVAILABLE">Available</option><option value="MAINTENANCE">Maintenance</option><option value="INACTIVE">Inactive</option></select><button className="mt-4 text-sm font-semibold text-teal-800" onClick={save}>Save</button><button className="mt-4 text-sm font-medium text-red-700" onClick={remove}>Delete</button></div>;
}

function TextField({ label, name, ...props }: { label: string; name: string; [key: string]: unknown }) { return <label className="block text-sm font-medium">{label}<input name={name} className={field} {...props as React.InputHTMLAttributes<HTMLInputElement>} /></label>; }
function Loading() { return <div className="mx-auto max-w-7xl px-5 py-12 text-sm text-slate-500" aria-live="polite">Loading…</div>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className={`${card} mt-6 border-dashed text-center`}><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-slate-500">{body}</p></div>; }
function ErrorPanel({ message, retry }: { message: string; retry?: () => void }) { return <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert"><p>{message}</p>{retry && <button className="mt-2 font-semibold underline" onClick={retry}>Try again</button>}</div>; }
function AccessMessage({ title }: { title: string }) { return <main className="mx-auto max-w-3xl px-5 py-16 text-center"><h1 className="text-2xl font-bold">{title}</h1><Link className={`${button} mt-5`} to="/login">Sign in</Link></main>; }
