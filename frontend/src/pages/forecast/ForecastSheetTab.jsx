// frontend/src/pages/forecast/ForecastSheetTab.jsx
//
// "Forecast Sheet" — second tab of Reservations Forecast. A refined, live
// rebuild of the property's monthly "Summary of Reservations Forecast"
// workbook: two stay-year blocks (this year + next), one row per month,
// with Nights and Revenue each shown as
//     On the books · Previous year · % of previous year · Same time last year · % of same time last year
// plus a "Change since <date>" group (the workbook's "As at <last month
// end>" + "Month Change" columns, collapsed into one pickup figure with the
// snapshot value on hover).
//
// Backed by GET /analytics/forecast/live/sheet (backend/postgres/reservation_forecast.py)
// — see that route's comment block for exactly how each column is derived.
//
// Differences from the workbook, on purpose:
//   * No Budget / % of Budget columns — no budget exists outside the old
//     workbook. (Easy to add later if budgets get stored somewhere.)
//   * "This time last year" is reconstructed from booking dates, so months
//     where too few prior-year nights have a known booking date are marked
//     with * instead of shown as if they were solid.
//   * The compare date for the change columns is selectable (end of last
//     month by default, like the workbook, or 7 / 30 days ago, or any date).

import { Fragment, useEffect, useMemo, useState } from "react";
import { Download, Loader2, CalendarClock, BedDouble, DollarSign, TrendingUp } from "lucide-react";
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
    accent: "var(--dashboard-deep-blue)",
    accent2: "var(--dashboard-truffle)",
    flame: "#FFB162",
    truffle: "#A35139",
    deep: "#013A59",
    good: "#4F7A55",
    fair: "#B7791F",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LOW_COVERAGE = 0.5;

/* ─── formatting ─────────────────────────────────────────────── */
const num = (v) => (v == null ? "–" : Math.round(v).toLocaleString());
const money = (v) =>
    v == null ? "–" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
const compact = (v) => {
    if (v == null) return "–";
    const a = Math.abs(v);
    const s = v < 0 ? "-" : "";
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
    return `${s}$${a.toFixed(0)}`;
};
const ratio = (a, b) => (a == null || !b ? null : a / b);
const pctText = (r) => {
    if (r == null) return "–";
    const p = r * 100;
    return p > 999 ? ">999%" : `${p.toFixed(0)}%`;
};
const pctTone = (r) => (r == null ? null : r >= 1 ? C.good : r >= 0.9 ? C.fair : C.truffle);
const longDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${new Date(y, m - 1, d).toLocaleString(undefined, { month: "long" })} ${y}`;
};
const shortDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTHS[m - 1]}`;
};
const isoDaysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
};

/* ─── shared styles ──────────────────────────────────────────── */
const card = {
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 18,
    padding: 20,
    minWidth: 0,
};
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

// Small "i" with a hover/tap popup. align="right" opens leftward, for
// headers near the right edge of the scrolling table.
function InfoTip({ text, align = "left" }) {
    const [open, setOpen] = useState(false);
    if (!text) return null;
    return (
        <span
            style={{ position: "relative", display: "inline-flex", flexShrink: 0, verticalAlign: "middle", marginLeft: 5 }}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onClick={() => setOpen((o) => !o)}
        >
            <span
                style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 15, height: 15, borderRadius: "50%",
                    background: C.panelAlt, color: C.muted, border: `1px solid ${C.border}`,
                    fontSize: 9.5, fontWeight: 700, fontFamily: "serif", cursor: "help",
                    textTransform: "none", letterSpacing: 0,
                }}
            >
                i
            </span>
            {open && (
                <span
                    role="tooltip"
                    style={{
                        position: "absolute", top: "130%", [align === "right" ? "right" : "left"]: 0,
                        width: 240, padding: "9px 11px", borderRadius: 10,
                        background: "#1B2632", color: "#F6F3ED",
                        fontSize: 11.5, fontWeight: 400, lineHeight: 1.45, textAlign: "left",
                        textTransform: "none", letterSpacing: 0, whiteSpace: "normal",
                        zIndex: 50, boxShadow: "0 8px 20px rgba(0,0,0,0.2)",
                    }}
                >
                    {text}
                </span>
            )}
        </span>
    );
}

