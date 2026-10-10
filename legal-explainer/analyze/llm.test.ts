/**
 * Tests for analyze/llm.ts. Run from the repo root:  npx tsx --test analyze/llm.test.ts
 * The Agent is mocked, so these tests never touch the network and never load the SDK.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LLM_TIMEOUT_MS,
  LlmError,
  createCallLlm,
  type LlmAgent,
  type LlmAgentConfig,
} from "./llm";

const SECRET_KEY = "sk-test-SECRET-KEY-123";
const SECRET_TEXT = "CONFIDENTIAL CLAUSE TEXT 98765";
const ENV = { CLINE_PROVIDER_ID: "Cline", CLINE_MODEL_ID: "test/model-1", CLINE_API_KEY: SECRET_KEY };

type RunResult = Awaited<ReturnType<LlmAgent["run"]>>;
type RunImpl = (input: string) => Promise<RunResult>;

const ok = (outputText: string): RunResult => ({ status: "completed", outputText });

function setup(run: RunImpl, env: Record<string, string | undefined> = ENV, timeoutMs = 1000) {
  const configs: LlmAgentConfig[] = [];
  const agents: { aborted: number; inputs: string[] }[] = [];
  const callLlm = createCallLlm({
    env,
    timeoutMs,
    createAgent: (config) => {
      configs.push(config);
      const state = { aborted: 0, inputs: [] as string[] };
      agents.push(state);
      const agent: LlmAgent = {
        run: (input) => {
          state.inputs.push(input);
          return run(input);
        },
        abort: () => {
          state.aborted += 1;
        },
      };
      return agent;
    },
  });
  return { callLlm, configs, agents };
}

/** Asserts a rejection with this code and a message that leaks none of the sensitive strings. */
async function rejectsSafely(promise: Promise<string>, code: string): Promise<LlmError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof LlmError, "expected an LlmError");
  assert.equal(caught.code, code);
  for (const secret of [SECRET_KEY, SECRET_TEXT, "SYSTEM PROMPT", "USER PROMPT"]) {
    assert.ok(!caught.message.includes(secret), "message leaks sensitive text");
  }
  return caught;
}

describe("callLlm: success", () => {
  it("returns outputText and configures the Agent as agreed", async () => {
    const { callLlm, configs } = setup(async () => ok('{"ok":true}'));
    assert.equal(await callLlm("SYSTEM PROMPT", "USER PROMPT"), '{"ok":true}');
    assert.equal(configs.length, 1);
    assert.deepEqual(configs[0], {
      providerId: "cline", // lowercased in code
      modelId: "test/model-1",
      apiKey: SECRET_KEY,
      systemPrompt: "SYSTEM PROMPT",
      maxIterations: 1,
      tools: [],
    });
  });

  it("sends the user prompt as the run input", async () => {
    const { callLlm, agents } = setup(async () => ok("x"));
    await callLlm("s", "USER PROMPT");
    assert.deepEqual(agents[0]?.inputs, ["USER PROMPT"]);
  });

  it("creates a NEW Agent for every call", async () => {
    const { callLlm, configs, agents } = setup(async () => ok("x"));
    await callLlm("s", "u1");
    await callLlm("s", "u2");
    assert.equal(configs.length, 2);
    assert.equal(agents.length, 2);
  });

  it("does not abort a call that finishes in time", async () => {
    const { callLlm, agents } = setup(async () => ok("x"));
    await callLlm("s", "u");
    assert.equal(agents[0]?.aborted, 0);
  });
});

describe("callLlm: configuration", () => {
  for (const name of ["CLINE_PROVIDER_ID", "CLINE_MODEL_ID", "CLINE_API_KEY"] as const) {
    it(`throws naming ${name} (never a value) when it is missing`, async () => {
      const env: Record<string, string | undefined> = { ...ENV, [name]: undefined };
      const { callLlm, configs } = setup(async () => ok("x"), env);
      const error = await rejectsSafely(callLlm("s", "u"), "not_configured");
      assert.ok(error.message.includes(name));
      for (const other of Object.values(ENV)) assert.ok(!error.message.includes(other));
      assert.equal(configs.length, 0, "no Agent should be created");
    });
  }

  it("treats a blank value as missing and names every missing variable", async () => {
    const env = { CLINE_PROVIDER_ID: "  ", CLINE_MODEL_ID: "", CLINE_API_KEY: SECRET_KEY };
    const { callLlm } = setup(async () => ok("x"), env);
    const error = await rejectsSafely(callLlm("s", "u"), "not_configured");
    assert.ok(error.message.includes("CLINE_PROVIDER_ID") && error.message.includes("CLINE_MODEL_ID"));
  });
});

