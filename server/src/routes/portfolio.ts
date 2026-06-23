// server/src/routes/portfolio.ts — positions, balance, margin, P&L

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import type { DailyClose } from '../providers/market-data.ts';
import type { TradeFill } from '../providers/trading.ts';
import type {
    AccountTypeName,
    PerfHolding,
    PerfSeries,
    PerformanceResponse,
} from '../types/dto.ts';

export function registerPortfolioRoutes(
    app: FastifyInstance,
    ctx: AppContext,
): void {
    app.post<{ Body: { account_type: AccountTypeName; unit?: string } }>(
        '/api/v1/portfolio/position_unit',
        async (req) => ctx.trading.positions(req.body.account_type),
    );

    app.get<{ Querystring: { period?: string; benchmarks?: string } }>(
        '/api/v1/portfolio/performance',
        async (req) =>
            buildPerformance(ctx, req.query.period, req.query.benchmarks),
    );

    app.post('/api/v1/portfolio/account_balance', async () =>
        ctx.trading.accountBalance(),
    );

    app.post('/api/v1/portfolio/margin', async () => ctx.trading.margin());

    // manual refresh: bust the manager's read caches so the next queries
    // hit the broker for fresh data
    app.post('/api/v1/portfolio/refresh', async () => {
        ctx.trading.bustReadCaches();
        return { ok: true };
    });

    app.post<{
        Body: {
            begin_date: string;
            end_date: string;
            account_type: AccountTypeName;
            unit?: string;
        };
    }>('/api/v1/portfolio/profit_loss', async (req) =>
        ctx.trading.profitLoss(
            req.body.begin_date,
            req.body.end_date,
            req.body.account_type,
        ),
    );
}

// ---- 投組 vs 基準 ETF 走勢比較 ----------------------------------------
//
// 券商有提供成交明細（tradeFills）時，投組序列是「真實組合 TWR」：
//   1. 以現庫存為錨，往回退區間內的買賣成交，重建每一天的實際持股
//      （含期間內買進、賣出、已平倉的標的 — 無存活者偏誤）。
//   2. 每日報酬 = 前一日持股在今/昨還原收盤的加權變動，串接後指數化
//      （基期 = 期初前一交易日 = 0%）。買賣只改隔日基底股數 → 現金流
//      自動中性化，是衡量「選股」per-dollar 結果、可與 0050 對比的 TWR。
//   配股不入股數、由還原價帶（其調整因子恰抵銷配股的股數膨脹，過去權重
//   自動正確），避免股利雙重計。
//
// 券商未提供 tradeFills 時，退回「凍結組成」近似：拿目前持股股數乘各檔
// 還原日收盤、指數化 — 只反映「現在這組持股」過去的走勢，不含進出。

const PERF_DEFAULT_BENCHMARKS = '0050,00981A';
const PERF_CODE_RE = /^[0-9A-Z]{2,10}$/;
const PERF_PERIODS = ['mtd', '1m', '3m', '6m', 'ytd', '1y', '2y'] as const;
type PerfPeriod = (typeof PERF_PERIODS)[number];

function isoDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

/** 台北時區的今天（UTC 日期在台北凌晨 0-8 點會差一天） */
function taipeiToday(): string {
    return isoDate(Date.now() + 8 * 3_600_000);
}

/** 減 n 個日曆月，月底溢位 clamp（03-31 − 1 月 → 02-28/29） */
function subMonths(iso: string, n: number): string {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const total = y * 12 + (m - 1) - n;
    const ty = Math.floor(total / 12);
    const tm = total % 12; // 0-based
    const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    const td = Math.min(d, lastDay);
    return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}

/** 期間起點（含）。報酬基期 = 此日之前的最後一個交易日收盤。 */
function windowStartFor(period: PerfPeriod, today: string): string {
    switch (period) {
        case 'mtd':
            return `${today.slice(0, 7)}-01`;
        case 'ytd':
            return `${today.slice(0, 4)}-01-01`;
        case '1m':
            return subMonths(today, 1);
        case '3m':
            return subMonths(today, 3);
        case '6m':
            return subMonths(today, 6);
        case '1y':
            return subMonths(today, 12);
        case '2y':
            return subMonths(today, 24);
    }
}

/**
 * rows（日期升冪）攤到 dates 網格上：交易日缺口 ffill 前值。
 * backfill = true 時，網格起點早於該檔首日也用首日價回填（投組用 —
 * 新上市持股不該讓整條線縮短）；false 時回 null（基準 ETF 上市前
 * 不畫線，誠實呈現「這段沒有它」）。
 */
