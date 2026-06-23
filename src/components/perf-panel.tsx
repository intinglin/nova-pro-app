// src/components/perf-panel.tsx — 投組 TWR vs 0050／主動式 ETF 走勢比較
//
// 真實組合 TWR：以現庫存為錨往回推區間內的買賣成交，重建每一天的實際
// 持股（含期間內買進、賣出、已平倉的標的 — 無存活者偏誤），逐日報酬
// 串接後指數化（基期 = 期初前一交易日收盤 = 0%）。買賣只改隔日基底、
// 現金流自動中性化 — 衡量「選股」per-dollar 結果、可與 0050／主動式
// ETF 對比。券商未提供成交明細時退回「凍結組成」近似（序列名會標明）。

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../lib/api';
import { SENSITIVE } from '../lib/privacy';
import type {
    PerfSeries,
    PerformanceResponse,
} from '../lib/types/portfolio';
import { fmtPct } from '../lib/utils/format';
import * as dock from './bottom-dock.css';
import * as panel from './panel.css';
import * as styles from './perf-panel.css';

const PERIODS = [
    { key: 'mtd', label: 'MTD' },
    { key: '1m', label: '1月' },
    { key: '3m', label: '3月' },
    { key: '6m', label: '6月' },
    { key: 'ytd', label: 'YTD' },
    { key: '1y', label: '1年' },
    { key: '2y', label: '2年' },
] as const;

// 基準候選：0050（市值型被動）＋ 主動式 ETF。名稱以 API 回傳為準，
// 抓不到名稱時顯示代碼。
const BENCHMARKS = [
    { code: '0050', defaultOn: true },
    { code: '00980A', defaultOn: false },
    { code: '00981A', defaultOn: true },
    { code: '00982A', defaultOn: false },
];

const BROKER_LABEL: Record<string, string> = {
    mock: '模擬',
    fubon: '富邦',
    nova: '台新',
    esun: '玉山',
};

// 顏色綁定代碼（不是出現順序）— 開關其他基準不會讓既有線換色
const PORTFOLIO_COLOR = '#e0af68';
const COLOR_BY_CODE: Record<string, string> = {
    '0050': '#7aa2f7',
    '00980A': '#bb9af7',
    '00981A': '#73daca',
    '00982A': '#f7768e',
};
const FALLBACK_COLOR = '#9ece6a';

function seriesColor(s: PerfSeries): string {
    if (s.kind === 'portfolio') return PORTFOLIO_COLOR;
    return COLOR_BY_CODE[s.code] ?? FALLBACK_COLOR;
}

const METHOD_NOTE =
    '真實組合 TWR：以現庫存為錨，往回推區間內的買賣成交，重建每一天的' +
    '實際持股（含期間內買進、賣出、已平倉的標的），逐日報酬串接後指數化。' +
    '基期為期間起點前一交易日收盤（= 0%）。買賣只改隔日基底股數、現金流' +
    '自動中性化，衡量「選股」per-dollar 結果（非帳戶絕對損益）。配股由還原' +
    '價帶、不雙重計。券商未提供成交明細時退回「凍結組成」近似。';

function dirOfPct(v: number | null): 'up' | 'down' | 'flat' {
    if (v === null || v === 0) return 'flat';
    return v > 0 ? 'up' : 'down';
}

/** 指數化序列在某日的值 = 基期到該日的報酬率；未 hover 時用期末值 */
function valueAt(s: PerfSeries, idx: number | null): number | null {
    if (idx === null) return s.last_pct;
    return s.values[idx] ?? null;
}

