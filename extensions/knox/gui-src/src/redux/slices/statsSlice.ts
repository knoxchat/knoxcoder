import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";

// ── Types ────────────────────────────────────────────────────────

export interface TokenUsageByDay {
  day: string;
  promptTokens: number;
  generatedTokens: number;
  estimatedCost?: number;
}

export interface TokenUsageByModel {
  model: string;
  promptTokens: number;
  generatedTokens: number;
  promptCost?: number;
  completionCost?: number;
  totalCost?: number;
}

export interface BudgetAlert {
  threshold: number;
  currentTotal: number;
  triggered: boolean;
}

interface StatsState {
  /** Daily token usage */
  dailyUsage: TokenUsageByDay[];
  /** Per-model token usage with cost */
  modelUsage: TokenUsageByModel[];
  /** Session totals */
  sessionTotals: {
    promptTokens: number;
    generatedTokens: number;
    totalCost: number;
    requestCount: number;
  };
  /** Budget alert configuration */
  budgetAlert: BudgetAlert | null;
  /** Loading state */
  loading: boolean;
  /** Last refresh timestamp */
  lastRefresh: number | null;
}

const initialState: StatsState = {
  dailyUsage: [],
  modelUsage: [],
  sessionTotals: {
    promptTokens: 0,
    generatedTokens: 0,
    totalCost: 0,
    requestCount: 0,
  },
  budgetAlert: null,
  loading: false,
  lastRefresh: null,
};

// ── Slice ─────────────────────────────────────────────────────────

const statsSlice = createSlice({
  name: "stats",
  initialState,
  reducers: {
    setDailyUsage(state, action: PayloadAction<TokenUsageByDay[]>) {
      state.dailyUsage = action.payload;
    },
    setModelUsage(state, action: PayloadAction<TokenUsageByModel[]>) {
      state.modelUsage = action.payload;
    },
    /** Called after each LLM request to update session running totals */
    recordUsage(
      state,
      action: PayloadAction<{
        model: string;
        promptTokens: number;
        generatedTokens: number;
        cost: number;
      }>,
    ) {
      const { promptTokens, generatedTokens, cost } = action.payload;
      state.sessionTotals.promptTokens += promptTokens;
      state.sessionTotals.generatedTokens += generatedTokens;
      state.sessionTotals.totalCost += cost;
      state.sessionTotals.requestCount += 1;

      // Check budget alert
      if (state.budgetAlert && !state.budgetAlert.triggered) {
        state.budgetAlert.currentTotal = state.sessionTotals.totalCost;
        if (state.sessionTotals.totalCost >= state.budgetAlert.threshold) {
          state.budgetAlert.triggered = true;
        }
      }
    },
    setBudgetAlert(state, action: PayloadAction<{ threshold: number } | null>) {
      if (action.payload) {
        state.budgetAlert = {
          threshold: action.payload.threshold,
          currentTotal: state.sessionTotals.totalCost,
          triggered: state.sessionTotals.totalCost >= action.payload.threshold,
        };
      } else {
        state.budgetAlert = null;
      }
    },
    resetSessionTotals(state) {
      state.sessionTotals = {
        promptTokens: 0,
        generatedTokens: 0,
        totalCost: 0,
        requestCount: 0,
      };
      if (state.budgetAlert) {
        state.budgetAlert.currentTotal = 0;
        state.budgetAlert.triggered = false;
      }
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setLastRefresh(state) {
      state.lastRefresh = Date.now();
    },
  },
});

export const {
  setDailyUsage,
  setModelUsage,
  recordUsage,
  setBudgetAlert,
  resetSessionTotals,
  setLoading,
  setLastRefresh,
} = statsSlice.actions;

export default statsSlice.reducer;