function fillCloses(
    rows: DailyClose[],
    dates: string[],
    backfill: boolean,
): (number | null)[] {
    const out: (number | null)[] = [];
    let i = 0;
    let last: number | null = null;
    for (const d of dates) {
        for (let row = rows[i]; row && row.date <= d; row = rows[i]) {
            last = row.close;
            i += 1;
        }
        if (last !== null) out.push(last);
        else out.push(backfill ? (rows[0]?.close ?? null) : null);
    }
    return out;
}

/** 指數化：基期 = 第一個非 null 值，輸出 %（保留 2 位） */
function toPct(values: (number | null)[]): (number | null)[] {
    const base = values.find((v): v is number => v !== null);
    if (base === undefined || base <= 0) return values.map(() => null);
    return values.map((v) =>
        v === null ? null : Math.round((v / base - 1) * 10000) / 100,
    );
}

function lastNonNull(values: (number | null)[]): number | null {
    for (let i = values.length - 1; i >= 0; i -= 1) {
        const v = values[i];
        if (v !== null && v !== undefined) return v;
    }
    return null;
}

/**
 * 重建每日「日終持股」：以現庫存為錨，往回退區間內成交。
 * sharesEnd(t) = 現股 − Σ(買, date>t) + Σ(賣, date>t)。
 * 已平倉部位（現股 0）走回退會在賣出日之前長出股數 — 正確納入其持有期間。
 * 負股數（賣超出可解釋量 → 公司行動/缺紀錄）收進 flagged 並 clamp 為 0。
 */
function reconstructShares(
    fills: TradeFill[],
    currentShares: Map<string, number>,
    dates: string[],
): { sharesByCode: Map<string, number[]>; flagged: Set<string> } {
    const codes = new Set<string>(currentShares.keys());
    const fillsByCode = new Map<string, TradeFill[]>();
    for (const f of fills) {
        codes.add(f.code);
        const arr = fillsByCode.get(f.code);
        if (arr) arr.push(f);
        else fillsByCode.set(f.code, [f]);
    }
    const sharesByCode = new Map<string, number[]>();
    const flagged = new Set<string>();
    for (const code of codes) {
        const cur = currentShares.get(code) ?? 0;
        const cf = fillsByCode.get(code) ?? [];
        const arr = dates.map((t) => {
            let s = cur;
            for (const f of cf) {
                if (f.date > t) s += f.side === 'B' ? -f.shares : f.shares;
            }
            return s;
        });
        if (arr.some((s) => s < -0.5)) flagged.add(code);
        for (let i = 0; i < arr.length; i += 1) {
            if (arr[i]! < 0) arr[i] = 0;
        }
        sharesByCode.set(code, arr);
    }
    return { sharesByCode, flagged };
}

/**
 * 真實投組 TWR：每日報酬 = 「前一日持股」在今/昨還原收盤的加權變動，
 * 串接後指數化（起點 = 0%）。前一日持股當基底 → 當天的買賣不灌進當天報酬、
 * 只改隔日基底，現金流自動中性化。ffByCode 為各碼攤到 dates 網格的還原收盤。
 */
function computeTWR(
    sharesByCode: Map<string, number[]>,
    ffByCode: Map<string, (number | null)[]>,
    dates: string[],
): (number | null)[] {
    const out: (number | null)[] = dates.map(() => null);
    if (dates.length === 0) return out;
    out[0] = 0;
    let cum = 1;
    for (let i = 1; i < dates.length; i += 1) {
        let vPrev = 0;
        let vNow = 0;
        for (const [code, shares] of sharesByCode) {
            const sPrev = shares[i - 1] ?? 0;
            if (sPrev <= 0) continue;
            const closes = ffByCode.get(code);
            const cPrev = closes?.[i - 1];
            const cNow = closes?.[i];
            if (cPrev == null || cNow == null) continue;
            vPrev += sPrev * cPrev;
            vNow += sPrev * cNow;
        }
        if (vPrev > 0) cum *= vNow / vPrev;
        out[i] = Math.round((cum - 1) * 10000) / 100;
    }
    return out;
}

