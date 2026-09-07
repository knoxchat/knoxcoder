/**
 * Tool Events - Event-driven tool execution system
 * 
 * Features:
 * - Publish/subscribe for tool events
 * - Reactive tool pipelines
 * - Event filtering and transformation
 * - Event history and replay
 * - Cross-pipeline communication
 */

import { createKnoxLogger } from "../../util/knoxLog.js";
import { ToolEvent, ToolEventSubscription, ToolEventType, PipelineConfig, PipelineContext } from "./types.js";

const log = createKnoxLogger("ToolEvents");

type EventHandler = (event: ToolEvent) => void | Promise<void>;

/**
 * Tool Event Emitter - Central event bus for tool orchestration
 */
export class ToolEventEmitter {
  private static instance: ToolEventEmitter;
  private subscriptions: Map<string, ToolEventSubscription> = new Map();
  private eventHistory: ToolEvent[] = [];
  private maxHistorySize: number = 1000;
  private handlers: Map<ToolEventType, Set<EventHandler>> = new Map();
  
  // Event processing queue for async handling
  private eventQueue: ToolEvent[] = [];
  private isProcessing: boolean = false;

  private constructor() {
    // Initialize handlers for all event types
    const eventTypes: ToolEventType[] = [
      'tool:start', 'tool:complete', 'tool:error', 'tool:retry',
      'tool:cache-hit', 'tool:cache-miss',
      'pipeline:start', 'pipeline:complete', 'pipeline:error', 'pipeline:rollback',
      'file:created', 'file:modified', 'file:deleted',
      'terminal:output', 'search:results', 'custom'
    ];
    
    for (const type of eventTypes) {
      this.handlers.set(type, new Set());
    }
  }

  public static getInstance(): ToolEventEmitter {
    if (!ToolEventEmitter.instance) {
      ToolEventEmitter.instance = new ToolEventEmitter();
    }
    return ToolEventEmitter.instance;
  }

  /**
   * Emit an event
   */
  emit(event: ToolEvent): void {
    // Add to history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Add to processing queue
    this.eventQueue.push(event);
    this.processQueue();
  }

  /**
   * Process the event queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.eventQueue.length > 0) {
      const event = this.eventQueue.shift()!;
      await this.dispatchEvent(event);
    }

    this.isProcessing = false;
  }

  /**
   * Dispatch event to handlers
   */
  private async dispatchEvent(event: ToolEvent): Promise<void> {
    // Call type-specific handlers
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          await handler(event);
        } catch (error) {
          console.error(`Event handler error for ${event.type}:`, error);
        }
      }
    }

    // Check subscriptions
    for (const subscription of this.subscriptions.values()) {
      if (this.matchesSubscription(event, subscription)) {
        try {
          // Execute handler
          if (subscription.handler) {
            // Create a minimal context for the handler
            const context = this.createMinimalContext();
            await subscription.handler(event, context);
          }
        } catch (error) {
          console.error(`Subscription handler error for ${subscription.id}:`, error);
        }
      }
    }
  }

  /**
   * Check if event matches subscription criteria
   */
  private matchesSubscription(event: ToolEvent, subscription: ToolEventSubscription): boolean {
    // Check event type
    if (!subscription.eventTypes.includes(event.type)) {
      return false;
    }

    // Apply filter if present
    if (subscription.filter && !subscription.filter(event)) {
      return false;
    }

    return true;
  }

  /**
   * Subscribe to events
   */
  subscribe(subscription: ToolEventSubscription): () => void {
    this.subscriptions.set(subscription.id, subscription);
    
    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(subscription.id);
    };
  }

  /**
   * Subscribe to a specific event type
   */
  on(eventType: ToolEventType, handler: EventHandler): () => void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.add(handler);
    }

    return () => {
      handlers?.delete(handler);
    };
  }

  /**
   * Subscribe once to an event type
   */
  once(eventType: ToolEventType, handler: EventHandler): () => void {
    const wrappedHandler: EventHandler = async (event) => {
      await handler(event);
      this.handlers.get(eventType)?.delete(wrappedHandler);
    };

    return this.on(eventType, wrappedHandler);
  }

  /**
   * Get event history
   */
  getHistory(filter?: {
    types?: ToolEventType[];
    source?: string;
    since?: number;
    limit?: number;
  }): ToolEvent[] {
    let events = [...this.eventHistory];

    if (filter?.types) {
      events = events.filter(e => filter.types!.includes(e.type));
    }

    if (filter?.source) {
      events = events.filter(e => e.source === filter.source);
    }

    if (filter?.since) {
      events = events.filter(e => e.timestamp >= filter.since!);
    }

    if (filter?.limit) {
      events = events.slice(-filter.limit);
    }

    return events;
  }

  /**
   * Replay events from history
   */
  async replay(events: ToolEvent[]): Promise<void> {
    for (const event of events) {
      await this.dispatchEvent(event);
    }
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Create minimal context for subscription handlers
   */
  private createMinimalContext(): PipelineContext {
    return {
      pipelineId: 'event-handler',
      results: new Map(),
      variables: new Map(),
      startTime: Date.now(),
      currentStep: 0,
      totalSteps: 0,
      abortController: new AbortController(),
      extras: null as any, // Will need to be provided by actual context
      metadata: {}
    };
  }

  /**
   * Get subscription by ID
   */
  getSubscription(id: string): ToolEventSubscription | undefined {
    return this.subscriptions.get(id);
  }

  /**
   * List all subscriptions
   */
  listSubscriptions(): ToolEventSubscription[] {
    return [...this.subscriptions.values()];
  }
}

/**
 * Event subscription builder for fluent API
 */
