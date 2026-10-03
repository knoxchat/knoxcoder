/**
 * K-051: vscode-free latency and acceptance tracking for inline completions.
 * Numbers stay local (in memory); `knoxchat.showInlineCompletionStats` prints them.
 * The feature stays off by default until these show a worthwhile acceptance rate.
 */

export interface InlineCompletionStatsSnapshot {
  requests: number;
  shown: number;
  accepted: number;
  empty: number;
  failed: number;
  cancelled: number;
  /** accepted / shown, 0 when nothing was shown. */
  acceptanceRate: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
}

const MAX_SAMPLES = 500;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export class InlineCompletionStats {
  private requests = 0;
  private shown = 0;
  private accepted = 0;
  private empty = 0;
  private failed = 0;
  private cancelled = 0;
  private latencies: number[] = [];

  recordRequest(): void {
    this.requests++;
  }

  recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > MAX_SAMPLES) {
      this.latencies.shift();
    }
  }

  recordShown(): void {
    this.shown++;
  }

  recordAccepted(): void {
    this.accepted++;
  }

  recordEmpty(): void {
    this.empty++;
  }

  recordFailed(): void {
    this.failed++;
  }

  recordCancelled(): void {
    this.cancelled++;
  }

  snapshot(): InlineCompletionStatsSnapshot {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return {
      requests: this.requests,
      shown: this.shown,
      accepted: this.accepted,
      empty: this.empty,
      failed: this.failed,
      cancelled: this.cancelled,
      acceptanceRate: this.shown ? this.accepted / this.shown : 0,
      latencyP50Ms: percentile(sorted, 0.5),
      latencyP95Ms: percentile(sorted, 0.95),
    };
  }

  format(): string {
    const s = this.snapshot();
    return [
      `requests ${s.requests}, shown ${s.shown}, accepted ${s.accepted} (${(s.acceptanceRate * 100).toFixed(1)}%)`,
      `empty ${s.empty}, failed ${s.failed}, cancelled ${s.cancelled}`,
      `latency p50 ${Math.round(s.latencyP50Ms)} ms, p95 ${Math.round(s.latencyP95Ms)} ms`,
    ].join("\n");
  }
}
