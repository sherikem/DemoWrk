// frontend/src/pages/forecast/ForecastTab.jsx
//
// Reservations Forecast — nights/revenue on the books by stay month,
// computed LIVE from bookings currently on file (rate_details +
// reservation_lead_time). No workbook upload: that was tied to an old
// Excel export that's being phased out now that the portal is the
// source of truth.
//
//   * KPIs + monthly chart  — current year vs the same months last year
//   * Projection            — for a partially-booked month, project the
//                              eventual final total from how past years'
//                              equivalent months built up by this same
//                              point in time
//   * Period comparison     — any two custom date ranges, side by side
//   * Booking activity      — gross bookings made per month, and how one
//                              stay month's bookings built up over time
//
// No budget or "same time last year" column: those only ever existed in
// the retired workbook. See backend/postgres/reservation_forecast.py for
// the full methodology and its one real limitation (cancelled reservations
// leave no trace in the source data, so this can't reproduce a true past
// snapshot — it's always "as of right now").

import { useEffect, useMemo, useState } from "react";
import {
    ComposedChart,
    BarChart,
    LineChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    ResponsiveContainer,
    CartesianGrid,
    ReferenceLine,
    Cell,
} from "recharts";
import {
    Download,
    BedDouble,
    DollarSign,
    TrendingUp,
    CalendarRange,
    Info,
    Loader2,
    Sparkles,
    ArrowLeftRight,
} from "lucide-react";
import * as XLSX from "xlsx";
import { forecastApi } from "../../api/forecastApi";

const serif = "'Cormorant Garamond', serif";

const C = {
    bg: "var(--dashboard-card)",
    panel: "var(--dashboard-panel)",
    panelAlt: "var(--dashboard-panel-alt)",
    border: "var(--dashboard-border)",
    rowBorder: "var(--dashboard-row-border)",
    text: "var(--dashboard-abyssal)",
    muted: "var(--dashboard-muted)",
    soft: "var(--dashboard-text-soft)",
    accent: "var(--dashboard-deep-blue)",
    accent2: "var(--dashboard-truffle)",
    flame: "#FFB162",
    truffle: "#A35139",
    deep: "#013A59",
    oat: "#C9C1B1",
    good: "#4F7A55",
    fair: "#B7791F",
};
const AX = "#9A8E84";
const GRID = "#DDD6CA";
const TIP = {
    background: "#f6f3ed",
    border: "1px solid #DDD6CA",
    borderRadius: 10,
    fontSize: 12,
    color: "#1B2632",
};
const YEAR_COLORS = [C.oat, "#5B8FA8", C.truffle, C.flame, C.deep, "#7A5C45", "#8C6E4F"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DURATIONS = [
    { value: 1, label: "1 month" },
    { value: 3, label: "3 months" },
    { value: 6, label: "6 months" },
    { value: 12, label: "12 months" },
];

/* ─── formatting ─────────────────────────────────────────────── */
const num = (v) => (v == null ? "–" : Math.round(v).toLocaleString());
const money = (v) =>
    v == null ? "–" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
const compact = (v) => {
    if (v == null) return "–";
    const a = Math.abs(v);
    const s = v < 0 ? "-" : "";
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
    return `${s}$${a.toFixed(0)}`;
};
const ratio = (a, b) => (a == null || !b ? null : a / b);
// Capped rather than hidden: a tiny prior-period base (a likely data gap,
// not a real trend) can otherwise blow up into a nonsensical percentage
// like "18032%" — still flagged as extreme, just not absurd-looking.
const pctText = (r) => {
    if (r == null) return "–";
    const pct = r * 100;
    return pct > 999 ? ">999%" : `${pct.toFixed(0)}%`;
};
const pctColor = (r) =>
    r == null ? C.muted : r >= 1 ? C.good : r >= 0.9 ? C.fair : C.truffle;
const signed = (v, fmt) => (v == null ? "–" : `${v > 0 ? "+" : ""}${fmt(v)}`);
const monthLabel = (iso, short = false) => {
    const [y, m] = String(iso).split("-").map(Number);
    return short ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : `${MONTHS[m - 1]} ${y}`;
};
const shiftMonth = (year, month, delta) => {
    let m = month + delta;
    let y = year;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    return { year: y, month: m };
};
const iso = (year, month) => `${year}-${String(month).padStart(2, "0")}-01`;

/* ─── small UI pieces ────────────────────────────────────────── */
const card = {
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 18,
    padding: 20,
    minWidth: 0,
};

function InfoTip({ text }) {
    const [open, setOpen] = useState(false);
    if (!text) return null;
    return (
        <span
            style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
        >
            <span
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: C.panelAlt,
                    color: C.muted,
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: "serif",
                    cursor: "help",
                    border: `1px solid ${C.border}`,
                }}
            >
                i
            </span>
            {open && (
                <span
                    role="tooltip"
                    style={{
                        position: "absolute",
                        top: "130%",
                        left: 0,
                        width: 230,
                        padding: "9px 11px",
                        borderRadius: 10,
                        background: "#1B2632",
                        color: "#F6F3ED",
                        fontSize: 11.5,
                        fontWeight: 400,
                        lineHeight: 1.45,
                        zIndex: 50,
                        boxShadow: "0 8px 20px rgba(0,0,0,0.2)",
                        textAlign: "left",
                    }}
                >
                    {text}
                </span>
            )}
        </span>
    );
}

