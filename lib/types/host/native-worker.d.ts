import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { MessageId } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { PhysicalRoute } from '../contracts.js';
export interface NativeWorkerRequest {
    readonly childId: string;
    readonly label: string;
    /** Model-authored brief from the Lead's native tool call. */
    readonly brief: string;
    readonly route: PhysicalRoute;
    /** 0.2.0 startContinuable persona. 0.2.1 rejects it; the role scope carries the prompt. */
    readonly persona: string;
    /** 0.2.0 start-time tool ceiling. 0.2.1 rejects toolFilter; the role scope narrows tools. */
    readonly allowedTools: readonly string[];
}
export interface NativeWorkerAcceptance {
    readonly childId: string;
    readonly messageId: MessageId;
}
interface WorkerStartRequest {
    readonly parent: Agent;
    readonly prompt: readonly {
        readonly type: 'text';
        readonly text: string;
    }[];
    readonly agentOptions: {
        readonly provider: string;
        readonly model: string;
        readonly reasoningEffort?: ReturnType<typeof ReasoningEffortId>;
    };
    readonly maxDepth: number;
    readonly persona?: string;
    readonly toolFilter?: {
        readonly allow: readonly string[];
    };
}
interface StartedWorker {
    readonly childId: string;
    readonly messageId?: MessageId;
}
/** Structural view of the two DSH subagent seams. Only the branch that exists is called. */
export interface SubagentSeam {
    startActivation?(spec: {
        readonly provider: string;
        readonly label: string;
        readonly childId: ReturnType<typeof SessionId>;
        readonly delivery: 'parent';
        readonly request: WorkerStartRequest;
        readonly signal: AbortSignal;
        /** 0.2.2 flat spec shape — host call sites pass parent/prompt/agentOptions
         *  directly instead of nested under `request`. Sending both keeps 0.2.1
         *  and 0.2.2 compatible; the unused shape is ignored. */
        readonly parent?: WorkerStartRequest['parent'];
        readonly prompt?: WorkerStartRequest['prompt'];
        readonly agentOptions?: WorkerStartRequest['agentOptions'];
        readonly maxDepth?: WorkerStartRequest['maxDepth'];
    }): Promise<StartedWorker>;
    startContinuable?(spec: {
        readonly provider: string;
        readonly label: string;
        readonly childId: ReturnType<typeof SessionId>;
        readonly request: WorkerStartRequest;
        readonly signal: AbortSignal;
    }): Promise<StartedWorker>;
    drainChildren?(parent: Agent, childIds: readonly ReturnType<typeof SessionId>[]): Promise<void>;
    drainContinuableChildren?(parent: Agent, childIds: readonly ReturnType<typeof SessionId>[]): Promise<void>;
}
/** Version-pinned public API adapter. It never calls an LLM adapter or runs a shell itself. */
export declare class NativeWorkerTransport {
    #private;
    private readonly ctx;
    private readonly provider;
    constructor(ctx: Context, provider?: string);
    assertAvailable(): void;
    /** Caller durably reserves the child and operation before entering this method. */
    start(parent: Agent, request: NativeWorkerRequest, signal: AbortSignal): Promise<NativeWorkerAcceptance>;
    /** Only Lead-authored feedback is sent through this public model-message API. */
    continue(parent: Agent, childId: string, feedback: string, signal: AbortSignal): Promise<NativeWorkerAcceptance>;
    /**
     * Replace an in-flight generation through public cancellation, then deliver
     * to the same durable child. The caller must first exclude live/unknown
     * effectful tools. Otherwise use continue(), which steers at a step boundary.
     */
    interruptAndContinue(parent: Agent, childId: string, feedback: string, signal: AbortSignal): Promise<NativeWorkerAcceptance>;
    /** Interrupt acceptance is insufficient: wait for the exact native Agent to settle and flush. */
    settle(parent: Agent, childId: string, signal: AbortSignal): Promise<Agent>;
    /** Yield a blocking tool to native user steering without canceling or releasing the Worker. */
    settle(parent: Agent, childId: string, signal: AbortSignal, yieldToSteering: true): Promise<Agent | undefined>;
    stop(parent: Agent, childId: string): Promise<Agent>;
    /** Native release owns quiescence, persistence and handle disposal across HMR. */
    release(parent: Agent, childId: string): Promise<void>;
}
export {};
