import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  BedDouble,
  Building2,
  CalendarRange,
  LineChart as LineIcon,
  PieChart as PieIcon,
  Plus,
  Download,
  Pencil,
  ChevronDown,
  ChevronUp,
  Save,
  Search,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { seasonalDemandApi as api } from "../../api/seasonalDemandApi";
import { useAuth } from "../../auth/AuthContext";

/* Styling follows the Forecast tab: same tokens, serif headings, KPI cards
   with a coloured top edge, segmented toggles and underline tabs. */
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
  oat: "#C9C1B1",
  blue: "#5B8FA8",
  good: "#4F7A55",
};
const AX = "#7C7067";
const GRID = "#DDD6CA";
const TIP = {
  background: "#f6f3ed",
  border: "1px solid #DDD6CA",
  borderRadius: 10,
  fontSize: 14,
  color: "#1B2632",
};
const SERIES = [C.deep, C.flame, C.truffle, C.blue, C.good, "#7A5C45"];
const tick = { fill: AX, fontSize: 13 };

const card = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 18,
  padding: 22,
  minWidth: 0,
};
const input = {
  background: C.panel,
  color: C.text,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: "9px 12px",
  fontSize: 14.5,
  fontWeight: 600,
  maxWidth: "100%",
};
const button = {
  ...input,
  cursor: "pointer",
  background: C.panelAlt,
  color: C.accent,
  border: `1px solid ${C.accent2}`,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  fontSize: 14,
  fontWeight: 700,
};
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
// Ten table rows + sticky header; anything beyond scrolls inside the table.
const TEN_ROWS = 10 * 46 + 48;
const number = (n, digits = 0) =>
  Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
