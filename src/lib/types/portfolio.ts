// src/lib/types/portfolio.ts — account/position shapes

export type AccountTypeName = 'S' | 'F';

export interface Account {
    account_type: string;
    person_id: string;
    broker_id: string;
    account_id: string;
    signed: boolean;
    username: string;
}

export interface StockPosition {
    id: number;
    code: string;
    direction: 'Buy' | 'Sell';
    quantity: number;
    price: number;
    last_price: number;
    pnl: number;
    yd_quantity: number;
    cond?: string;
}

export interface FuturePosition {
    id: number;
    code: string;
    direction: 'Buy' | 'Sell';
    quantity: number;
    price: number;
    last_price: number;
    pnl: number;
}

export type Position = StockPosition | FuturePosition;

export interface AccountBalance {
    acc_balance: number;
    date: string;
    errmsg: string;
}

export interface Margin {
    yesterday_balance: number;
    today_balance: number;
    deposit_withdrawal: number;
    fee: number;
    tax: number;
    initial_margin: number;
    maintenance_margin: number;
    margin_call: number;
    risk_indicator: number;
    royalty_revenue_expenditure: number;
    equity: number;
    equity_amount: number;
    option_openbuy_market_value: number;
    option_opensell_market_value: number;
    option_open_position: number;
    option_settle_profitloss: number;
    future_open_position: number;
    today_future_open_position: number;
    future_settle_profitloss: number;
    available_margin: number;
    plus_margin: number;
    plus_margin_indicator: number;
    security_collateral_amount: number;
    order_margin_premium: number;
    collateral_amount: number;
}

/** 投組 vs 基準 ETF 的指數化走勢序列（基期 = 0%；null = 該日尚無資料） */
export interface PerfSeries {
    kind: 'portfolio' | 'benchmark';
    code: string;
    name: string;
    values: (number | null)[];
    last_pct: number | null;
}

/** 投組 TWR 的逐檔明細（含期間內已平倉者），供核對 */
export interface PerfHolding {
    code: string;
    name: string;
    /** held = 現仍持有；closed = 期間內已全數平倉 */
    status: 'held' | 'closed';
    /** 期間內是否有買賣進出（非全程持股不變） */
    traded: boolean;
    /** 在分析窗內實際持有的起訖日 */
    from: string;
    to: string;
    /** 該檔在持有期間的還原價報酬 %（個股自身表現，非加權貢獻） */
    ret_pct: number | null;
    /** 目前持股（股） */
    shares: number;
}

export interface PerformanceResponse {
    /** mtd | 1m | 3m | 6m | ytd | 1y */
    period: string;
    /** dates[0] = 基期（期初前一交易日），各序列在此為 0% */
    dates: string[];
    series: PerfSeries[];
    holdings_count: number;
    /** 投組所屬券商（trade provider 名，mock = 紙上交易） */
    broker: string;
    warnings: string[];
    /** 逐檔明細（僅 TWR 重建路徑有；凍結組成時為 undefined） */
    breakdown?: PerfHolding[];
}