function Chart({
    data,
    dim,
    hoverIdx,
    onHover,
}: {
    data: PerformanceResponse;
    dim: boolean;
    hoverIdx: number | null;
    onHover: (idx: number | null) => void;
}) {
    const visible = data.series.filter((s) =>
        s.values.some((v) => v !== null),
    );
    const all = visible.flatMap((s) =>
        s.values.filter((v): v is number => v !== null),
    );
    if (all.length === 0 || data.dates.length < 2) {
        return <div className={dock.emptyState}>資料不足，無法繪圖</div>;
    }
    const n = data.dates.length;
    const min = Math.min(0, ...all);
    const max = Math.max(0, ...all);
    const pad = (max - min || 1) * 0.05;
    const lo = min - pad;
    const span = max + pad - lo;
    const W = 100;
    const H = 44;
    const x = (i: number) => (i / (n - 1)) * W;
    const y = (v: number) => H - ((v - lo) / span) * H;
    const leftPct = (i: number) => (i / (n - 1)) * 100;
    const topPct = (v: number) => (1 - (v - lo) / span) * 100;

    const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        const frac = (e.clientX - rect.left) / rect.width;
        const idx = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
        onHover(idx);
    };

    return (
        <div
            className={styles.chartWrap}
            style={dim ? { opacity: 0.45 } : undefined}
        >
            <div
                className={styles.chartArea}
                onMouseMove={handleMove}
                onMouseLeave={() => onHover(null)}
            >
                <span className={styles.yMax}>{fmtPct(max)}</span>
                <span className={styles.yMin}>{fmtPct(min)}</span>
                <svg
                    viewBox={`0 0 ${W} ${H}`}
                    preserveAspectRatio='none'
                    className={styles.chart}
                >
                    <line
                        x1={0}
                        y1={y(0)}
                        x2={W}
                        y2={y(0)}
                        className={styles.zeroLine}
                    />
                    {visible.map((s) => {
                        const pts = s.values
                            .map((v, i) =>
                                v === null
                                    ? null
                                    : `${x(i).toFixed(2)},${y(v).toFixed(2)}`,
                            )
                            .filter((p): p is string => p !== null)
                            .join(' ');
                        return (
                            <polyline
                                key={s.code}
                                points={pts}
                                className={styles.line}
                                stroke={seriesColor(s)}
                                strokeWidth={
                                    s.kind === 'portfolio' ? 2 : 1.2
                                }
                            />
                        );
                    })}
                </svg>
                {hoverIdx !== null && (
                    <div className={styles.crosshair}>
                        <div
                            className={styles.crosshairLine}
                            style={{ left: `${leftPct(hoverIdx)}%` }}
                        />
                        {visible.map((s) => {
                            const v = s.values[hoverIdx];
                            if (v === null || v === undefined) return null;
                            return (
                                <div
                                    key={s.code}
                                    className={styles.crosshairDot}
                                    style={{
                                        left: `${leftPct(hoverIdx)}%`,
                                        top: `${topPct(v)}%`,
                                        background: seriesColor(s),
                                    }}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
            <div className={styles.axisRow}>
                <span>基期 {data.dates[0]}</span>
                <span>{data.dates[data.dates.length - 1]}</span>
            </div>
        </div>
    );
}

/** hero 列：未 hover 顯示期間總報酬；hover 時顯示「基期→游標日」的報酬與差距 */
function Hero({
    data,
    selected,
    hoverIdx,
}: {
    data: PerformanceResponse;
    selected: string[];
    hoverIdx: number | null;
}) {
    const port = data.series.find((s) => s.kind === 'portfolio');
    if (!port) return null;
    const brokerLabel = BROKER_LABEL[data.broker] ?? data.broker;
    const portVal = valueAt(port, hoverIdx);
    if (portVal === null) return null;

    // 對比目標 = BENCHMARKS 順位最前、已開啟且有資料的基準（通常 0050）
    const target = BENCHMARKS.map((b) => b.code)
        .filter((c) => selected.includes(c))
        .map((c) => data.series.find((s) => s.code === c))
        .find((s) => s && valueAt(s, hoverIdx) !== null);
    const targetVal = target ? valueAt(target, hoverIdx) : null;

    let deltaNode: React.ReactNode = null;
    if (target && targetVal !== null) {
        const delta = portVal - targetVal;
        const ahead = Math.abs(delta) < 0.005 ? null : delta > 0;
        deltaNode = (
            <span
                className={`${styles.heroDelta} ${panel.dirText[ahead === null ? 'flat' : ahead ? 'up' : 'down']} ${SENSITIVE}`}
            >
                {ahead === null
                    ? `與 ${target.code} 持平`
                    : `${ahead ? '領先' : '落後'} ${target.code} ${Math.abs(delta).toFixed(2)} 個百分點`}
            </span>
        );
    }

    const hoverDate = hoverIdx !== null ? data.dates[hoverIdx] : null;
    return (
        <div className={styles.hero}>
            <span className={styles.heroLabel}>
                {brokerLabel}
                {port.name}
                {hoverDate ? (
                    <span className={styles.heroDate}>截至 {hoverDate}</span>
                ) : (
                    <span className={styles.info} title={METHOD_NOTE}>
                        {' '}
                        ⓘ
                    </span>
                )}
            </span>
            <span
                className={`${styles.heroValue} ${panel.dirText[dirOfPct(portVal)]} ${SENSITIVE}`}
            >
                {fmtPct(portVal)}
            </span>
            {deltaNode}
        </div>
    );
}

export function PerfPanel() {
    const [period, setPeriod] = useState<string>('3m');
    const [selected, setSelected] = useState<string[]>(
        BENCHMARKS.filter((b) => b.defaultOn).map((b) => b.code),
    );
    const [data, setData] = useState<PerformanceResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [names, setNames] = useState<Record<string, string>>({});
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const [showDetail, setShowDetail] = useState(false);
    // 冷快取下歷史日線受 60/min 限流、需分批補齊 — 用 reloadTick 自動重抓
    const [reloadTick, setReloadTick] = useState(0);
    const reloadsRef = useRef(0);
    const lastKeyRef = useRef('');

    const benchKey = useMemo(() => [...selected].sort().join(','), [selected]);

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const key = `${period}|${benchKey}`;
        if (lastKeyRef.current !== key) {
            lastKeyRef.current = key;
            reloadsRef.current = 0;
            setHoverIdx(null); // 換期間/基準後日期網格會變，舊索引失效
        }
        setLoading(true);
        apiGet<PerformanceResponse>(
            `/api/v1/portfolio/performance?period=${period}&benchmarks=${benchKey}`,
        )
            .then((d) => {
                if (!alive) return;
                setData(d);
                setError(null);
                setNames((prev) => {
                    const next = { ...prev };
                    for (const s of d.series) {
                        if (s.kind === 'benchmark' && s.name) {
                            next[s.code] = s.name;
                        }
                    }
                    return next;
                });
                // 有檔被排除（查無歷史價格＝冷快取尚未補齊）→ 隔幾秒自動重抓，
                // 直到補齊（最多 6 次）。歷史 chunk 有快取，每次只補缺的段。
                const incomplete = d.warnings.some((w) =>
                    w.includes('查無歷史價格'),
                );
                if (incomplete && reloadsRef.current < 6) {
                    reloadsRef.current += 1;
                    timer = setTimeout(() => setReloadTick((t) => t + 1), 5000);
                }
            })
            .catch((e) => {
                if (alive) setError(e instanceof Error ? e.message : String(e));
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
            if (timer) clearTimeout(timer);
        };
    }, [period, benchKey, reloadTick]);

    const toggleBench = (code: string) => {
        setSelected((prev) =>
            prev.includes(code)
                ? prev.filter((c) => c !== code)
                : [...prev, code],
        );
    };

    return (
        <div className={panel.panelBody}>
            <div className={styles.controls}>
                <span className={styles.periodGroup}>
                    {PERIODS.map((p) => (
                        <button
                            key={p.key}
                            className={
                                period === p.key
                                    ? styles.toggleOn
                                    : styles.toggle
                            }
                            onClick={() => setPeriod(p.key)}
                        >
                            {p.label}
                        </button>
                    ))}
                </span>
                {BENCHMARKS.map((b) => (
                    <button
                        key={b.code}
                        className={
                            selected.includes(b.code)
                                ? styles.toggleOn
                                : styles.toggle
                        }
                        style={
                            selected.includes(b.code)
                                ? {
                                      borderColor:
                                          COLOR_BY_CODE[b.code] ??
                                          FALLBACK_COLOR,
                                  }
                                : undefined
                        }
                        title={names[b.code] ?? b.code}
                        onClick={() => toggleBench(b.code)}
                    >
                        {b.code}
                    </button>
                ))}
            </div>
            {!data ? (
                <div className={dock.emptyState}>
                    {error ? `走勢資料無法取得：${error}` : '載入中…'}
                </div>
            ) : (
                <>
                    <Hero
                        data={data}
                        selected={selected}
                        hoverIdx={hoverIdx}
                    />
                    <Chart
                        data={data}
                        dim={loading}
                        hoverIdx={hoverIdx}
                        onHover={setHoverIdx}
                    />
                    <div className={styles.legend}>
                        {data.series
                            .filter((s) => s.values.some((v) => v !== null))
                            .map((s) => {
                                const v = valueAt(s, hoverIdx);
                                return (
                                    <span
                                        key={s.code}
                                        className={styles.legendItem}
                                        title={
                                            s.kind === 'benchmark'
                                                ? s.name || s.code
                                                : undefined
                                        }
                                    >
                                        <span
                                            className={styles.dot}
                                            style={{
                                                background: seriesColor(s),
                                            }}
                                        />
                                        {s.name ||
                                            (s.kind === 'portfolio'
                                                ? '投組'
                                                : s.code)}
                                        <span
                                            className={`${panel.dirText[dirOfPct(v)]}${s.kind === 'portfolio' ? ` ${SENSITIVE}` : ''}`}
                                        >
                                            {fmtPct(v ?? undefined)}
                                        </span>
                                    </span>
                                );
                            })}
                    </div>
                    {data.warnings.length > 0 && (
                        <div className={styles.warn}>
                            ⚠ {data.warnings.join('；')}
                        </div>
                    )}
                    {data.breakdown && data.breakdown.length > 0 && (
                        <>
                            <button
                                type='button'
                                className={styles.toggle}
                                style={{
                                    alignSelf: 'flex-start',
                                    marginTop: 6,
                                }}
                                onClick={() => setShowDetail((v) => !v)}
                            >
                                {showDetail ? '▾' : '▸'} 逐檔明細（
                                {data.breakdown.length} 檔，個股期間還原報酬）
                            </button>
                            {showDetail && (
                                <div
                                    style={{
                                        maxHeight: 220,
                                        overflowY: 'auto',
                                        marginTop: 4,
                                    }}
                                >
                                    <table className={dock.table}>
                                        <thead>
                                            <tr>
                                                <th className={dock.th}>
                                                    標的
                                                </th>
                                                <th className={dock.th}>
                                                    狀態
                                                </th>
                                                <th className={dock.th}>
                                                    持有區間
                                                </th>
                                                <th className={dock.th}>
                                                    個股報酬
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {[...data.breakdown]
                                                .sort(
                                                    (a, b) =>
                                                        (b.ret_pct ??
                                                            -Infinity) -
                                                        (a.ret_pct ??
                                                            -Infinity),
                                                )
                                                .map((h) => (
                                                    <tr key={h.code}>
                                                        <td className={dock.td}>
                                                            {h.code}
                                                            {(names[h.code] ||
                                                                h.name) &&
                                                                ` ${names[h.code] || h.name}`}
                                                        </td>
                                                        <td className={dock.td}>
                                                            {h.status ===
                                                            'closed'
                                                                ? '● 已平倉'
                                                                : h.traded
                                                                  ? '進出'
                                                                  : '持有'}
                                                        </td>
                                                        <td className={dock.td}>
                                                            {h.from}~{h.to}
                                                        </td>
                                                        <td
                                                            className={`${dock.td} ${panel.dirText[dirOfPct(h.ret_pct)]} ${SENSITIVE}`}
                                                        >
                                                            {fmtPct(
                                                                h.ret_pct ??
                                                                    undefined,
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
}