function Toggle({ options, value, onChange }) {
    return (
        <div style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", background: C.panel }}>
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

function Kpi({ icon: Icon, label, value, sub, subColor, accent }) {
    return (
        <div style={{ ...card, padding: 16, borderTop: `3px solid ${accent}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.6 }}>
                    {label}
                </p>
                <Icon size={17} color={accent} />
            </div>
            <p style={{ margin: "6px 0 4px", fontFamily: serif, fontSize: 28, fontWeight: 600, color: C.text }}>{value}</p>
            {sub && <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: subColor || C.muted }}>{sub}</p>}
        </div>
    );
}

const STATE_CHIP = {
    actual: { label: "Actual", bg: "rgba(154,142,132,0.16)", fg: "#7A6F66" },
    in_progress: { label: "Live", bg: "rgba(255,177,98,0.22)", fg: "#9A5B14" },
    forecast: { label: "On books", bg: "rgba(1,58,89,0.10)", fg: C.deep },
};

function StateChip({ state }) {
    const s = STATE_CHIP[state] || STATE_CHIP.forecast;
    return (
        <span
            style={{
                display: "inline-block",
                marginLeft: 8,
                padding: "1px 7px",
                borderRadius: 999,
                fontSize: 9.5,
                fontWeight: 800,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                background: s.bg,
                color: s.fg,
                verticalAlign: "1px",
            }}
        >
            {s.label}
        </span>
    );
}

function PctPill({ value, flagged, title }) {
    const tone = pctTone(value);
    if (value == null) return <span style={{ color: C.muted }}>–</span>;
    return (
        <span
            title={title}
            style={{
                display: "inline-block",
                minWidth: 46,
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 11.5,
                fontWeight: 800,
                textAlign: "center",
                color: flagged ? C.muted : tone,
                background: flagged ? "transparent" : `color-mix(in srgb, ${tone} 13%, transparent)`,
                border: flagged ? `1px dashed ${C.border}` : "1px solid transparent",
            }}
        >
            {pctText(value)}
            {flagged ? "*" : ""}
        </span>
    );
}

function Delta({ value, fmt, title }) {
    if (value == null) return <span style={{ color: C.muted }}>–</span>;
    const r = Math.round(value);
    if (r === 0) return <span title={title} style={{ color: C.muted }}>0</span>;
    return (
        <span title={title} style={{ fontWeight: 700, color: r > 0 ? C.good : C.truffle }}>
            {r > 0 ? "+" : "−"}
            {fmt(Math.abs(r))}
        </span>
    );
}

/* ─── totals helper ──────────────────────────────────────────── */
const SUM_KEYS = [
    "nights", "revenue", "prev_year_nights", "prev_year_revenue",
    "stly_nights", "stly_revenue", "snapshot_nights", "snapshot_revenue",
    "change_nights", "change_revenue",
];
function sumLines(lines) {
    const t = {};
    SUM_KEYS.forEach((k) => (t[k] = lines.reduce((a, l) => a + (l[k] || 0), 0)));
    return t;
}

/* ═════════════════════════════════════════════════════════════ */
export default function ForecastSheetTab() {
    const thisYear = new Date().getFullYear();
    const [year, setYear] = useState(thisYear);
    const [view, setView] = useState("both"); // both | nights | revenue
    const [compareMode, setCompareMode] = useState("month_end"); // month_end | 7 | 30 | custom
    const [customDate, setCustomDate] = useState(isoDaysAgo(14));
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const compareTo =
        compareMode === "month_end" ? undefined
            : compareMode === "custom" ? customDate
                : isoDaysAgo(Number(compareMode));

    useEffect(() => {
        if (compareMode === "custom" && !customDate) return;
        setLoading(true);
        forecastApi
            .sheet(year, compareTo)
            .then((d) => {
                setData(d);
                setError(null);
            })
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [year, compareMode, customDate]);

    const blocks = data?.blocks || [];
    const showN = view !== "revenue";
    const showR = view !== "nights";
    const changeLabel = data ? `Change since ${shortDate(data.compare_to)}` : "Change";

    /* KPI strip: next 12 stay months from the current one (across both blocks) */
    const kpis = useMemo(() => {
        if (!blocks.length) return null;
        const all = blocks.flatMap((b) => b.months);
        const startIdx = all.findIndex((l) => l.state !== "actual");
        const fwd = startIdx === -1 ? [] : all.slice(startIdx, startIdx + 12);
        const f = sumLines(fwd);
        const allChange = sumLines(all);
        return {
            fwdCount: fwd.length,
            fwdFrom: fwd[0],
            fwdTo: fwd[fwd.length - 1],
            nights: f.nights,
            revenue: f.revenue,
            nightsVsStly: ratio(f.nights, f.stly_nights),
            revenueVsStly: ratio(f.revenue, f.stly_revenue),
            pickupNights: allChange.change_nights,
            pickupRevenue: allChange.change_revenue,
        };
    }, [blocks]);

    /* ─── export, laid out like the original workbook ─── */
    const exportSheet = () => {
        if (!data) return;
        const aoa = [];
        const merges = [];
        const pctCells = [];
        const moneyCells = [];
        const NCOL = 13;

        aoa.push(["Summary of Reservations Forecast"]);
        aoa.push([`As at ${longDate(data.as_of)} · change since ${longDate(data.compare_to)} · same time last year = bookings made by ${longDate(data.stly_cutoff)}`]);
        aoa.push([]);
        merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: NCOL - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: NCOL - 1 } });

        blocks.forEach((b, bi) => {
            const h1 = aoa.length;
            aoa.push([String(b.year), "Nights Booked", "", "", "", "", "Revenue", "", "", "", "", `Change since ${shortDate(data.compare_to)}`, ""]);
            aoa.push([
                "Month",
                "On the books", "Previous year", "% of previous year", "Same time last year", "% of same time last year",
                "On the books", "Previous year", "% of previous year", "Same time last year", "% of same time last year",
                "Nights", "Revenue",
            ]);
            merges.push(
                { s: { r: h1, c: 1 }, e: { r: h1, c: 5 } },
                { s: { r: h1, c: 6 }, e: { r: h1, c: 10 } },
                { s: { r: h1, c: 11 }, e: { r: h1, c: 12 } },
            );
            const rowFor = (label, l) => {
                const r = aoa.length;
                aoa.push([
                    label,
                    l.nights, l.prev_year_nights, ratio(l.nights, l.prev_year_nights),
                    l.stly_nights, ratio(l.nights, l.stly_nights),
                    l.revenue, l.prev_year_revenue, ratio(l.revenue, l.prev_year_revenue),
                    l.stly_revenue, ratio(l.revenue, l.stly_revenue),
                    l.change_nights, l.change_revenue,
                ]);
                [3, 5, 8, 10].forEach((c) => pctCells.push({ r, c }));
                [6, 7, 9, 12].forEach((c) => moneyCells.push({ r, c }));
            };
            b.months.forEach((l) => rowFor(`${MONTHS[l.month - 1]} ${b.year}`, l));
            rowFor(`Total ${b.year}`, sumLines(b.months));
            if (bi < blocks.length - 1) aoa.push([]);
        });
        const all = sumLines(blocks.flatMap((b) => b.months));
        aoa.push([]);
        const cr = aoa.length;
        aoa.push(["Combined change", "", "", "", "", "", "", "", "", "", "", all.change_nights, all.change_revenue]);
        moneyCells.push({ r: cr, c: 12 });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!merges"] = merges;
        ws["!cols"] = [{ wch: 16 }, ...Array(10).fill({ wch: 14 }), { wch: 12 }, { wch: 14 }];
        const fmt = (cells, z) =>
            cells.forEach(({ r, c }) => {
                const ref = XLSX.utils.encode_cell({ r, c });
                if (ws[ref] && typeof ws[ref].v === "number") ws[ref].z = z;
            });
        fmt(pctCells, "0%");
        fmt(moneyCells, '"$"#,##0');
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Forecast ${blocks[0]?.year ?? ""}`);
        XLSX.writeFile(wb, `reservations_forecast_sheet_${data.as_of}.xlsx`);
    };

    /* ─── table pieces ─── */
    const th = {
        padding: "8px 10px",
        fontSize: 10.5,
        fontWeight: 800,
        color: C.muted,
        textAlign: "right",
        whiteSpace: "normal",
        lineHeight: 1.3,
        verticalAlign: "bottom",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        borderBottom: `1px solid ${C.border}`,
        background: C.panel,
    };
    const groupTh = (color) => ({
        ...th,
        textAlign: "center",
        fontSize: 11,
        color,
        borderBottom: `2px solid ${color}`,
        background: C.panel,
    });
    const td = { padding: "8px 10px", fontSize: 12.5, textAlign: "right", whiteSpace: "nowrap", color: C.text };
    const stickyCol = {
        position: "sticky",
        left: 0,
        zIndex: 1,
        textAlign: "left",
        minWidth: 128,
        boxShadow: `inset -1px 0 0 ${C.border}`,
    };
    const divider = { borderLeft: `1px solid ${C.border}` };

    const metricCells = (l, kind) => {
        const isN = kind === "nights";
        const cur = isN ? l.nights : l.revenue;
        const py = isN ? l.prev_year_nights : l.prev_year_revenue;
        const stly = isN ? l.stly_nights : l.stly_revenue;
        const f = isN ? num : money;
        const lowCov = l.stly_coverage != null && l.stly_coverage < LOW_COVERAGE;
        const pyLive = l.prev_state && l.prev_state !== "actual";
        return (
            <>
                <td style={{ ...td, ...divider, fontWeight: 700 }}>{f(cur)}</td>
                <td
                    style={{ ...td, color: C.muted, fontStyle: pyLive ? "italic" : "normal" }}
                    title={pyLive ? "That month hasn't finished yet, so this is what's on the books for it now, not a final actual" : undefined}
                >
                    {f(py)}
                </td>
                <td style={td}>
                    <PctPill value={ratio(cur, py)} />
                </td>
                <td
                    style={{ ...td, color: C.muted }}
                    title={lowCov ? `Only ${Math.round(l.stly_coverage * 100)}% of last year's nights for this month have a known booking date, so this figure understates the real one` : undefined}
                >
                    {f(stly)}
                    {lowCov ? "*" : ""}
                </td>
                <td style={td}>
                    <PctPill
                        value={ratio(cur, stly)}
                        flagged={lowCov}
                        title={lowCov ? "Low confidence: incomplete booking-date history for last year" : undefined}
                    />
                </td>
            </>
        );
    };

    const changeCells = (l) => (
        <>
            {showN && (
                <td style={{ ...td, ...divider }}>
                    <Delta value={l.change_nights} fmt={num} title={`As at ${shortDate(data.compare_to)}: ${num(l.snapshot_nights)} nights`} />
                </td>
            )}
            {showR && (
                <td style={{ ...td, ...(showN ? {} : divider) }}>
                    <Delta value={l.change_revenue} fmt={money} title={`As at ${shortDate(data.compare_to)}: ${money(l.snapshot_revenue)}`} />
                </td>
            )}
        </>
    );

    const colCount = 1 + (showN ? 5 : 0) + (showR ? 5 : 0) + (showN ? 1 : 0) + (showR ? 1 : 0);

    const yearOptions = [];
    for (let y = 2020; y <= thisYear + 1; y++) yearOptions.push(y);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* ── toolbar ── */}
            <div style={{ ...card, padding: "16px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                    <div>
                        <p style={{ margin: 0, fontFamily: serif, fontSize: 22, fontWeight: 600, color: C.text }}>
                            Summary of Reservations Forecast
                        </p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted }}>
                            {data
                                ? `As at ${longDate(data.as_of)} · ${blocks.map((b) => b.year).join(" & ")} stay months`
                                : "Loading…"}
                        </p>
                    </div>
                    <button type="button" style={buttonStyle} onClick={exportSheet} disabled={!data}>
                        <Download size={13} /> Export sheet
                    </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: C.muted }}>
                        Starting year
                        <select style={selectStyle} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                            {yearOptions.map((y) => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </label>
                    <Toggle
                        value={view}
                        onChange={setView}
                        options={[
                            { value: "both", label: "Nights + Revenue" },
                            { value: "nights", label: "Nights" },
                            { value: "revenue", label: "Revenue" },
                        ]}
                    />
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: C.muted }}>
                        <CalendarClock size={14} />
                        Change since
                        <select style={selectStyle} value={compareMode} onChange={(e) => setCompareMode(e.target.value)}>
                            <option value="month_end">End of last month</option>
                            <option value="7">7 days ago</option>
                            <option value="30">30 days ago</option>
                            <option value="custom">Pick a date…</option>
                        </select>
                        {compareMode === "custom" && (
                            <input
                                type="date"
                                value={customDate}
                                max={new Date().toISOString().slice(0, 10)}
                                onChange={(e) => setCustomDate(e.target.value)}
                                style={selectStyle}
                            />
                        )}
                    </label>
                    {loading && <Loader2 size={16} color={C.muted} className="animate-spin" />}
                </div>
            </div>

            {error && <div style={{ ...card, color: C.truffle, fontSize: 13 }}>{error}</div>}

            {/* ── KPIs ── */}
            {kpis && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 }}>
                    <Kpi
                        icon={BedDouble}
                        accent={C.flame}
                        label="Next 12 months · nights"
                        value={num(kpis.nights)}
                        sub={`${pctText(kpis.nightsVsStly)} vs same time last year`}
                        subColor={pctTone(kpis.nightsVsStly)}
                    />
                    <Kpi
                        icon={DollarSign}
                        accent={C.deep}
                        label="Next 12 months · revenue"
                        value={compact(kpis.revenue)}
                        sub={`${pctText(kpis.revenueVsStly)} vs same time last year`}
                        subColor={pctTone(kpis.revenueVsStly)}
                    />
                    <Kpi
                        icon={TrendingUp}
                        accent={C.good}
                        label={changeLabel}
                        value={`${kpis.pickupNights >= 0 ? "+" : ""}${num(kpis.pickupNights)} nts`}
                        sub={`${kpis.pickupRevenue >= 0 ? "+" : ""}${money(kpis.pickupRevenue)} revenue picked up`}
                        subColor={kpis.pickupRevenue >= 0 ? C.good : C.truffle}
                    />
                </div>
            )}

            {/* ── the sheet ── */}
            {data && (
                <div style={{ ...card, padding: 0, overflow: "hidden" }}>
                    <div style={{ overflow: "auto", maxHeight: "75vh" }}>
                        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                            <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                                <tr>
                                    <th style={{ ...th, ...stickyCol, zIndex: 3, borderBottom: "none" }} />
                                    {showN && (
                                        <th colSpan={5} style={{ ...groupTh(C.flame), ...divider }}>
                                            Nights booked
                                            <InfoTip text="Room nights from every reservation currently on file, counted in the month each night falls in." />
                                        </th>
                                    )}
                                    {showR && (
                                        <th colSpan={5} style={{ ...groupTh(C.deep), ...divider }}>
                                            Gross revenue
                                            <InfoTip text="Nightly room rates for those nights, excluding complimentary stays. Extras, add-ons and taxes are not included." />
                                        </th>
                                    )}
                                    <th colSpan={(showN ? 1 : 0) + (showR ? 1 : 0)} style={{ ...groupTh(C.good), ...divider }}>
                                        {changeLabel}
                                        <InfoTip
                                            align="right"
                                            text={`New bookings added since ${longDate(data.compare_to)}. Hover a figure to see what was on the books on that date.`}
                                        />
                                    </th>
                                </tr>
                                <tr>
                                    <th style={{ ...th, ...stickyCol, zIndex: 3 }}>Stay month</th>
                                    {[showN, showR].map((show, i) =>
                                        show ? (
                                            <Fragment key={i}>
                                                <th style={{ ...th, ...divider }}>On the books</th>
                                                <th style={th}>
                                                    Previous year
                                                    <InfoTip text="The same month one year earlier. Italic figures are for months that hadn't finished yet, so they show what's on the books for them now." />
                                                </th>
                                                <th style={th}>% of previous year</th>
                                                <th style={th}>
                                                    Same time last year
                                                    <InfoTip
                                                        text={`The same month last year, counting only bookings that had been made by ${longDate(data.stly_cutoff)}. A * means some of last year's bookings have no recorded booking date, so the figure is likely low.`}
                                                    />
                                                </th>
                                                <th style={th}>% of same time last year</th>
                                            </Fragment>
                                        ) : null,
                                    )}
                                    {showN && <th style={{ ...th, ...divider }}>Nights</th>}
                                    {showR && <th style={{ ...th, ...(showN ? {} : divider) }}>Revenue</th>}
                                </tr>
                            </thead>
                            {blocks.map((b) => {
                                const t = sumLines(b.months);
                                return (
                                    <tbody key={b.year}>
                                        <tr>
                                            <td
                                                colSpan={colCount}
                                                style={{
                                                    padding: "14px 12px 6px",
                                                    fontFamily: serif,
                                                    fontSize: 19,
                                                    fontWeight: 700,
                                                    color: C.text,
                                                    borderBottom: `1px solid ${C.border}`,
                                                    background: C.bg,
                                                }}
                                            >
                                                <span style={{ position: "sticky", left: 12 }}>{b.year}</span>
                                            </td>
                                        </tr>
                                        {b.months.map((l) => {
                                            const rowBg = l.state === "in_progress"
                                                ? "color-mix(in srgb, #FFB162 8%, var(--dashboard-card))"
                                                : l.state === "actual" ? C.panel : C.bg;
                                            return (
                                                <tr key={l.month} style={{ background: rowBg }}>
                                                    <td style={{ ...td, ...stickyCol, background: rowBg, fontWeight: 700, borderBottom: `1px solid ${C.rowBorder}` }}>
                                                        {MONTHS[l.month - 1]}
                                                        <StateChip state={l.state} />
                                                    </td>
                                                    {showN && metricCells(l, "nights")}
                                                    {showR && metricCells(l, "revenue")}
                                                    {changeCells(l)}
                                                </tr>
                                            );
                                        })}
                                        <tr style={{ background: C.panelAlt }}>
                                            <td style={{ ...td, ...stickyCol, background: C.panelAlt, fontWeight: 800 }}>Total {b.year}</td>
                                            {showN && metricCells({ ...t, stly_coverage: null, prev_state: "actual" }, "nights")}
                                            {showR && metricCells({ ...t, stly_coverage: null, prev_state: "actual" }, "revenue")}
                                            {changeCells(t)}
                                        </tr>
                                    </tbody>
                                );
                            })}
                        </table>
                    </div>
                </div>
            )}

        </div>
    );
}