async function buildPerformance(
    ctx: AppContext,
    periodRaw: string | undefined,
    benchmarksRaw: string | undefined,
): Promise<PerformanceResponse> {
    const period: PerfPeriod = (PERF_PERIODS as readonly string[]).includes(
        periodRaw ?? '',
    )
        ? (periodRaw as PerfPeriod)
        : '3m';
    const benchCodes = [
        ...new Set(
            (benchmarksRaw ?? PERF_DEFAULT_BENCHMARKS)
                .split(',')
                .map((c) => c.trim().toUpperCase())
                .filter((c) => PERF_CODE_RE.test(c)),
        ),
    ].slice(0, 6);

    const warnings: string[] = [];

    // 持倉（多方證券）→ code → 股數
    const sharesByCode = new Map<string, number>();
    try {
        const positions = await ctx.trading.positions('S');
        for (const p of positions) {
            if (!('yd_quantity' in p)) continue;
            if (p.direction !== 'Buy' || p.quantity <= 0) continue;
            sharesByCode.set(
                p.code,
                (sharesByCode.get(p.code) ?? 0) +
                    Math.round(p.quantity * 1000),
            );
        }
    } catch (err) {
        warnings.push(
            `持倉查詢失敗：${err instanceof Error ? err.message : err}`,
        );
    }
    if (sharesByCode.size === 0) {
        warnings.push('目前帳戶無證券持倉 — 只顯示基準走勢');
    }

    const today = taipeiToday();
    const end = today;
    // 抓取窗固定 760 天、顯示窗本地裁切 — 所有期間共用同一個 provider
    // 快取 key，切換期間不重打 historical（60/min 配額實測三波就撞滿，
    // 會吃掉部分持股與基準）。760 天足以涵蓋 2y + 基期回看。
    const fetchStart = isoDate(
        new Date(today).getTime() - 760 * 86_400_000,
    );
    const windowStart = windowStartFor(period, today);

    // 區間成交明細（券商有支援才有）— 用來重建歷史持股算 TWR。fills 也帶出
    // 「已平倉」標的，必須一起抓它們的歷史價，否則重建出的持股無價可估。
    let fills: TradeFill[] | null = null;
    if (ctx.trading.tradeFills) {
        try {
            fills = await ctx.trading.tradeFills(fetchStart, end);
        } catch (err) {
            warnings.push(
                `成交明細查詢失敗，投組退回凍結組成：${err instanceof Error ? err.message : err}`,
            );
        }
    }
    const fillCodes = fills ? fills.map((f) => f.code) : [];

    const allCodes = [
        ...new Set([...sharesByCode.keys(), ...fillCodes, ...benchCodes]),
    ];
    // 分批抓（每檔 ~3 段 × ~21 檔會撞 60/min 限流）— 限並發降低限流壓力；
    // dailyCloses 內部已對限流退避重試、失敗才拋出（不靜默吞成殘缺資料），
    // 這裡的 catch = 重試後仍失敗 → 該檔排除，下面依角色給「查無歷史價格」。
    const closesByCode = new Map<string, DailyClose[]>();
    const FETCH_CONCURRENCY = 4;
    for (let i = 0; i < allCodes.length; i += FETCH_CONCURRENCY) {
        await Promise.all(
            allCodes.slice(i, i + FETCH_CONCURRENCY).map(async (code) => {
                try {
                    const rows = await ctx.market.dailyCloses(
                        { security_type: 'STK', exchange: null, code },
                        fetchStart,
                        end,
                    );
                    if (rows.length > 0) closesByCode.set(code, rows);
                } catch {
                    // 缺漏統一在下面依角色（持股/基準）給警告
                }
            }),
        );
    }

    // 日期網格 = 窗口內所有序列日期的聯集，最前面接上「基期」=
    // 期初前的最後一個交易日 — 報酬從前收起算（MTD 基期＝上月底收盤），
    // 否則期間第一天的漲跌會被吃掉
    const dateSet = new Set<string>();
    let anchor = '';
    for (const rows of closesByCode.values()) {
        for (const r of rows) {
            if (r.date >= windowStart) dateSet.add(r.date);
            else if (r.date > anchor) anchor = r.date;
        }
    }
    if (anchor) dateSet.add(anchor);
    const dates = [...dateSet].sort();

    const series: PerfSeries[] = [];

    let breakdown: PerfHolding[] | undefined;
    if (fills && dates.length > 0) {
        // ---- 真實組合 TWR（重建每日持股）----
        const { sharesByCode: sharesByDate, flagged } = reconstructShares(
            fills,
            sharesByCode,
            dates,
        );
        // 各碼還原收盤攤到網格（持股碼以首日價回填，僅供估值）
        const ffByCode = new Map<string, (number | null)[]>();
        for (const code of sharesByDate.keys()) {
            const rows = closesByCode.get(code);
            if (rows) {
                ffByCode.set(code, fillCloses(rows, dates, true));
            } else if (sharesByDate.get(code)!.some((s) => s > 0)) {
                warnings.push(`${code} 查無歷史價格，未計入投組 TWR`);
            }
        }
        const values = computeTWR(sharesByDate, ffByCode, dates);
        // 統計納入碼數 + 逐檔明細（個股期間還原報酬，供核對）
        const tradedCodes = new Set(fills.map((f) => f.code));
        const rows: PerfHolding[] = [];
        let counted = 0;
        let closed = 0;
        for (const [code, arr] of sharesByDate) {
            const closes = ffByCode.get(code);
            if (!closes || !arr.some((s) => s > 0)) continue;
            counted += 1;
            const cur = sharesByCode.get(code) ?? 0;
            if (cur <= 0) closed += 1;
            const fi = arr.findIndex((s) => s > 0);
            // li = 最後一個「進入該日時仍持有」的交易日 — 對已平倉部位就是
            // 賣出當日（其報酬 closes[賣出日]/closes[前一日] 仍計入 computeTWR）。
            // 用 arr[li] 會少算賣出日那天，個股報酬就對不上 TWR 貢獻。
            let li = arr.length - 1;
            while (li > 0 && (arr[li - 1] ?? 0) <= 0) li -= 1;
            const entry = closes[fi];
            const exit = closes[li];
            const ret =
                entry != null && exit != null && entry > 0
                    ? Math.round((exit / entry - 1) * 10000) / 100
                    : null;
            rows.push({
                code,
                name: ctx.market.displayName(code) ?? '',
                status: cur <= 0 ? 'closed' : 'held',
                traded: tradedCodes.has(code),
                from: dates[fi] ?? '',
                to: dates[li] ?? '',
                ret_pct: ret,
                shares: cur,
            });
        }
        rows.sort((a, b) => (b.ret_pct ?? -Infinity) - (a.ret_pct ?? -Infinity));
        breakdown = rows;
        if (flagged.size > 0) {
            warnings.push(
                `${flagged.size} 檔疑似公司行動（合併/減資等），其持股重建為近似：${[...flagged].join('、')}`,
            );
        }
        if (counted > 0) {
            series.push({
                kind: 'portfolio',
                code: 'PORTFOLIO',
                name:
                    closed > 0
                        ? `投組 TWR（${counted} 檔，含 ${closed} 已平倉）`
                        : `投組 TWR（${counted} 檔）`,
                values,
                last_pct: lastNonNull(values),
            });
        }
    } else if (sharesByCode.size > 0 && dates.length > 0) {
        // ---- 凍結組成（券商無成交明細時的退回）----
        if (ctx.trading.tradeFills === undefined) {
            warnings.push('此券商尚未支援歷史重建，投組為「凍結組成」近似');
        }
        const mv = dates.map(() => 0);
        let covered = 0;
        for (const [code, shares] of sharesByCode) {
            const rows = closesByCode.get(code);
            if (!rows) {
                warnings.push(`持股 ${code} 查無歷史價格，未計入投組序列`);
                continue;
            }
            covered += 1;
            const first = rows[0];
            const gridStart = dates[0];
            if (first && gridStart && first.date > gridStart) {
                warnings.push(
                    `持股 ${code} 歷史自 ${first.date} 起，更早以首日價回填`,
                );
            }
            const closes = fillCloses(rows, dates, true);
            for (let i = 0; i < dates.length; i += 1) {
                mv[i] = (mv[i] ?? 0) + shares * (closes[i] ?? 0);
            }
        }
        if (covered > 0) {
            const values = toPct(mv);
            series.push({
                kind: 'portfolio',
                code: 'PORTFOLIO',
                name: `投組（${covered} 檔，凍結組成）`,
                values,
                last_pct: lastNonNull(values),
            });
        }
    }

    for (const code of benchCodes) {
        const rows = closesByCode.get(code);
        if (!rows) {
            warnings.push(`基準 ${code} 查無歷史價格`);
            continue;
        }
        let name = ctx.market.displayName(code) ?? '';
        if (!name) {
            try {
                name =
                    (await ctx.market.resolveContract(code, 'STK'))?.name ??
                    '';
            } catch {
                // 名稱拿不到就顯示代碼
            }
        }
        const values = toPct(fillCloses(rows, dates, false));
        series.push({
            kind: 'benchmark',
            code,
            name,
            values,
            last_pct: lastNonNull(values),
        });
    }

    return {
        period,
        dates,
        series,
        holdings_count: sharesByCode.size,
        broker: ctx.trading.name(),
        warnings,
        ...(breakdown ? { breakdown } : {}),
    };
}