const ymd = (year, month, day) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const sum = (rows, key) => rows.reduce((a, r) => a + Number(r[key] || 0), 0);
const daysBetween = (a, b) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
const short = (s, n = 20) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// CSV exports include every filtered row, including rows outside scrollable view.
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
function exportCsv(filename, headers, rows) {
  const content =
    "\uFEFF" +
    [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[^a-z0-9._-]/gi, "_");
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const ExportButton = ({ filename, headers, rows }) => (
  <button
    type="button"
    style={button}
    onClick={() => exportCsv(filename, headers, rows)}
  >
    <Download size={15} /> Export CSV
  </button>
);

/* ── small UI pieces (same look as the Forecast tab) ─────────────────── */
function Kpi({ icon: Icon, label, value, sub, subColor, accent }) {
  return (
    <div style={{ ...card, padding: 18, borderTop: `3px solid ${accent}` }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            fontWeight: 700,
            color: C.muted,
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          {label}
        </p>
        <Icon size={20} color={accent} />
      </div>
      <p
        style={{
          margin: "6px 0 4px",
          fontFamily: serif,
          fontSize: 32,
          fontWeight: 600,
          color: C.text,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </p>
      {sub && (
        <p
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 700,
            color: subColor || C.muted,
          }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
function Panel({ icon: Icon, title, hint, right, children }) {
  return (
    <section style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          {Icon && (
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 11,
                flexShrink: 0,
                background: C.panelAlt,
                display: "grid",
                placeItems: "center",
              }}
            >
              <Icon size={18} color={C.accent2} />
            </div>
          )}
          <div>
            <p
              style={{
                margin: 0,
                fontFamily: serif,
                fontSize: 23,
                fontWeight: 600,
                color: C.text,
              }}
            >
              {title}
            </p>
            {hint && (
              <p
                style={{
                  margin: "3px 0 0",
                  fontSize: 14,
                  color: C.muted,
                  maxWidth: 640,
                  lineHeight: 1.45,
                }}
              >
                {hint}
              </p>
            )}
          </div>
        </div>
        {right}
      </div>
      {children}
    </section>
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
              padding: "8px 15px",
              fontSize: 14,
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
function Empty({ children }) {
  return (
    <p
      style={{
        color: C.muted,
        fontSize: 15,
        margin: 0,
        padding: "24px 0",
        textAlign: "center",
      }}
    >
      {children || "Nothing recorded for this selection."}
    </p>
  );
}
function Chart({ height = 300, children }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer>{children}</ResponsiveContainer>
    </div>
  );
}
function DataTable({
  headers,
  rows,
  empty = "Nothing recorded for this selection.",
  maxHeight,
  exportName,
  exportRows,
}) {
  return (
    <>
      {exportName && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 10,
          }}
        >
          <ExportButton
            filename={exportName}
            headers={headers.filter(Boolean)}
            rows={exportRows || rows}
          />
        </div>
      )}
      <div style={{ overflow: "auto", ...(maxHeight ? { maxHeight } : {}) }}>
        <table
          style={{ borderCollapse: "collapse", width: "100%", fontSize: 14.5 }}
        >
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th
                  key={`${h}-${i}`}
                  style={{
                    textAlign: "left",
                    padding: "11px 12px",
                    borderBottom: `1px solid ${C.border}`,
                    whiteSpace: "nowrap",
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    background: C.bg,
                    fontSize: 12.5,
                    fontWeight: 800,
                    color: C.muted,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td
                      key={j}
                      style={{
                        padding: "11px 12px",
                        borderBottom: `1px solid ${C.rowBorder}`,
                      }}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={headers.length}
                  style={{ padding: 18, color: C.muted }}
                >
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
// One coloured line per name, followed across the months/seasons.
function Lines({ data, names, height = 320 }) {
  return (
    <Chart height={height}>
      <LineChart data={data} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={48} />
        <Tooltip contentStyle={TIP} formatter={(v) => number(v)} />
        <Legend wrapperStyle={{ fontSize: 14 }} />
        {names.map((n, i) => (
          <Line
            key={n}
            type="monotone"
            name={n}
            dataKey={(d) => d[n]}
            stroke={SERIES[i % SERIES.length]}
            strokeWidth={3}
            dot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </Chart>
  );
}
// Horizontal bars, biggest first: the "who did best" chart.
function RankBars({
  data,
  color = C.deep,
  label = "Nights booked",
  height = 360,
}) {
  if (!data.length) return <Empty />;
  return (
    <Chart height={height}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ left: 6, right: 24, top: 4, bottom: 0 }}
      >
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={tick} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={170}
          tick={{ ...tick, fill: "#1B2632" }}
          tickFormatter={(v) => short(v, 22)}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={TIP} formatter={(v) => number(v)} />
        <Bar dataKey="value" name={label} fill={color} radius={[0, 8, 8, 0]} />
      </BarChart>
    </Chart>
  );
}

function aggregate(rows, field, kind) {
  const map = new Map();
  rows.forEach((r) => {
    const name =
      kind === "bedroom"
        ? r.bedroom_count == null
          ? "Unknown bedrooms"
          : `${r.bedroom_count}-bedroom`
        : String(r[field] || "Unknown");
    const current = map.get(name) || {
      name,
      nights: 0,
      bookings: 0,
      usage_count: 0,
      members: 0,
      villas: new Set(),
    };
    current.nights += Number(r.nights || 0);
    current.bookings += Number(r.bookings || 0);
    current.usage_count += Number(r.usage_count || 0);
    // Member counts are per grouped row, so they can overlap across payment types.
    current.members += Number(r.unique_members || 0);
    if (r.villa_name) current.villas.add(r.villa_name);
    map.set(name, current);
  });
  return [...map.values()].sort(
    (a, b) =>
      (kind === "amenity"
        ? b.usage_count - a.usage_count
        : b.nights - a.nights) || a.name.localeCompare(b.name),
  );
}
const cellMap = (rows, nameOf, key) => {
  const m = new Map();
  rows.forEach((r) => {
    const k = `${nameOf(r)}|${r.period_id}`;
    m.set(k, (m.get(k) || 0) + Number(r[key] || 0));
  });
  return m;
};
const bedroomName = (r) =>
  r.bedroom_count == null ? "Unknown bedrooms" : `${r.bedroom_count}-bedroom`;

/* ── Season calendar helpers ─────────────────────────────────────────── */
const emptyRow = (season_name) => ({
  season_name,
  start_date: "",
  end_date: "",
});
// A new calendar starts with one row per season name; the person only types dates.
const blank = (year, names = []) => ({
  calendar_name: `My ${year} Seasons`,
  calendar_year: year,
  periods: names.map(emptyRow),
});
const isBlankRow = (p) => !p.start_date && !p.end_date;
// Rows with no dates are simply "not used" and are left out when saving.
const filledOnly = (d) => ({
  ...d,
  periods: d.periods.filter((p) => !isBlankRow(p)),
});
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validateDraft(draft) {
  if (!draft.calendar_name.trim()) return "Enter a calendar name.";
  const periods = filledOnly(draft).periods;
  for (const p of periods) {
    if (!p.season_name?.trim()) return "Give every season a name.";
    if (!DATE_RE.test(p.start_date) || !DATE_RE.test(p.end_date))
      return `${p.season_name}: fill in both a start and an end date.`;
    if (p.end_date < p.start_date)
      return `${p.season_name}: the end date is before the start date.`;
    if (Number(p.start_date.slice(0, 4)) !== Number(draft.calendar_year))
      return `${p.season_name}: must start in ${draft.calendar_year}.`;
  }
  const sorted = [...periods].sort((a, b) =>
    a.start_date.localeCompare(b.start_date),
  );
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i - 1].end_date >= sorted[i].start_date)
      return `${sorted[i - 1].season_name} overlaps ${sorted[i].season_name}.`;
  return "";
}
const plain = (c) =>
  JSON.stringify({
    n: c.calendar_name,
    y: Number(c.calendar_year),
    p: c.periods.map((p) => [p.season_name, p.start_date, p.end_date]),
  });
const emptyData = { stay: [], amenity: [], summary: [] };

export default function SeasonalDemandPanel() {
  const { canEdit } = useAuth();
  const editable = canEdit("ml");
  const [view, setView] = useState("month");
  const [section, setSection] = useState("overview");
  const [year, setYear] = useState(new Date().getFullYear());
  const [years, setYears] = useState([]);
  const [compareYear, setCompareYear] = useState("");
  const [pick, setPick] = useState(1); // which month/season (1-based) the tabs focus on
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [payment, setPayment] = useState("all");
  const [calendars, setCalendars] = useState([]);
  const [selected, setSelected] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState(null);
  const [names, setNames] = useState([]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarEditing, setCalendarEditing] = useState(false);
  const [data, setData] = useState(emptyData);
  const [comparisonData, setComparisonData] = useState(emptyData);
  const [status, setStatus] = useState(null);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [suggestedNames, setSuggestedNames] = useState([]);

  const refreshConfig = useCallback(async (preferred) => {
    const [config, items] = await Promise.all([api.config(), api.calendars()]);
    setNames(config.names || []);
    setSuggestedNames([
      ...new Set([
        ...(config.names || []),
        ...items.flatMap((c) => (c.periods || []).map((p) => p.season_name)),
      ]),
    ]);
    setCalendars(items);
    setSelected((old) => {
      const next = preferred === undefined ? old : preferred;
      return items.some((x) => String(x.id) === String(next))
        ? String(next)
        : "";
    });
  }, []);
  useEffect(() => {
    Promise.all([refreshConfig(), api.availableYears(), api.status()])
      .then(([, available, st]) => {
        setYears(available.years || []);
        if (available.years?.length) {
          setYear(available.years[0]);
          setCompareYear(
            available.years.find((y) => y !== available.years[0]) || "",
          );
        }
        setStatus(st);
      })
      .catch((e) => setError(e.message));
  }, [refreshConfig]);

  const savedItem = calendars.find((c) => String(c.id) === String(selected));
  useEffect(() => {
    setDraft((prev) =>
      savedItem
        ? {
            calendar_name: savedItem.calendar_name,
            calendar_year: savedItem.calendar_year,
            periods: savedItem.periods.map(
              ({ season_name, start_date, end_date }) => ({
                season_name,
                start_date,
                end_date,
              }),
            ),
          }
        : isNew
          ? prev
          : null,
    );
  }, [savedItem, isNew]);

  const filter = useMemo(
    () => ({
      start_date: start && start > ymd(year, 1, 1) ? start : ymd(year, 1, 1),
      end_date: end && end < ymd(year, 12, 31) ? end : ymd(year, 12, 31),
    }),
    [start, end, year],
  );
  const reload = useCallback(async () => {
    if (view === "season" && !selected) {
      setData(emptyData);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result =
        view === "month"
          ? await api.months(filter)
          : await api.seasons(selected, { start_date: start, end_date: end });
      setData({ ...emptyData, ...result });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selected, filter, start, end, reloadKey]);
  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    if (
      view !== "month" ||
      !compareYear ||
      Number(compareYear) === Number(year)
    ) {
      setComparisonData(emptyData);
      return;
    }
    const y = Number(compareYear);
    const from = start ? `${y}${start.slice(4)}` : ymd(y, 1, 1);
    const to = end ? `${y}${end.slice(4)}` : ymd(y, 12, 31);
    api
      .months({ start_date: from, end_date: to })
      .then((r) => setComparisonData({ ...emptyData, ...r }))
      .catch((e) => setError(e.message));
  }, [view, year, compareYear, start, end]);

  const action = async (fn, message) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const persist = useCallback(async () => {
    const err = validateDraft(draft);
    if (err) throw Error(err);
    const payload = filledOnly(draft);
    if (!selected && !payload.periods.length)
      throw Error("Fill in the dates for at least one season.");
    await api.preview(payload);
    const saved = selected
      ? await api.saveCalendar(selected, payload)
      : await api.createCalendar(payload);
    const newNames = [
      ...new Set([
        ...names,
        ...payload.periods.map((p) => p.season_name.trim()),
      ]),
    ];
    if (newNames.length !== names.length) await api.saveNames(newNames);
    await refreshConfig(String(saved.id));
    setIsNew(false);
    setCalendarEditing(false);
    setCalendarOpen(false);
    setReloadKey((k) => k + 1);
  }, [draft, selected, refreshConfig, names]);
  const save = () => action(persist, "Calendar saved.");

  const dirty = !!(
    draft &&
    savedItem &&
    plain(filledOnly(draft)) !== plain(savedItem)
  );
  const draftError = draft ? validateDraft(draft) : "";
  const cancelCalendarEdit = () => {
    if (isNew) {
      setIsNew(false);
      setDraft(null);
      setSelected("");
    } else if (savedItem)
      setDraft({
        calendar_name: savedItem.calendar_name,
        calendar_year: savedItem.calendar_year,
        periods: savedItem.periods.map(
          ({ season_name, start_date, end_date }) => ({
            season_name,
            start_date,
            end_date,
          }),
        ),
      });
    setCalendarEditing(false);
    setCalendarOpen(false);
  };

  const periodRows = (kind) =>
    (kind === "amenity" ? data.amenity : data.stay).filter(
      (r) => payment === "all" || r.payment_type === payment,
    );
  const stay = periodRows("stay");
  const amenity = periodRows("amenity");

  const periodIds = useMemo(() => {
    if (view === "month")
      return months.map((name, i) => ({
        id: `${year}-${String(i + 1).padStart(2, "0")}`,
        label: name,
        month: i + 1,
        startDate: ymd(year, i + 1, 1),
        endDate: ymd(year, i + 1, new Date(year, i + 1, 0).getDate()),
      }));
    const ps = savedItem?.periods || [];
    const count = {};
    ps.forEach((p) => (count[p.season_name] = (count[p.season_name] || 0) + 1));
    return ps.map((p, i) => ({
      id: String(p.id),
      label:
        count[p.season_name] > 1
          ? `${p.season_name} · ${String(p.start_date).slice(5)}`
          : p.season_name,
      month: i + 1,
      startDate: String(p.start_date),
      endDate: String(p.end_date),
    }));
  }, [view, year, savedItem]);
  const trend = (rows, key) =>
    periodIds.map((p) => ({
      ...p,
      value: sum(
        rows.filter((r) => String(r.period_id) === p.id),
        key,
      ),
    }));
  const villaTrend = trend(stay, "nights");
  const amenityTrend = trend(amenity, "usage_count");
  const distinctBookings =
    payment === "all" ? sum(data.summary || [], "distinct_bookings") : null;
  const scope = view === "month" ? "month" : "season";

  /* Busy-vs-quiet: average villa nights booked per day in each period.
     Seasons are different lengths and unfinished periods only hold what is
     booked so far, so only finished periods set the "usual day". */
  const todayIso = new Date().toISOString().slice(0, 10);
  const dayRows = villaTrend.map((p) => {
    const s = start && start > p.startDate ? start : p.startDate;
    const e = end && end < p.endDate ? end : p.endDate;
    const days = Math.max(0, daysBetween(s, e));
    return {
      ...p,
      days,
      perDay: days ? Math.round((p.value / days) * 10) / 10 : 0,
      done: days > 0 && e < todayIso,
    };
  });
  const doneRows = dayRows.filter((r) => r.done);
  const doneDays = sum(doneRows, "days");
  const usualDay = doneDays ? sum(doneRows, "value") / doneDays : 0;
  const rankedDone = doneRows
    .filter((r) => r.value > 0)
    .sort((a, b) => b.perDay - a.perDay);
  const busiest = rankedDone[0];
  const quietest = rankedDone[rankedDone.length - 1];
  const barColor = (r) =>
    !r.done
      ? C.oat
      : r.perDay >= usualDay * 1.15
        ? C.deep
        : r.perDay <= usualDay * 0.85
          ? C.flame
          : C.blue;

  const currentId = periodIds[pick - 1]?.id;
  const periodLabel = periodIds[pick - 1]?.label || `this ${scope}`;
  const scopedStay = stay.filter((r) => String(r.period_id) === currentId);
  const scopedAmenity = amenity.filter(
    (r) => String(r.period_id) === currentId,
  );
  const villas = aggregate(scopedStay, "villa_name", "villa");
  const bedrooms = aggregate(scopedStay, "bedroom_count", "bedroom");
  const amenities = aggregate(scopedAmenity, "amenity", "amenity");
  const match = (r) => r.name.toLowerCase().includes(search.toLowerCase());
  const allBedrooms = aggregate(stay, "bedroom_count", "bedroom");

  const seriesByPeriod = (rows, nameOf, key, nameList) => {
    const m = cellMap(rows, nameOf, key);
    return periodIds.map((p) => ({
      label: p.label,
      ...Object.fromEntries(
        nameList.map((n) => [n, m.get(`${n}|${p.id}`) || 0]),
      ),
    }));
  };
  const bedroomLineNames = allBedrooms.slice(0, 5).map((b) => b.name);
  const bedroomLines = seriesByPeriod(
    stay,
    bedroomName,
    "nights",
    bedroomLineNames,
  );
  const villaLineNames = villas.slice(0, 5).map((v) => v.name);
  const villaLines = seriesByPeriod(
    stay,
    (r) => String(r.villa_name || "Unknown"),
    "nights",
    villaLineNames,
  );
  const amenityLineNames = amenities.slice(0, 4).map((a) => a.name);
  const amenityLines = seriesByPeriod(
    amenity,
    (r) => String(r.amenity || "Unknown"),
    "usage_count",
    amenityLineNames,
  );
  const detailLine = periodIds.map((p) => ({
    label: p.label,
    [detail]: sum(
      stay.filter(
        (r) => r.villa_name === detail && String(r.period_id) === p.id,
      ),
      "nights",
    ),
  }));

  const yoyData = months.map((label, i) => {
    const m = i + 1;
    const current = sum(
      stay.filter((r) => r.period_month === m),
      "nights",
    );
    const previous = sum(
      comparisonData.stay.filter(
        (r) =>
          r.period_month === m &&
          (payment === "all" || r.payment_type === payment),
      ),
      "nights",
    );
    return {
      label,
      current,
      previous,
      difference: current - previous,
      pct: previous ? ((current - previous) / previous) * 100 : null,
    };
  });

  const showData = view === "month" || !!selected;
  const tabs = [
    ["overview", "Overview"],
    ["villa", "Villas"],
    ["bedroom", "Bedrooms"],
    ["amenity", "Amenities"],
  ];
  const totalNights = sum(stay, "nights");

  /* ── Season calendar: only shown under "By Season" ── */
  const setPeriod = (i, patch) =>
    setDraft((d) => ({
      ...d,
      periods: d.periods.map((v, j) => (j === i ? { ...v, ...patch } : v)),
    }));
  const calendarSection = (
    <div
      role={isNew ? "dialog" : undefined}
      aria-modal={isNew ? true : undefined}
      aria-label={isNew ? "Create new season calendar" : undefined}
      style={
        isNew
          ? {
              position: "fixed",
              inset: 0,
              zIndex: 1100,
              background: "rgba(12, 22, 34, 0.62)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }
          : {}
      }
    >
      <div
        style={
          isNew
            ? {
                width: "min(1100px, 100%)",
                maxHeight: "calc(100vh - 40px)",
                overflowY: "auto",
                borderRadius: 18,
                boxShadow: "0 24px 70px rgba(0,0,0,.3)",
              }
            : {}
        }
      >
        <Panel
          icon={CalendarRange}
          title="Season calendar"
          hint="Select a calendar to view it. Click Edit to change seasons and dates; nothing saves until you choose Save changes."
          right={
            !isNew && (
              <button
                type="button"
                style={button}
                onClick={() => setCalendarOpen((v) => !v)}
              >
                {calendarOpen ? (
                  <ChevronUp size={15} />
                ) : (
                  <ChevronDown size={15} />
                )}
                {calendarOpen ? "Collapse" : "Expand"}
              </button>
            )
          }
        >
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {!isNew && (
              <select
                style={input}
                value={selected}
                onChange={(e) => {
                  setIsNew(false);
                  setCalendarEditing(false);
                  setCalendarOpen(false);
                  setConfirmDelete(false);
                  setSelected(e.target.value);
                  setPick(1);
                }}
              >
                <option value="">
                  {isNew ? "New calendar (not saved yet)" : "Select a calendar"}
                </option>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.calendar_name} ({c.calendar_year})
                  </option>
                ))}
              </select>
            )}
            {editable && (
              <>
                {!isNew && (
                  <button
                    type="button"
                    style={button}
                    onClick={() => {
                      setSelected("");
                      setConfirmDelete(false);
                      setIsNew(true);
                      setDraft(blank(year, names));
                      setCalendarEditing(true);
                      setCalendarOpen(true);
                    }}
                  >
                    <Plus size={15} /> New calendar
                  </button>
                )}
                {selected && !calendarEditing && (
                  <button
                    type="button"
                    style={button}
                    onClick={() => {
                      setCalendarEditing(true);
                      setCalendarOpen(true);
                    }}
                  >
                    <Pencil size={15} /> Edit
                  </button>
                )}
                {selected && !confirmDelete && !calendarEditing && (
                  <button
                    type="button"
                    style={button}
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={15} /> Delete calendar
                  </button>
                )}
                {selected && confirmDelete && (
                  <span
                    style={{
                      display: "inline-flex",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    Delete “{savedItem?.calendar_name}”?
                    <button
                      type="button"
                      style={button}
                      disabled={busy}
                      onClick={() =>
                        action(async () => {
                          await api.deleteCalendar(selected);
                          setConfirmDelete(false);
                          await refreshConfig("");
                          setCalendarOpen(false);
                          setCalendarEditing(false);
                        }, "Calendar deleted.")
                      }
                    >
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      style={button}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </button>
                  </span>
                )}
              </>
            )}
          </div>
          {calendarOpen && draft && (
            <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <label>
                  Calendar name{" "}
                  <input
                    style={input}
                    disabled={!calendarEditing}
                    value={draft.calendar_name}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, calendar_name: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Year{" "}
                  <input
                    style={{ ...input, width: 110 }}
                    type="number"
                    disabled={!calendarEditing}
                    value={draft.calendar_year}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        calendar_year: Number(e.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              <DataTable
                headers={[
                  "Season",
                  "Starts",
                  "Ends",
                  "Villa nights",
                  "Amenity charges",
                  "",
                ]}
                empty="No seasons yet. Click Add season to create the first row."
                rows={draft.periods.map((p, i) => {
                  const idx = savedItem
                    ? savedItem.periods.findIndex(
                        (s) =>
                          s.season_name === p.season_name &&
                          String(s.start_date) === p.start_date &&
                          String(s.end_date) === p.end_date,
                      )
                    : -1;
                  const live = !dirty && !isNew && idx >= 0;
                  return [
                    calendarEditing ? (
                      <input
                        style={{ ...input, minWidth: 140 }}
                        list="season-name-suggestions"
                        placeholder="Choose or type season name"
                        value={p.season_name}
                        onChange={(e) => {
                          const name = e.target.value;
                          setDraft((d) => ({
                            ...d,
                            periods: d.periods.map((v, j) =>
                              j === i ? { ...v, season_name: name } : v,
                            ),
                          }));
                        }}
                      />
                    ) : (
                      <strong>{p.season_name}</strong>
                    ),
                    <input
                      type="date"
                      style={input}
                      disabled={!calendarEditing}
                      value={p.start_date}
                      onChange={(e) =>
                        setPeriod(i, { start_date: e.target.value })
                      }
                    />,
                    <input
                      type="date"
                      style={input}
                      disabled={!calendarEditing}
                      value={p.end_date}
                      onChange={(e) =>
                        setPeriod(i, { end_date: e.target.value })
                      }
                    />,
                    live ? number(villaTrend[idx]?.value) : "—",
                    live ? number(amenityTrend[idx]?.value) : "—",
                    calendarEditing ? (
                      <button
                        type="button"
                        style={button}
                        title="Remove season"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            periods: d.periods.filter((_, j) => j !== i),
                          }))
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    ) : (
                      ""
                    ),
                  ];
                })}
              />
              <datalist id="season-name-suggestions">
                {suggestedNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              {calendarEditing && (
                <>
                  <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
                    Predefined season names appear automatically in new
                    calendars. You can rename them directly in the table or add
                    your own. Start and end dates are left blank for you to
                    enter manually.
                  </p>
                  {draftError && (
                    <p style={{ color: C.truffle, margin: 0 }}>{draftError}</p>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={button}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          periods: [...d.periods, emptyRow("")],
                        }))
                      }
                    >
                      <Plus size={15} /> Add season
                    </button>
                    <button
                      type="button"
                      style={button}
                      disabled={
                        busy ||
                        !!draftError ||
                        (!isNew && !dirty) ||
                        !filledOnly(draft).periods.length
                      }
                      onClick={save}
                    >
                      <Save size={15} />{" "}
                      {isNew ? "Create calendar" : "Save changes"}
                    </button>
                    <button
                      type="button"
                      style={button}
                      disabled={busy}
                      onClick={cancelCalendarEdit}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {!draft && (
            <p style={{ color: C.muted, marginBottom: 0 }}>
              Select a calendar or create a new one.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );

  /* period picker shared by the Villas / Bedrooms / Amenities tabs */
  const periodBar = (
    <div
      style={{
        ...card,
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16,
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 14.5,
          fontWeight: 700,
          color: C.muted,
        }}
      >
        Show me this {scope}
        <select
          style={input}
          value={pick}
          onChange={(e) => {
            setPick(Number(e.target.value));
            setDetail("");
          }}
        >
          {periodIds.map((p, i) => (
            <option key={p.id} value={i + 1}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Search size={17} color={C.muted} />
        <input
          style={input}
          placeholder="Search the list"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
    </div>
  );
  const kpiGrid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 14,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        color: C.text,
      }}
    >
      <div
        style={{
          ...card,
          padding: "18px 22px",
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontFamily: serif,
              fontSize: 28,
              fontWeight: 600,
            }}
          >
            Seasonal Demand
          </p>
          <p
            style={{
              margin: "3px 0 0",
              fontSize: 14.5,
              color: C.muted,
              maxWidth: 620,
              lineHeight: 1.45,
            }}
          >
            When guests book the most and the least through the year, and which
            villas, bedroom sizes and amenities are in demand. This looks back
            at what already happened; it is not a forecast.
          </p>
        </div>
        <Toggle
          value={view}
          onChange={(v) => {
            setView(v);
            setPick(1);
            setDetail("");
          }}
          options={[
            { value: "month", label: "By Month" },
            { value: "season", label: "By Season" },
          ]}
        />
      </div>

      {view === "season" && calendarSection}

      <div
        style={{
          ...card,
          padding: "16px 20px",
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {view === "month" && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14.5,
              fontWeight: 700,
              color: C.muted,
            }}
          >
            Year
            <select
              style={input}
              value={year}
              onChange={(e) => {
                setYear(Number(e.target.value));
                setStart("");
                setEnd("");
              }}
            >
              {[...new Set([year, ...years])]
                .sort((a, b) => b - a)
                .map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 14.5,
            fontWeight: 700,
            color: C.muted,
          }}
        >
          From
          <input
            style={input}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 14.5,
            fontWeight: 700,
            color: C.muted,
          }}
        >
          To
          <input
            style={input}
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button
          type="button"
          style={button}
          onClick={() => {
            setStart("");
            setEnd("");
          }}
        >
          Clear dates
        </button>
        <Toggle
          value={payment}
          onChange={setPayment}
          options={[
            { value: "all", label: "All stays" },
            { value: "Paid", label: "Paid" },
            { value: "Free", label: "Free / comp" },
          ]}
        />
      </div>

      <div
        role="tablist"
        style={{
          display: "flex",
          gap: 4,
          borderBottom: `1px solid ${C.border}`,
          flexWrap: "wrap",
        }}
      >
        {tabs.map(([id, label]) => {
          const active = id === section;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSection(id)}
              style={{
                padding: "10px 18px",
                marginBottom: -1,
                border: "none",
                borderBottom: `3px solid ${active ? C.flame : "transparent"}`,
                background: "transparent",
                color: active ? C.text : C.muted,
                fontFamily: serif,
                fontSize: 21,
                fontWeight: active ? 700 : 600,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {error && (
        <div role="alert" style={{ ...card, color: C.truffle, fontSize: 15 }}>
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          style={{ color: C.muted, fontSize: 14.5, fontWeight: 600 }}
        >
          {notice}
        </div>
      )}
      {status &&
        !status.booked_night_rows &&
        !status.amenity_transaction_rows && (
          <div role="alert" style={{ ...card, fontSize: 15 }}>
            No demand data is loaded yet. Run{" "}
            <code>python machinelearning/seas_demand_specific.py</code> after
            refreshing the Overview views. An empty page here does not mean
            there was no demand.
          </div>
        )}

      {!showData ? null : loading ? (
        <div style={{ ...card, fontSize: 15, color: C.muted }}>Loading…</div>
      ) : (
        <>
          {/* ───────── OVERVIEW ───────── */}
          {section === "overview" && (
            <>
              <div style={kpiGrid}>
                <Kpi
                  icon={BedDouble}
                  accent={C.flame}
                  label="Villa nights booked"
                  value={number(totalNights)}
                  sub={
                    distinctBookings === null
                      ? "for the stays you picked"
                      : `from ${number(distinctBookings)} bookings`
                  }
                />
                <Kpi
                  icon={Sparkles}
                  accent={C.deep}
                  label="Amenity charges"
                  value={number(sum(amenity, "usage_count"))}
                  sub="golf, spa, dining and more"
                />
                <Kpi
                  icon={TrendingUp}
                  accent={C.good}
                  label={`Busiest ${scope}`}
                  value={busiest ? busiest.label : "—"}
                  sub={
                    busiest
                      ? `${number(busiest.perDay, 1)} nights booked a day`
                      : "needs a finished period"
                  }
                  subColor={busiest ? C.good : undefined}
                />
                <Kpi
                  icon={TrendingDown}
                  accent={C.truffle}
                  label={`Quietest ${scope}`}
                  value={quietest ? quietest.label : "—"}
                  sub={
                    quietest
                      ? `${number(quietest.perDay, 1)} nights booked a day`
                      : "needs a finished period"
                  }
                  subColor={quietest ? C.truffle : undefined}
                />
              </div>

              <Panel
                icon={BarChart3}
                title={`Busy and quiet ${scope}s`}
                hint={`How many villa nights were booked on an average day in each ${scope}. Bars above the dotted line were busier than usual and bars below it were quieter. Click a bar to see which villas did well.`}
              >
                {usualDay ? (
                  <>
                    <Chart height={320}>
                      <BarChart
                        data={dayRows}
                        margin={{ top: 8, right: 14, left: 0, bottom: 0 }}
                        onClick={(e) => {
                          const p = e?.activePayload?.[0]?.payload;
                          if (p?.month) {
                            setPick(p.month);
                            setSection("villa");
                          }
                        }}
                      >
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={tick}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={tick}
                          axisLine={false}
                          tickLine={false}
                          width={48}
                        />
                        <ReferenceLine
                          y={usualDay}
                          stroke={AX}
                          strokeDasharray="6 4"
                          label={{
                            value: "usual day",
                            fontSize: 13,
                            fill: AX,
                            position: "insideTopRight",
                          }}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const r = payload[0].payload;
                            return (
                              <div style={{ ...TIP, padding: "10px 12px" }}>
                                <strong>{r.label}</strong>
                                <div>
                                  {number(r.perDay, 1)} nights booked a day
                                </div>
                                <div>
                                  {number(r.value)} nights over {r.days} days
                                </div>
                                {!r.done && (
                                  <div style={{ color: C.muted }}>
                                    Still being booked, so not counted in the
                                    usual day
                                  </div>
                                )}
                              </div>
                            );
                          }}
                        />
                        <Bar
                          dataKey="perDay"
                          name="Nights a day"
                          radius={[8, 8, 0, 0]}
                        >
                          {dayRows.map((r, i) => (
                            <Cell key={i} fill={barColor(r)} />
                          ))}
                        </Bar>
                      </BarChart>
                    </Chart>
                    <div
                      style={{
                        display: "flex",
                        gap: 20,
                        flexWrap: "wrap",
                        fontSize: 14,
                        color: C.muted,
                        marginTop: 8,
                      }}
                    >
                      {[
                        ["Busier than usual", C.deep],
                        ["About usual", C.blue],
                        ["Quieter than usual", C.flame],
                        ["Still being booked", C.oat],
                      ].map(([t, c]) => (
                        <span
                          key={t}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 7,
                          }}
                        >
                          <span
                            style={{
                              width: 13,
                              height: 13,
                              borderRadius: 4,
                              background: c,
                            }}
                          />
                          {t}
                        </span>
                      ))}
                      <span>
                        Usual day: {number(usualDay, 1)} nights booked
                      </span>
                    </div>
                  </>
                ) : (
                  <Empty>
                    Once at least one {scope} has finished with bookings, it
                    will show here.
                  </Empty>
                )}
              </Panel>

              <Panel
                icon={LineIcon}
                title="Which bedroom sizes are in demand, and when"
                hint={`Each line is a bedroom size. Where a line climbs, guests booked more nights of that size in that ${scope}.`}
              >
                {bedroomLineNames.length ? (
                  <Lines data={bedroomLines} names={bedroomLineNames} />
                ) : (
                  <Empty />
                )}
              </Panel>

              {view === "month" && (
                <Panel
                  icon={LineIcon}
                  title={`${year} compared with ${compareYear || "another year"}`}
                  hint="Villa nights booked each month this year against the same month in the year you compare with."
                  right={
                    <select
                      style={input}
                      value={compareYear}
                      onChange={(e) => setCompareYear(e.target.value)}
                    >
                      <option value="">No comparison</option>
                      {years
                        .filter((y) => Number(y) !== Number(year))
                        .map((y) => (
                          <option key={y} value={y}>
                            Compare with {y}
                          </option>
                        ))}
                    </select>
                  }
                >
                  {compareYear ? (
                    <>
                      <Lines
                        height={300}
                        names={[String(year), String(compareYear)]}
                        data={yoyData.map((r) => ({
                          label: r.label,
                          [String(year)]: r.current,
                          [String(compareYear)]: r.previous,
                        }))}
                      />
                      <div style={{ marginTop: 14 }}>
                        <DataTable
                          exportName={`year_comparison_${year}_vs_${compareYear}.csv`}
                          exportRows={yoyData.map((r) => [
                            r.label,
                            r.current,
                            r.previous,
                            r.difference,
                            r.pct == null ? "" : r.pct.toFixed(1) + "%",
                          ])}
                          headers={[
                            "Month",
                            `${year}`,
                            `${compareYear}`,
                            "Difference",
                            "Change",
                          ]}
                          rows={yoyData.map((r) => [
                            r.label,
                            number(r.current),
                            number(r.previous),
                            `${r.difference > 0 ? "+" : ""}${number(r.difference)}`,
                            r.pct === null
                              ? "—"
                              : `${r.pct > 0 ? "+" : ""}${number(r.pct, 1)}%`,
                          ])}
                        />
                      </div>
                      <div style={{ marginTop: 22 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 10,
                          }}
                        >
                          <p
                            style={{
                              fontFamily: serif,
                              fontSize: 22,
                              fontWeight: 600,
                              marginBottom: 8,
                            }}
                          >
                            All villas — {periodIds[pick - 1]?.label || "Jan"} (
                            {year} vs {compareYear})
                          </p>
                          <select
                            style={input}
                            value={pick}
                            onChange={(e) => setPick(Number(e.target.value))}
                          >
                            {months.map((m, i) => (
                              <option key={m} value={i + 1}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </div>
                        {(() => {
                          const month = pick;
                          const currentRows = aggregate(
                            stay.filter((r) => r.period_month === month),
                            "villa_name",
                            "villa",
                          );
                          const previousRows = aggregate(
                            comparisonData.stay.filter(
                              (r) =>
                                r.period_month === month &&
                                (payment === "all" ||
                                  r.payment_type === payment),
                            ),
                            "villa_name",
                            "villa",
                          );
                          const currentMap = new Map(
                            currentRows.map((v) => [v.name, v.nights]),
                          );
                          const previousMap = new Map(
                            previousRows.map((v) => [v.name, v.nights]),
                          );
                          const names = [
                            ...new Set([
                              ...currentMap.keys(),
                              ...previousMap.keys(),
                            ]),
                          ].sort();
                          const rows = names.map((name) => {
                            const a = currentMap.get(name) || 0,
                              b = previousMap.get(name) || 0;
                            return [
                              name,
                              a,
                              b,
                              a - b,
                              b ? `${(((a - b) / b) * 100).toFixed(1)}%` : "—",
                            ];
                          });
                          return (
                            <DataTable
                              maxHeight={TEN_ROWS}
                              exportName={`villa_comparison_${periodIds[pick - 1]?.label}_${year}_vs_${compareYear}.csv`}
                              headers={[
                                "Villa",
                                `${year} nights`,
                                `${compareYear} nights`,
                                "Difference",
                                "Change",
                              ]}
                              rows={rows}
                            />
                          );
                        })()}
                      </div>
                    </>
                  ) : (
                    <Empty>Choose a year to compare with.</Empty>
                  )}
                </Panel>
              )}
              <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
                A booking that spans two {scope}s is counted in both.
              </p>
            </>
          )}

          {/* ───────── VILLAS ───────── */}
          {section === "villa" && (
            <>
              {periodBar}
              <div style={kpiGrid}>
                <Kpi
                  icon={Trophy}
                  accent={C.flame}
                  label="Most booked villa"
                  value={villas[0]?.name || "—"}
                  sub={
                    villas[0]
                      ? `${number(villas[0].nights)} nights in ${periodLabel}`
                      : undefined
                  }
                />
                <Kpi
                  icon={Building2}
                  accent={C.deep}
                  label="Villas booked"
                  value={number(villas.length)}
                  sub={`in ${periodLabel}`}
                />
                <Kpi
                  icon={BedDouble}
                  accent={C.truffle}
                  label="Nights booked"
                  value={number(sum(villas, "nights"))}
                  sub={
                    villas.length
                      ? `about ${number(sum(villas, "nights") / villas.length, 1)} per villa`
                      : undefined
                  }
                />
                <Kpi
                  icon={PieIcon}
                  accent={C.good}
                  label="Top 10 villas"
                  value={
                    sum(villas, "nights")
                      ? `${number((sum(villas.slice(0, 10), "nights") / sum(villas, "nights")) * 100)}%`
                      : "—"
                  }
                  sub="of all nights booked"
                />
              </div>
              <Panel
                icon={BarChart3}
                title={`Top 10 villas in ${periodLabel}`}
                hint={`The ten villas guests booked the most nights in ${periodLabel}. The longest bar did best.`}
              >
                <RankBars
                  data={villas
                    .filter(match)
                    .slice(0, 10)
                    .map((v) => ({ name: v.name, value: v.nights }))}
                />
              </Panel>
              <Panel
                icon={LineIcon}
                title="Are the top villas busy all year?"
                hint={`Each line follows one of ${periodLabel}'s top villas through the year, so you can see if it is busy all the time or only now.`}
              >
                {villaLineNames.length ? (
                  <Lines data={villaLines} names={villaLineNames} />
                ) : (
                  <Empty />
                )}
              </Panel>
              <Panel
                title={`All villas in ${periodLabel}`}
                hint="Every villa from most to least booked. Click a villa name to see it month by month. Ten show at a time; scroll for the rest."
              >
                <DataTable
                  maxHeight={TEN_ROWS}
                  exportName={`all_villas_${year}_${periodLabel}.csv`}
                  exportRows={villas
                    .filter(match)
                    .map((v, i) => [
                      i + 1,
                      v.name,
                      v.nights,
                      v.bookings,
                      v.members,
                    ])}
                  headers={[
                    "#",
                    "Villa",
                    "Nights booked",
                    "Bookings",
                    "Members",
                  ]}
                  rows={villas.filter(match).map((v, i) => [
                    i + 1,
                    <button
                      type="button"
                      style={{ ...button, padding: "5px 10px" }}
                      onClick={() => setDetail(v.name)}
                    >
                      {v.name}
                    </button>,
                    number(v.nights),
                    number(v.bookings),
                    number(v.members),
                  ])}
                />
                <p style={{ fontSize: 13, color: C.muted, marginBottom: 0 }}>
                  {villas.filter(match).length} villas in this list.
                </p>
              </Panel>
              {detail && (
                <Panel
                  icon={LineIcon}
                  title={detail}
                  hint={`Nights booked at ${detail} in every ${scope}.`}
                  right={
                    <button
                      type="button"
                      style={button}
                      onClick={() => setDetail("")}
                    >
                      Close
                    </button>
                  }
                >
                  <Lines data={detailLine} names={[detail]} height={280} />
                </Panel>
              )}
            </>
          )}

          {/* ───────── BEDROOMS ───────── */}
          {section === "bedroom" && (
            <>
              {periodBar}
              {(() => {
                const best = bedrooms[0];
                const perVilla = bedrooms
                  .map((b) => ({
                    name: b.name,
                    value: b.villas.size
                      ? Math.round((b.nights / b.villas.size) * 10) / 10
                      : 0,
                  }))
                  .sort((a, b) => b.value - a.value);
                const totalB = sum(bedrooms, "nights");
                return (
                  <>
                    <div style={kpiGrid}>
                      <Kpi
                        icon={Trophy}
                        accent={C.flame}
                        label="Most booked size"
                        value={best?.name || "—"}
                        sub={
                          best
                            ? `${number(best.nights)} nights in ${periodLabel}`
                            : undefined
                        }
                      />
                      <Kpi
                        icon={PieIcon}
                        accent={C.deep}
                        label="Share of nights"
                        value={
                          best && totalB
                            ? `${number((best.nights / totalB) * 100)}%`
                            : "—"
                        }
                        sub={best ? `went to ${best.name} villas` : undefined}
                      />
                      <Kpi
                        icon={Building2}
                        accent={C.truffle}
                        label="Sizes booked"
                        value={number(bedrooms.length)}
                        sub={`in ${periodLabel}`}
                      />
                      <Kpi
                        icon={TrendingUp}
                        accent={C.good}
                        label="Best earner per villa"
                        value={perVilla[0]?.name || "—"}
                        sub={
                          perVilla[0]
                            ? `${number(perVilla[0].value, 1)} nights per villa`
                            : undefined
                        }
                        subColor={C.good}
                      />
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(340px, 1fr))",
                        gap: 18,
                      }}
                    >
                      <Panel
                        icon={PieIcon}
                        title={`Share of nights in ${periodLabel}`}
                        hint="How the booked nights split between bedroom sizes. A bigger slice means more of the demand."
                      >
                        {bedrooms.length ? (
                          <Chart height={320}>
                            <PieChart>
                              <Pie
                                data={bedrooms}
                                dataKey="nights"
                                nameKey="name"
                                innerRadius={70}
                                outerRadius={115}
                                paddingAngle={3}
                                label={({ name, percent }) =>
                                  `${name} ${(percent * 100).toFixed(0)}%`
                                }
                              >
                                {bedrooms.map((_, i) => (
                                  <Cell
                                    key={i}
                                    fill={SERIES[i % SERIES.length]}
                                  />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={TIP}
                                formatter={(v) => `${number(v)} nights`}
                              />
                            </PieChart>
                          </Chart>
                        ) : (
                          <Empty />
                        )}
                      </Panel>
                      <Panel
                        icon={BarChart3}
                        title="Nights booked per villa"
                        hint="Nights divided by the number of villas of that size, so a size with many villas does not win just by being common."
                      >
                        {perVilla.length ? (
                          <Chart height={320}>
                            <BarChart
                              data={perVilla}
                              margin={{ top: 8, right: 10, left: 0, bottom: 0 }}
                            >
                              <CartesianGrid stroke={GRID} vertical={false} />
                              <XAxis
                                dataKey="name"
                                tick={tick}
                                axisLine={false}
                                tickLine={false}
                              />
                              <YAxis
                                tick={tick}
                                axisLine={false}
                                tickLine={false}
                                width={48}
                              />
                              <Tooltip
                                contentStyle={TIP}
                                formatter={(v) =>
                                  `${number(v, 1)} nights per villa`
                                }
                              />
                              <Bar
                                dataKey="value"
                                name="Nights per villa"
                                radius={[8, 8, 0, 0]}
                              >
                                {perVilla.map((_, i) => (
                                  <Cell
                                    key={i}
                                    fill={SERIES[i % SERIES.length]}
                                  />
                                ))}
                              </Bar>
                            </BarChart>
                          </Chart>
                        ) : (
                          <Empty />
                        )}
                      </Panel>
                    </div>
                  </>
                );
              })()}
              <Panel
                title={`Bedroom sizes in ${periodLabel}`}
                hint="Each size from most to least booked, and how many villas of that size were booked."
              >
                <DataTable
                  maxHeight={TEN_ROWS}
                  exportName={`bedrooms_${year}_${periodLabel}.csv`}
                  exportRows={bedrooms
                    .filter(match)
                    .map((b, i) => [
                      i + 1,
                      b.name,
                      b.nights,
                      b.villas.size,
                      b.villas.size
                        ? (b.nights / b.villas.size).toFixed(1)
                        : "",
                      b.bookings,
                    ])}
                  headers={[
                    "#",
                    "Bedroom size",
                    "Nights booked",
                    "Villas booked",
                    "Nights per villa",
                    "Bookings",
                  ]}
                  rows={bedrooms
                    .filter(match)
                    .map((b, i) => [
                      i + 1,
                      b.name,
                      number(b.nights),
                      number(b.villas.size),
                      b.villas.size ? number(b.nights / b.villas.size, 1) : "—",
                      number(b.bookings),
                    ])}
                />
                <p style={{ fontSize: 13, color: C.muted, marginBottom: 0 }}>
                  Only villas that were booked are counted, so this is not an
                  occupancy rate.
                </p>
              </Panel>
            </>
          )}

          {/* ───────── AMENITIES ───────── */}
          {section === "amenity" && (
            <>
              {periodBar}
              <div style={kpiGrid}>
                <Kpi
                  icon={Trophy}
                  accent={C.flame}
                  label="Most used amenity"
                  value={amenities[0]?.name || "—"}
                  sub={
                    amenities[0]
                      ? `${number(amenities[0].usage_count)} charges in ${periodLabel}`
                      : undefined
                  }
                />
                <Kpi
                  icon={Sparkles}
                  accent={C.deep}
                  label="Amenity charges"
                  value={number(sum(amenities, "usage_count"))}
                  sub={`in ${periodLabel}`}
                />
                <Kpi
                  icon={Building2}
                  accent={C.truffle}
                  label="Amenities used"
                  value={number(amenities.length)}
                  sub="different amenities"
                />
                <Kpi
                  icon={PieIcon}
                  accent={C.good}
                  label="Top amenity share"
                  value={
                    sum(amenities, "usage_count")
                      ? `${number((amenities[0].usage_count / sum(amenities, "usage_count")) * 100)}%`
                      : "—"
                  }
                  sub="of all charges"
                />
              </div>
              <Panel
                icon={BarChart3}
                title={`Most used amenities in ${periodLabel}`}
                hint="Which amenities guests used the most. The longest bar was used the most; each use is one charge on a guest's bill."
              >
                <RankBars
                  color={C.flame}
                  label="Charges"
                  height={Math.max(
                    220,
                    Math.min(amenities.length, 10) * 40 + 40,
                  )}
                  data={amenities
                    .filter(match)
                    .slice(0, 10)
                    .map((a) => ({ name: a.name, value: a.usage_count }))}
                />
              </Panel>
              <Panel
                icon={LineIcon}
                title="When each amenity is busiest"
                hint={`Each line follows one of ${periodLabel}'s top amenities through the year; a rising line means more guests are using it.`}
              >
                {amenityLineNames.length ? (
                  <Lines data={amenityLines} names={amenityLineNames} />
                ) : (
                  <Empty />
                )}
              </Panel>
              <Panel
                title={`All amenities in ${periodLabel}`}
                hint="Every amenity from most to least used."
              >
                <DataTable
                  maxHeight={TEN_ROWS}
                  exportName={`amenities_${year}_${periodLabel}.csv`}
                  exportRows={amenities
                    .filter(match)
                    .map((a, i) => [i + 1, a.name, a.usage_count, a.members])}
                  headers={["#", "Amenity", "Charges", "Members"]}
                  rows={amenities
                    .filter(match)
                    .map((a, i) => [
                      i + 1,
                      a.name,
                      number(a.usage_count),
                      number(a.members),
                    ])}
                />
              </Panel>
            </>
          )}
        </>
      )}
      <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
        Based on bookings and bills already recorded. Check-out day is not
        counted as a night. There is no occupancy figure because the number of
        available villa nights is not recorded here.
      </p>
    </div>
  );
}