function CardTitle({ title, hint, right, icon: Icon, info }) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 14,
                flexWrap: "wrap",
            }}
        >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                {Icon && (
                    <div
                        style={{
                            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                            background: C.panelAlt, display: "grid", placeItems: "center",
                        }}
                    >
                        <Icon size={16} color={C.accent2} />
                    </div>
                )}
                <div>
                    <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 7, fontFamily: serif, fontSize: 20, fontWeight: 600, color: C.text }}>
                        {title}
                        <InfoTip text={info} />
                    </p>
                    {hint && <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted, maxWidth: 480 }}>{hint}</p>}
                </div>
            </div>
            {right}
        </div>
    );
}

function Toggle({ options, value, onChange }) {
    return (
        <div
            style={{
                display: "inline-flex",
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                overflow: "hidden",
                background: C.panel,
            }}
        >
            {options.map((o) => {
                const active = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        onClick={() => onChange(o.value)}
                        style={{
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            border: "none",
                            cursor: "pointer",
                            background: active ? C.accent : "transparent",
                            color: active ? "#fff" : C.accent,
                        }}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

const selectStyle = {
    padding: "7px 10px",
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: C.panel,
    color: C.text,
    fontSize: 13,
    fontWeight: 600,
};
const buttonStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    borderRadius: 10,
    border: `1px solid ${C.accent2}`,
    background: C.panelAlt,
    color: C.accent,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
};

function Kpi({ icon: Icon, label, value, rows, accent, info }) {
    return (
        <div style={{ ...card, padding: 18, borderTop: `3px solid ${accent || C.flame}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.6 }}>
                    {label}
                    <InfoTip text={info} />
                </p>
                <Icon size={18} color={accent || "#C8976E"} />
            </div>
            <p style={{ margin: "6px 0 8px", fontFamily: serif, fontSize: 30, fontWeight: 600, color: C.text }}>
                {value}
            </p>
            {rows.map(([k, v, color]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
                    <span style={{ color: C.muted }}>{k}</span>
                    <span style={{ fontWeight: 700, color: color || C.text }}>{v}</span>
                </div>
            ))}
        </div>
    );
}

/* ═════════════════════════════════════════════════════════════
   PROJECTION — for a partially-booked month, project the eventual
   final total from how past years' equivalent months filled in by
   this same point in time.
   ═════════════════════════════════════════════════════════════ */
function ProjectionPanel({ months, metric, fmtVal, fmtAxis }) {
    const today = new Date();
    const monthOptions = useMemo(() => {
        // Any month from 6 back through 18 ahead of today, so the user can
        // project a month that's already partway through too.
        const cur = { year: today.getFullYear(), month: today.getMonth() + 1 };
        const out = [];
        for (let d = -6; d <= 18; d++) {
            const s = shiftMonth(cur.year, cur.month, d);
            out.push(s);
        }
        return out;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const [target, setTarget] = useState(() => {
        const cur = { year: today.getFullYear(), month: today.getMonth() + 1 };
        return iso(cur.year, cur.month);
    });
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        setLoading(true);
        forecastApi
            .projection(target)
            .then((d) => {
                setData(d);
                setError(null);
            })
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    }, [target]);

    const m = metric === "revenue" ? "revenue" : "nights";
    const proj = data ? data[`${m}_projection`] : null;
    const current = data ? data[`current_${m}`] : null;

    const yearChartData = (data?.years || []).map((y) => ({
        year: String(y.year),
        ratio: y[`${m}_ratio`] != null ? y[`${m}_ratio`] * 100 : null,
        reliable: y.reliable,
        coverage: y.coverage,
    }));

    return (
        <div style={card}>
            <CardTitle
                icon={Sparkles}
                title="Projection"
                hint="What's on the books now, projected to the eventual final total using how past years' equivalent months built up by this same point in time"
                info="For each past year, we look at the same calendar month and ask what share of its eventual total was already booked at this same lead time. Averaging that share across years gives a projection; the low/high range comes from the least and most complete years. Years with too few known booking dates are shown but excluded from the average."
                right={
                    <select style={selectStyle} value={target} onChange={(e) => setTarget(e.target.value)}>
                        {monthOptions.map((o) => (
                            <option key={iso(o.year, o.month)} value={iso(o.year, o.month)}>
                                {monthLabel(iso(o.year, o.month))}
                            </option>
                        ))}
                    </select>
                }
            />
            {loading ? (
                <div style={{ padding: "30px 0", textAlign: "center" }}>
                    <Loader2 size={20} color={C.muted} className="animate-spin" />
                </div>
            ) : error ? (
                <p style={{ color: C.truffle, fontSize: 13 }}>{error}</p>
            ) : !proj ? (
                <p style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                    Not enough historical data with known booking dates to project this month yet.
                </p>
            ) : (
                <>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                            gap: 14,
                            marginBottom: 18,
                        }}
                    >
                        <div style={{ ...card, padding: 14, background: C.panel }}>
                            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>
                                On the books now
                            </p>
                            <p style={{ margin: "4px 0 0", fontFamily: serif, fontSize: 24, fontWeight: 600, color: C.text }}>
                                {fmtVal(current)}
                            </p>
                        </div>
                        <div style={{ ...card, padding: 14, background: C.panelAlt, border: `1px solid ${C.accent2}` }}>
                            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase" }}>
                                Projected final (expected)
                            </p>
                            <p style={{ margin: "4px 0 0", fontFamily: serif, fontSize: 24, fontWeight: 700, color: C.accent }}>
                                {fmtVal(proj.projected_avg)}
                            </p>
                        </div>
                        <div style={{ ...card, padding: 14, background: C.panel }}>
                            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>
                                Low – high range
                            </p>
                            <p style={{ margin: "4px 0 0", fontFamily: serif, fontSize: 17, fontWeight: 600, color: C.text }}>
                                {fmtVal(proj.projected_low)} – {fmtVal(proj.projected_high)}
                            </p>
                        </div>
                    </div>

                    <p style={{ fontSize: 11.5, color: C.muted, margin: "0 0 12px" }}>
                        Based on {data.years_used} past year{data.years_used === 1 ? "" : "s"} of{" "}
                        {monthLabel(target).split(" ")[0]}: on average, {(proj.ratio_avg * 100).toFixed(0)}% of the
                        eventual total was already on the books at this same point in time.
                    </p>

                    <div style={{ height: 160 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={yearChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                <CartesianGrid stroke={GRID} vertical={false} />
                                <XAxis dataKey="year" tick={{ fill: AX, fontSize: 11 }} axisLine={false} tickLine={false} />
                                <YAxis
                                    tickFormatter={(v) => `${v}%`}
                                    tick={{ fill: AX, fontSize: 11 }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={40}
                                />
                                <Tooltip
                                    contentStyle={TIP}
                                    formatter={(v, n, p) => [
                                        `${v == null ? "–" : v.toFixed(0)}%${p.payload.reliable ? "" : " (low confidence)"}`,
                                        "On the books by this point",
                                    ]}
                                />
                                <Bar dataKey="ratio" radius={[4, 4, 0, 0]}>
                                    {yearChartData.map((d, i) => (
                                        <Cell key={i} fill={d.reliable ? C.flame : C.oat} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <p style={{ fontSize: 11, color: C.muted, margin: "8px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
                        <Info size={11} /> Faded bars had incomplete booking-date history for that year, so they're
                        shown but not counted toward the projection above.
                    </p>
                </>
            )}
        </div>
    );
}

/* ═════════════════════════════════════════════════════════════
   PERIOD COMPARISON — any two custom date ranges, side by side.
   ═════════════════════════════════════════════════════════════ */
function PeriodComparisonPanel({ months, metric, fmtVal, fmtAxis }) {
    const today = new Date();
    const [duration, setDuration] = useState(3);
    const defaultB = shiftMonth(today.getFullYear(), today.getMonth() + 1, -(duration - 1));
    const [periodB, setPeriodB] = useState(defaultB);
    const [periodA, setPeriodA] = useState(shiftMonth(defaultB.year, defaultB.month, -12));

    // Keep both starts valid (not required to stay 12 months apart —
    // the user can drag them anywhere) when duration changes.
    useEffect(() => {
        setPeriodB((p) => p);
        setPeriodA((p) => p);
    }, [duration]);

    const byYM = useMemo(() => {
        const map = {};
        months.forEach((r) => (map[`${r.year}-${r.month}`] = r));
        return map;
    }, [months]);

    const rangeOf = (start) => {
        const out = [];
        let y = start.year, mo = start.month;
        for (let i = 0; i < duration; i++) {
            out.push({ year: y, month: mo });
            const nxt = shiftMonth(y, mo, 1);
            y = nxt.year; mo = nxt.month;
        }
        return out;
    };

    const rangeA = rangeOf(periodA);
    const rangeB = rangeOf(periodB);
    const rangeLabel = (r) =>
        r.length === 1
            ? monthLabel(iso(r[0].year, r[0].month))
            : `${monthLabel(iso(r[0].year, r[0].month), true)} – ${monthLabel(iso(r[r.length - 1].year, r[r.length - 1].month), true)}`;

    const sumRange = (r) => {
        const nights = r.reduce((a, { year, month }) => a + (byYM[`${year}-${month}`]?.nights ?? 0), 0);
        const revenue = r.reduce((a, { year, month }) => a + (byYM[`${year}-${month}`]?.revenue ?? 0), 0);
        return { nights, revenue };
    };
    const totalA = sumRange(rangeA);
    const totalB = sumRange(rangeB);
    const m = metric === "revenue" ? "revenue" : "nights";
    const delta = ratio(totalB[m] - totalA[m], totalA[m]);

    const chartData = rangeA.map((a, i) => {
        const b = rangeB[i];
        return {
            idx: `M${i + 1}`,
            labelA: monthLabel(iso(a.year, a.month), true),
            labelB: monthLabel(iso(b.year, b.month), true),
            [rangeLabel(rangeA)]: byYM[`${a.year}-${a.month}`]?.[m] ?? null,
            [rangeLabel(rangeB)]: byYM[`${b.year}-${b.month}`]?.[m] ?? null,
        };
    });
    const keyA = rangeLabel(rangeA);
    const keyB = rangeLabel(rangeB);

    const monthPicker = (val, onChange) => (
        <div style={{ display: "flex", gap: 6 }}>
            <select
                style={selectStyle}
                value={val.month}
                onChange={(e) => onChange({ ...val, month: Number(e.target.value) })}
            >
                {MONTHS.map((mn, i) => (
                    <option key={mn} value={i + 1}>{mn}</option>
                ))}
            </select>
            <select
                style={selectStyle}
                value={val.year}
                onChange={(e) => onChange({ ...val, year: Number(e.target.value) })}
            >
                {Array.from({ length: 10 }, (_, i) => today.getFullYear() - 7 + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                ))}
            </select>
        </div>
    );

    return (
        <div style={card}>
            <CardTitle
                icon={ArrowLeftRight}
                title="Compare periods"
                hint="Any two custom date ranges, side by side: pick a start month for each and a shared length"
                info="Sums nights and revenue across each period from the same live figures shown above, so it inherits the same as-of-today limitation: neither period is a reconstructed historical snapshot."
                right={
                    <Toggle value={duration} onChange={setDuration} options={DURATIONS} />
                }
            />
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 18 }}>
                <div>
                    <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: C.truffle, textTransform: "uppercase" }}>
                        Period A start
                    </p>
                    {monthPicker(periodA, setPeriodA)}
                </div>
                <div>
                    <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: C.deep, textTransform: "uppercase" }}>
                        Period B start
                    </p>
                    {monthPicker(periodB, setPeriodB)}
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 18 }}>
                <div style={{ ...card, padding: 14, background: C.panel, borderLeft: `3px solid ${C.truffle}` }}>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.muted }}>{rangeLabel(rangeA)}</p>
                    <p style={{ margin: "4px 0 0", fontFamily: serif, fontSize: 22, fontWeight: 600, color: C.text }}>
                        {fmtVal(totalA[m])}
                    </p>
                </div>
                <div style={{ ...card, padding: 14, background: C.panel, borderLeft: `3px solid ${C.deep}` }}>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.muted }}>{rangeLabel(rangeB)}</p>
                    <p style={{ margin: "4px 0 0", fontFamily: serif, fontSize: 22, fontWeight: 600, color: C.text }}>
                        {fmtVal(totalB[m])}
                    </p>
                </div>
                <div style={{ ...card, padding: 14, background: C.panelAlt }}>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.muted }}>B vs A</p>
                    <p style={{ margin: "4px 0 0", fontFamily: serif, fontSize: 22, fontWeight: 700, color: pctColor(delta == null ? null : 1 + delta) }}>
                        {delta == null ? "–" : `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(0)}%`}
                    </p>
                </div>
            </div>

            <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="idx" tick={{ fill: AX, fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={fmtAxis} tick={{ fill: AX, fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                        <Tooltip
                            contentStyle={TIP}
                            formatter={(v) => fmtVal(v)}
                            labelFormatter={(l, p) => {
                                const row = p?.[0]?.payload;
                                return row ? `${row.labelA} / ${row.labelB}` : l;
                            }}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey={keyA} fill={C.truffle} radius={[4, 4, 0, 0]} />
                        <Bar dataKey={keyB} fill={C.deep} radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

/* ═════════════════════════════════════════════════════════════ */
export default function ForecastTab() {
    const [months, setMonths] = useState([]);
    const [pickup, setPickup] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [year, setYear] = useState(new Date().getFullYear());
    const [metric, setMetric] = useState("revenue");
    const [paceMonth, setPaceMonth] = useState(null);
    const [pace, setPace] = useState([]);

    useEffect(() => {
        setLoading(true);
        Promise.all([forecastApi.months(), forecastApi.pickup()])
            .then(([m, p]) => {
                setMonths(m);
                setPickup(p);
                setError(null);
            })
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    const byYM = useMemo(() => {
        const map = {};
        months.forEach((r) => (map[`${r.year}-${r.month}`] = r));
        return map;
    }, [months]);
    const years = useMemo(() => [...new Set(months.map((r) => r.year))].sort(), [months]);

    const blockLines = useMemo(
        () =>
            MONTHS.map((_, i) => {
                const mo = i + 1;
                const cur = byYM[`${year}-${mo}`];
                const prev = byYM[`${year - 1}-${mo}`];
                return {
                    stay_month: iso(year, mo),
                    nights_current: cur?.nights ?? null,
                    revenue_current: cur?.revenue ?? null,
                    nights_prev_year: prev?.nights ?? null,
                    revenue_prev_year: prev?.revenue ?? null,
                };
            }),
        [byYM, year],
    );
    const totals = useMemo(() => {
        const sumKey = (k) => {
            const vals = blockLines.map((l) => l[k]).filter((v) => v != null);
            return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
        };
        return {
            nights_current: sumKey("nights_current"),
            revenue_current: sumKey("revenue_current"),
            nights_prev_year: sumKey("nights_prev_year"),
            revenue_prev_year: sumKey("revenue_prev_year"),
        };
    }, [blockLines]);

    useEffect(() => {
        if (!months.length || paceMonth) return;
        const today = new Date().toISOString().slice(0, 7);
        const future = months
            .filter((r) => `${r.year}-${String(r.month).padStart(2, "0")}` >= today && r.nights > 0)
            .sort((a, b) => a.year - b.year || a.month - b.month)[0];
        if (future) setPaceMonth(iso(future.year, future.month));
    }, [months, paceMonth]);

    useEffect(() => {
        if (!paceMonth) return;
        forecastApi.pace(paceMonth).then(setPace).catch(() => setPace([]));
    }, [paceMonth]);

    const m = metric === "revenue" ? "revenue" : "nights";
    const fmtAxis = metric === "revenue" ? compact : (v) => Math.round(v).toLocaleString();
    const fmtVal = metric === "revenue" ? money : num;

    const chartData = blockLines.map((l, i) => ({
        month: MONTHS[i],
        Current: l[`${m}_current`],
        "Same month last year": l[`${m}_prev_year`],
    }));
    const paceData = pace.map((p) => ({
        booked: monthLabel(p.booked_month, true),
        "On the books": p[`${m}_cumulative`],
    }));
    const pickupYears = useMemo(() => [...new Set(pickup.map((p) => p.year))].sort(), [pickup]);
    const pickupData = MONTHS.map((mn, i) => {
        const row = { month: mn };
        pickupYears.forEach((y) => {
            const rec = pickup.find((p) => p.year === y && p.month === i + 1);
            row[String(y)] = rec ? rec[m] : null;
        });
        return row;
    });
    const monthOptionsForPace = months.filter((r) => r.nights > 0);

    const exportTable = () => {
        const rowsOut = blockLines.map((l) => ({
            Month: monthLabel(l.stay_month),
            "Nights - Current": l.nights_current,
            "Nights - Same month last year": l.nights_prev_year,
            "Nights - % vs last year": ratio(l.nights_current, l.nights_prev_year),
            "Revenue - Current": l.revenue_current,
            "Revenue - Same month last year": l.revenue_prev_year,
            "Revenue - % vs last year": ratio(l.revenue_current, l.revenue_prev_year),
        }));
        rowsOut.push({
            Month: "Total",
            "Nights - Current": totals.nights_current,
            "Nights - Same month last year": totals.nights_prev_year,
            "Nights - % vs last year": ratio(totals.nights_current, totals.nights_prev_year),
            "Revenue - Current": totals.revenue_current,
            "Revenue - Same month last year": totals.revenue_prev_year,
            "Revenue - % vs last year": ratio(totals.revenue_current, totals.revenue_prev_year),
        });
        const ws = XLSX.utils.json_to_sheet(rowsOut);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Forecast ${year}`);
        XLSX.writeFile(wb, `reservations_forecast_${year}.xlsx`);
    };

    const th = {
        padding: "8px 10px", fontSize: 11, fontWeight: 700, color: C.muted,
        textAlign: "right", whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}`,
    };
    const td = { padding: "7px 10px", fontSize: 12.5, textAlign: "right", whiteSpace: "nowrap", color: C.text };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* ── header / info strip ── */}
            <div
                style={{
                    ...card,
                    padding: "10px 16px",
                    fontSize: 12,
                    color: C.muted,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                }}
            >
                <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                    Live from bookings on file, always as of right now, with no budget column. Hover the{" "}
                    <span style={{ fontWeight: 700 }}>i</span> on any box below for what it measures and its limits.
                </span>
            </div>

            {/* ── toolbar ── */}
            <div
                style={{
                    ...card,
                    padding: "14px 18px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>Stay year</span>
                    <select style={selectStyle} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                        {(years.length ? years : [new Date().getFullYear()]).map((y) => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                    <Toggle
                        value={metric}
                        onChange={setMetric}
                        options={[
                            { value: "revenue", label: "Revenue" },
                            { value: "nights", label: "Nights" },
                        ]}
                    />
                    {loading && <Loader2 size={16} color={C.muted} className="animate-spin" />}
                </div>
                <button type="button" style={buttonStyle} onClick={exportTable} disabled={!blockLines.length}>
                    <Download size={13} /> Export {year}
                </button>
            </div>

            {error && <div style={{ ...card, color: C.truffle, fontSize: 13 }}>{error}</div>}

            {/* ── KPIs ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                <Kpi
                    icon={BedDouble}
                    label={`Nights on the books · ${year}`}
                    value={num(totals.nights_current)}
                    accent={C.flame}
                    info="Total room nights currently booked for this stay year, counted from valid (non-cancelled) reservations on file right now."
                    rows={[
                        ["vs same months last year", pctText(ratio(totals.nights_current, totals.nights_prev_year)),
                            pctColor(ratio(totals.nights_current, totals.nights_prev_year))],
                    ]}
                />
                <Kpi
                    icon={DollarSign}
                    label={`Revenue on the books · ${year}`}
                    value={compact(totals.revenue_current)}
                    accent={C.deep}
                    info="Sum of nightly room rates for this stay year, excluding complimentary (Free) stays. Extras/add-ons and taxes are not included."
                    rows={[
                        ["vs same months last year", pctText(ratio(totals.revenue_current, totals.revenue_prev_year)),
                            pctColor(ratio(totals.revenue_current, totals.revenue_prev_year))],
                    ]}
                />
                <Kpi
                    icon={CalendarRange}
                    label="Average rate on the books"
                    value={totals.nights_current ? money(totals.revenue_current / totals.nights_current) : "–"}
                    accent={C.truffle}
                    info="Revenue on the books divided by nights on the books for this stay year: the blended nightly rate across every reservation currently booked."
                    rows={[
                        ["Same months last year",
                            totals.nights_prev_year ? money(totals.revenue_prev_year / totals.nights_prev_year) : "–"],
                        ["Months with bookings", `${blockLines.filter((l) => l.nights_current > 0).length}`],
                    ]}
                />
            </div>

            {/* ── month chart ── */}
            <div style={card}>
                <CardTitle
                    title={`${metric === "revenue" ? "Revenue" : "Nights"} by stay month · ${year}`}
                    hint="On the books right now, against the same month last year"
                    info="Each bar is what's currently booked for that month, as of today. It is not a snapshot from any past date, so this can look lower than an older report for the same month once cancellations are accounted for."
                />
                <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke={GRID} vertical={false} />
                            <XAxis dataKey="month" tick={{ fill: AX, fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis tickFormatter={fmtAxis} tick={{ fill: AX, fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
                            <Tooltip contentStyle={TIP} formatter={(v) => fmtVal(v)} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="Current" fill={C.flame} radius={[4, 4, 0, 0]} />
                            <Line dataKey="Same month last year" stroke={C.deep} strokeWidth={2} dot={{ r: 3 }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
                <div style={{ overflowX: "auto", marginTop: 14 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr>
                                <th style={{ ...th, textAlign: "left" }}>Month</th>
                                <th style={th}>Nights</th>
                                <th style={th}>Nights last year</th>
                                <th style={th}>Revenue</th>
                                <th style={th}>Revenue last year</th>
                                <th style={th}>% vs last year</th>
                            </tr>
                        </thead>
                        <tbody>
                            {blockLines.map((l, i) => (
                                <tr key={l.stay_month} style={{ borderBottom: `1px solid ${C.rowBorder}` }}>
                                    <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{MONTHS[i]}</td>
                                    <td style={td}>{num(l.nights_current)}</td>
                                    <td style={td}>{num(l.nights_prev_year)}</td>
                                    <td style={td}>{money(l.revenue_current)}</td>
                                    <td style={td}>{money(l.revenue_prev_year)}</td>
                                    <td style={{ ...td, fontWeight: 700, color: pctColor(ratio(l[`${m}_current`], l[`${m}_prev_year`])) }}>
                                        {pctText(ratio(l[`${m}_current`], l[`${m}_prev_year`]))}
                                    </td>
                                </tr>
                            ))}
                            <tr style={{ background: C.panelAlt, fontWeight: 700 }}>
                                <td style={{ ...td, textAlign: "left" }}>Total</td>
                                <td style={td}>{num(totals.nights_current)}</td>
                                <td style={td}>{num(totals.nights_prev_year)}</td>
                                <td style={td}>{money(totals.revenue_current)}</td>
                                <td style={td}>{money(totals.revenue_prev_year)}</td>
                                <td style={{ ...td, color: pctColor(ratio(totals[`${m}_current`], totals[`${m}_prev_year`])) }}>
                                    {pctText(ratio(totals[`${m}_current`], totals[`${m}_prev_year`]))}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── projection + comparison ── */}
            <ProjectionPanel months={months} metric={metric} fmtVal={fmtVal} fmtAxis={fmtAxis} />
            <PeriodComparisonPanel months={months} metric={metric} fmtVal={fmtVal} fmtAxis={fmtAxis} />

            {/* ── booking activity ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 18 }}>
                <div style={card}>
                    <CardTitle
                        icon={TrendingUp}
                        title="Booking pace"
                        hint="How one stay month's bookings built up over time"
                        info="Cumulative nights or revenue for the selected stay month, plotted by the month each booking was made. Since a since-cancelled booking leaves no trace, this reflects only reservations that are still on file today."
                        right={
                            monthOptionsForPace.length > 0 && (
                                <select style={selectStyle} value={paceMonth ?? ""} onChange={(e) => setPaceMonth(e.target.value)}>
                                    {monthOptionsForPace.map((r) => (
                                        <option key={iso(r.year, r.month)} value={iso(r.year, r.month)}>
                                            {monthLabel(iso(r.year, r.month))}
                                        </option>
                                    ))}
                                </select>
                            )
                        }
                    />
                    <div style={{ height: 240 }}>
                        {paceData.length < 2 ? (
                            <p style={{ color: C.muted, fontSize: 13, paddingTop: 40, textAlign: "center" }}>
                                Not enough booking history for this month yet.
                            </p>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={paceData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                    <CartesianGrid stroke={GRID} vertical={false} />
                                    <XAxis dataKey="booked" tick={{ fill: AX, fontSize: 11 }} axisLine={false} tickLine={false} />
                                    <YAxis tickFormatter={fmtAxis} tick={{ fill: AX, fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
                                    <Tooltip contentStyle={TIP} formatter={(v) => fmtVal(v)} />
                                    <Line dataKey="On the books" stroke={C.flame} strokeWidth={2.5} dot={{ r: 4 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                <div style={card}>
                    <CardTitle
                        title={`Gross bookings made · ${metric === "revenue" ? "revenue" : "nights"}`}
                        hint="By the month the booking was made, not net of later cancellations"
                        info="Every stay month rolled up by the calendar month its booking was made. Gross, not net: a booking that's since been cancelled disappears from its original month entirely instead of being subtracted out."
                    />
                    <div style={{ height: 240 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={pickupData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                <CartesianGrid stroke={GRID} vertical={false} />
                                <XAxis dataKey="month" tick={{ fill: AX, fontSize: 11 }} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={fmtAxis} tick={{ fill: AX, fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
                                <Tooltip contentStyle={TIP} formatter={(v) => fmtVal(v)} />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <ReferenceLine y={0} stroke={AX} />
                                {pickupYears.map((y, i) => (
                                    <Bar
                                        key={y}
                                        dataKey={String(y)}
                                        name={String(y)}
                                        fill={YEAR_COLORS[(YEAR_COLORS.length - pickupYears.length + i) % YEAR_COLORS.length]}
                                        radius={[3, 3, 0, 0]}
                                    />
                                ))}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
}