describe("callLlm: failures give short generic errors", () => {
  it("wraps a thrown SDK error without copying its message", async () => {
    const { callLlm } = setup(async () => {
      throw new Error(`401 for key ${SECRET_KEY} on ${SECRET_TEXT}`);
    });
    const error = await rejectsSafely(callLlm("SYSTEM PROMPT", "USER PROMPT"), "failed");
    assert.equal(error.message, "LLM request failed");
  });

  it("wraps a non-Error throw", async () => {
    const { callLlm } = setup(async () => {
      throw SECRET_TEXT;
    });
    await rejectsSafely(callLlm("s", "u"), "failed");
  });

  it("wraps an error thrown while creating the Agent", async () => {
    const callLlm = createCallLlm({
      env: ENV,
      createAgent: () => {
        throw new Error(SECRET_KEY);
      },
    });
    await rejectsSafely(callLlm("s", "u"), "failed");
  });

  it("fails when status is not completed", async () => {
    for (const status of ["failed", "aborted"]) {
      const { callLlm } = setup(async () => ({ status, outputText: "partial" }));
      await rejectsSafely(callLlm("s", "u"), "failed");
    }
  });

  it("fails when error is set even if status says completed, without copying its message", async () => {
    const { callLlm } = setup(async () => ({
      status: "completed",
      outputText: "text",
      error: new Error(SECRET_TEXT),
    }));
    const error = await rejectsSafely(callLlm("s", "u"), "failed");
    assert.equal(error.message, "LLM request failed");
  });

  it("reports an exceeded maxIterations error with its own code, still without copying text", async () => {
    const thrown = setup(async () => {
      throw new Error(`Agent runtime exceeded maxIterations (1) ${SECRET_TEXT}`);
    });
    const error = await rejectsSafely(thrown.callLlm("s", "u"), "max_iterations");
    assert.equal(error.message, "LLM did not finish within the iteration limit");

    const returned = setup(async () => ({
      status: "failed",
      outputText: "",
      error: new Error("Agent runtime exceeded maxIterations (1)"),
    }));
    await rejectsSafely(returned.callLlm("s", "u"), "max_iterations");
  });

  it("never retries by itself: one call means one run", async () => {
    const { callLlm, agents } = setup(async () => {
      throw new Error("exceeded maxIterations");
    });
    await rejectsSafely(callLlm("s", "u"), "max_iterations");
    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.inputs.length, 1);
  });
});

describe("callLlm: empty output", () => {
  it("throws when outputText is empty or only whitespace", async () => {
    for (const outputText of ["", "   \n\t "]) {
      const { callLlm } = setup(async () => ok(outputText));
      const error = await rejectsSafely(callLlm("s", "u"), "empty");
      assert.equal(error.message, "LLM returned an empty response");
    }
  });
});

describe("callLlm: default timeout", () => {
  it("LLM_TIMEOUT_MS is 180 seconds", () => {
    assert.equal(LLM_TIMEOUT_MS, 180_000);
  });

  it("uses LLM_TIMEOUT_MS when no timeout is given (fake timers, no waiting)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let aborted = 0;
    const callLlm = createCallLlm({
      env: ENV,
      createAgent: () => ({
        run: () => new Promise<RunResult>(() => {}),
        abort: () => {
          aborted += 1;
        },
      }),
    });

    let settled: "pending" | "resolved" | "rejected" = "pending";
    let code = "";
    callLlm("s", "u").then(
      () => {
        settled = "resolved";
      },
      (error: unknown) => {
        settled = "rejected";
        code = error instanceof LlmError ? error.code : "other";
      },
    );
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

    await flush();
    t.mock.timers.tick(LLM_TIMEOUT_MS - 1);
    await flush();
    assert.equal(settled, "pending", "must not time out before the limit");
    assert.equal(aborted, 0);

    t.mock.timers.tick(1);
    await flush();
    assert.equal(settled, "rejected");
    assert.equal(code, "timeout");
    assert.equal(aborted, 1);
  });
});

describe("callLlm: timeout", () => {
  it("aborts the Agent and rejects when the call takes too long", async () => {
    const { callLlm, agents } = setup(() => new Promise<RunResult>(() => {}), ENV, 30);
    const error = await rejectsSafely(callLlm("s", "u"), "timeout");
    assert.equal(error.message, "LLM request timed out");
    assert.equal(agents[0]?.aborted, 1);
  });

  it("still times out if abort() itself throws", async () => {
    const callLlm = createCallLlm({
      env: ENV,
      timeoutMs: 30,
      createAgent: () => ({
        run: () => new Promise<RunResult>(() => {}),
        abort: () => {
          throw new Error("abort failed");
        },
      }),
    });
    await rejectsSafely(callLlm("s", "u"), "timeout");
  });

  it("ignores a result that arrives after the timeout", async () => {
    const { callLlm } = setup(
      () => new Promise<RunResult>((resolve) => setTimeout(() => resolve(ok("late")), 80)),
      ENV,
      20,
    );
    await rejectsSafely(callLlm("s", "u"), "timeout");
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
});