export class EventSubscriptionBuilder {
  private subscription: Partial<ToolEventSubscription> = {};

  constructor(id: string) {
    this.subscription.id = id;
    this.subscription.eventTypes = [];
  }

  /**
   * Subscribe to event types
   */
  onEvents(...types: ToolEventType[]): this {
    this.subscription.eventTypes = types;
    return this;
  }

  /**
   * Add filter
   */
  filter(filterFn: (event: ToolEvent) => boolean): this {
    this.subscription.filter = filterFn;
    return this;
  }

  /**
   * Filter by source
   */
  fromSource(source: string): this {
    const existingFilter = this.subscription.filter;
    this.subscription.filter = (event) => {
      if (event.source !== source) return false;
      if (existingFilter) return existingFilter(event);
      return true;
    };
    return this;
  }

  /**
   * Filter by payload property
   */
  wherePayload(predicate: (payload: any) => boolean): this {
    const existingFilter = this.subscription.filter;
    this.subscription.filter = (event) => {
      if (!predicate(event.payload)) return false;
      if (existingFilter) return existingFilter(event);
      return true;
    };
    return this;
  }

  /**
   * Set handler
   */
  handle(handler: (event: ToolEvent, context: PipelineContext) => Promise<void>): this {
    this.subscription.handler = handler;
    return this;
  }

  /**
   * Trigger pipeline on event
   */
  triggerPipeline(pipeline: PipelineConfig): this {
    this.subscription.pipeline = pipeline;
    return this;
  }

  /**
   * Build and register subscription
   */
  register(): () => void {
    const emitter = ToolEventEmitter.getInstance();
    return emitter.subscribe(this.subscription as ToolEventSubscription);
  }
}

/**
 * Create a new event subscription
 */
export function onToolEvent(id: string): EventSubscriptionBuilder {
  return new EventSubscriptionBuilder(id);
}

/**
 * Reactive tool chain - Execute tools in response to events
 */
export class ReactiveToolChain {
  private triggers: Map<ToolEventType, PipelineConfig[]> = new Map();
  private emitter: ToolEventEmitter;

  constructor() {
    this.emitter = ToolEventEmitter.getInstance();
  }

  /**
   * Add a trigger: when event occurs, execute pipeline
   */
  when(eventType: ToolEventType): ReactiveTriggerBuilder {
    return new ReactiveTriggerBuilder(this, eventType);
  }

  /**
   * Register a trigger internally
   */
  registerTrigger(eventType: ToolEventType, pipeline: PipelineConfig): void {
    if (!this.triggers.has(eventType)) {
      this.triggers.set(eventType, []);
    }
    this.triggers.get(eventType)!.push(pipeline);
  }

  /**
   * Start listening for events
   */
  start(): () => void {
    const unsubscribers: (() => void)[] = [];

    for (const [eventType, pipelines] of this.triggers.entries()) {
      const unsubscribe = this.emitter.on(eventType, async (event) => {
        for (const pipeline of pipelines) {
          // Would execute the pipeline here
          log.debug(`Triggering pipeline ${pipeline.id} for event ${event.type}`);
        }
      });
      unsubscribers.push(unsubscribe);
    }

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }
}

/**
 * Builder for reactive triggers
 */
class ReactiveTriggerBuilder {
  constructor(
    private chain: ReactiveToolChain,
    private eventType: ToolEventType
  ) {}

  /**
   * Execute pipeline when event occurs
   */
  execute(pipeline: PipelineConfig): ReactiveToolChain {
    this.chain.registerTrigger(this.eventType, pipeline);
    return this.chain;
  }
}

/**
 * Debounced event handler - Prevents rapid fire
 */
export function debounceEvents(
  handler: EventHandler,
  delayMs: number
): EventHandler {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastEvent: ToolEvent | null = null;

  return (event: ToolEvent) => {
    lastEvent = event;
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      if (lastEvent) {
        handler(lastEvent);
      }
      timeoutId = null;
      lastEvent = null;
    }, delayMs);
  };
}

/**
 * Throttled event handler - Rate limits events
 */
export function throttleEvents(
  handler: EventHandler,
  intervalMs: number
): EventHandler {
  let lastExecuted = 0;
  let pendingEvent: ToolEvent | null = null;
  let timeoutId: NodeJS.Timeout | null = null;

  return (event: ToolEvent) => {
    const now = Date.now();
    const timeSinceLastExecution = now - lastExecuted;

    if (timeSinceLastExecution >= intervalMs) {
      lastExecuted = now;
      handler(event);
    } else {
      pendingEvent = event;
      
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          if (pendingEvent) {
            lastExecuted = Date.now();
            handler(pendingEvent);
            pendingEvent = null;
          }
          timeoutId = null;
        }, intervalMs - timeSinceLastExecution);
      }
    }
  };
}

/**
 * Batch events handler - Collects events and processes in batches
 */
export function batchEvents(
  handler: (events: ToolEvent[]) => void | Promise<void>,
  options: {
    maxBatchSize?: number;
    maxWaitMs?: number;
  } = {}
): EventHandler {
  const maxBatchSize = options.maxBatchSize || 10;
  const maxWaitMs = options.maxWaitMs || 100;
  
  let batch: ToolEvent[] = [];
  let timeoutId: NodeJS.Timeout | null = null;

  const flush = async () => {
    if (batch.length > 0) {
      const toProcess = [...batch];
      batch = [];
      await handler(toProcess);
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return async (event: ToolEvent) => {
    batch.push(event);

    if (batch.length >= maxBatchSize) {
      await flush();
    } else if (!timeoutId) {
      timeoutId = setTimeout(flush, maxWaitMs);
    }
  };
}
