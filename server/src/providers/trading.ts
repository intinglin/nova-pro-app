// server/src/providers/trading.ts — trading provider contract.

import type {
    Account,
    AccountBalance,
    AccountTypeName,
    FuturesOrderReq,
    Margin,
    OrderEventData,
    PnlRow,
    Position,
    StockOrderReq,
    Trade,
} from '../types/dto.ts';
import type { ContractKey, MarketClientSource } from './market-data.ts';

export interface TradingCapabilities {
    futures: boolean;
}

/** 區間內的一筆成交（買賣 fill），股數單位＝股。用於重建歷史每日持股算 TWR。 */
export interface TradeFill {
    /** 成交日 YYYY-MM-DD */
    date: string;
    code: string;
    /** B=買進、S=賣出 */
    side: 'B' | 'S';
    /** 成交股數（股） */
    shares: number;
}

export interface TradingProvider {
    init(): Promise<void>;
    capabilities(): TradingCapabilities;
    accounts(): Promise<Account[]>;

    placeStockOrder(key: ContractKey, order: StockOrderReq): Promise<Trade>;
    /** providers with capabilities().futures === false may throw */
    placeFuturesOrder(
        key: ContractKey,
        order: FuturesOrderReq,
    ): Promise<Trade>;
    cancel(tradeId: string): Promise<Trade>;
    updatePrice(tradeId: string, price: number): Promise<Trade>;
    updateQty(tradeId: string, quantity: number): Promise<Trade>;
    trades(accountType: AccountTypeName): Promise<Trade[]>;

    positions(accountType: AccountTypeName): Promise<Position[]>;
    accountBalance(): Promise<AccountBalance>;
    margin(): Promise<Margin>;
    profitLoss(
        beginDate: string,
        endDate: string,
        accountType: AccountTypeName,
    ): Promise<PnlRow[]>;

    onOrderEvent(cb: (ev: OrderEventData) => void): void;

    /**
     * 區間內全部成交明細（買賣 fills），用於重建歷史每日持股以算真實
     * 投組 TWR。只有部分券商實作（玉山）；未實作者投組報酬退回「凍結
     * 組成」近似。startDate/endDate 為 YYYY-MM-DD。
     */
    tradeFills?(startDate: string, endDate: string): Promise<TradeFill[]>;

    /** broker SDKs that bundle market data expose it here (after init) */
    marketdataSource?(): MarketClientSource | null;
    /** release sessions / sockets when the provider is swapped out */
    dispose?(): void;
}

export class TradeNotFoundError extends Error {
    constructor(tradeId: string) {
        super(`trade not found: ${tradeId}`);
    }
}

export class FuturesNotSupportedError extends Error {
    constructor() {
        super('此券商不支援期貨/選擇權下單');
    }
}

export function zeroMargin(): Margin {
    return {
        yesterday_balance: 0,
        today_balance: 0,
        deposit_withdrawal: 0,
        fee: 0,
        tax: 0,
        initial_margin: 0,
        maintenance_margin: 0,
        margin_call: 0,
        risk_indicator: 0,
        royalty_revenue_expenditure: 0,
        equity: 0,
        equity_amount: 0,
        option_openbuy_market_value: 0,
        option_opensell_market_value: 0,
        option_open_position: 0,
        option_settle_profitloss: 0,
        future_open_position: 0,
        today_future_open_position: 0,
        future_settle_profitloss: 0,
        available_margin: 0,
        plus_margin: 0,
        plus_margin_indicator: 0,
        security_collateral_amount: 0,
        order_margin_premium: 0,
        collateral_amount: 0,
    };
}
