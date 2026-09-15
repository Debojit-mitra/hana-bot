import logger from "../../utils/logger.js";
import { executeTool, aiTools } from "./ai.tools.js";
import { AIChatModel } from "../../db/models/AIChat.js";
import { getEnvConfig } from "../../config/env.js";
import { getMemoriesForPrompt } from "./memory.service.js";
import type { CommandContext } from "../../types/index.js";
import { AIRateLimiter, TaskQueue } from "../../core/queue.js";

const rateLimiter = new AIRateLimiter(
  () => getEnvConfig().ai.model,
  () => getEnvConfig().ai.fallbackModel,
  () => getEnvConfig().ai.rpmLimit,
);

const toolQueue = new TaskQueue(2); // Limit concurrent tools to 2 to protect server resources

/**
 * Abstract AI provider interface.
 * Implement this to add support for different AI services.
 */
export interface AIProvider {
  readonly name: string;
  ask(
    question: string,
    context?: string,
    sessionId?: string,
    ctx?: CommandContext,
  ): Promise<string>;
}

/**
 * Noop provider — used when AI is not configured.
 */
export class NoopProvider implements AIProvider {
  readonly name = "none";

  async ask(
    _question: string,
    _context?: string,
    _sessionId?: string,
    _ctx?: CommandContext,
  ): Promise<string> {
    return "🤖 AI is not configured.\nSet `AI_PROVIDER` and `AI_API_KEY` in your `.env` file.";
  }
}

/**
 * Gemini AI provider (placeholder — implement with actual API).
 */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(
    apiKey: string,
    model: string = "gemini-pro",
    baseUrl: string = "https://generativelanguage.googleapis.com",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async ask(
    question: string,
    context?: string,
    sessionId: string = "default",
    ctx?: CommandContext,
  ): Promise<string> {
    let systemPrompt = context
      ? `You are Hana, a quirky and precise server management bot assistant. Context: ${context}`
      : "You are Hana, a quirky and precise server management bot assistant. You have access to tools that check the actual status of this server and external servers. If you do not have the data or do not know the answer, say so directly—do NOT invent or hallucinate random data. Keep responses concise, precise, slightly funny, and beautifully formatted for WhatsApp (use *bold* and _italic_).";

    systemPrompt +=
      "\n\n## WhatsApp formatting:\n" +
      "- Format naturally for WhatsApp. Use *bold*, _italic_, and `inline code`.\n" +
      "- Use `-` or `*` for bullets and `1.` for numbered lists.\n" +
      "- Use `> text` for quotes or specific callouts. Use this for quotes or warnings or any important information.\n" +
      "- Never use Markdown headers (`#`, `##`). Use *bold text* instead.\n" +
      "\n## Communication rules:\n" +
      "- NEVER mention your internal tool or function names (e.g., `get_system_stats`, `save_memory`, etc.) to the user. Describe what you can do in natural, conversational language.";

    // Fetch and inject persistent memories into system prompt
    if (ctx?.sender) {
      const memoriesBlock = await getMemoriesForPrompt(ctx.sender);
      if (memoriesBlock) {
        systemPrompt += `\n\n${memoriesBlock}`;
      }

      systemPrompt +=
        `\n\n## Memory rules:\n` +
        `- If an admin/owner explicitly asks you to remember something, use save_memory with source="explicit".\n` +
        `- If a regular user asks you to remember something, politely decline ("Only admins can ask me to remember things!"). But you can still auto-save important facts.\n` +
        `- If you notice genuinely useful facts (names, preferences, server details, IPs and more things not just related to CS), proactively save them using save_memory with source="auto". Do this sparingly, only for truly important info.\n` +
        `- CRITICAL: Do NOT save information about a user's role (admin, whitelisted), their phone number/JID, or their alias to memory. You are already provided this information automatically on every message context.\n` +
        `- When saving, decide if it's user-specific (scope="user") or shared knowledge (scope="global").\n` +
        `- Save memories as concise factual statements. Be clear but don't pad them unnecessarily.\n` +
        `- If an admin/owner asks you to forget something, use delete_memory. Regular users cannot delete memories.\n` +
        `- If the user asks what you remember, use recall_memories.`;
    }

    // Retrieve session history from MongoDB
    let chatDoc = await AIChatModel.findOne({ sessionId });
    if (!chatDoc) {
      chatDoc = new AIChatModel({ sessionId, messages: [] });
    }

    // Add user message to history
    chatDoc.messages.push({
      role: "user",
      parts: [{ text: question }],
    });

    const envConfig = getEnvConfig();
    const maxMessages = envConfig.ai.historyMaxMessages || 50;

    // Trim history if it gets too long (safe boundary-aware trim)
    this.trimHistory(chatDoc, maxMessages);

    // Build tools payload
    const toolsPayload = [
      {
        functionDeclarations: aiTools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];

    try {
      return await this.executeGeminiRequest(
        sessionId,
        systemPrompt,
        toolsPayload,
        chatDoc,
        ctx,
        0, // recursion depth
      );
    } catch (err: any) {
      // Detect corrupted history and guide the user to fix it
      if (err.message?.includes("400")) {
        logger.warn({ sessionId }, "Corrupted chat history detected");
        return `⚠️ Oops! My conversation history got a little tangled up.\n\nPlease send \`!hana clear\` to reset it, then try your message again!`;
      }
      logger.error({ err }, "Gemini API call failed");
      return `❌ AI error: ${err.message}`;
    }
  }

  private async executeGeminiRequest(
    sessionId: string,
    systemInstruction: string,
    tools: any[],
    chatDoc: any,
    ctx?: CommandContext,
    depth: number = 0,
  ): Promise<string> {
    const MAX_TOOL_DEPTH = 5;

    // Sanitize history: strip orphaned function call turns at the end
    this.sanitizeHistory(chatDoc.messages);
    const history = chatDoc.messages;

    const requestBody = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: history,
      tools: tools,
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.7,
      },
    };

    const response = await rateLimiter.execute(
      ctx?.jid || "global",
      async (selectedModel: string) => {
        const res = await fetch(
          `${this.baseUrl}/v1beta/models/${selectedModel}:generateContent?key=${this.apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          },
        );

        if (!res.ok) {
          const error = await res.text();
          logger.error(
            { status: res.status, error, selectedModel },
            "Gemini API error",
          );
          throw new Error(`${res.status} ${res.statusText}`);
        }
        return res;
      },
      async (waitSec: number) => {
        if (ctx?.sock && ctx.jid) {
          await ctx.sock.sendMessage(ctx.jid, {
            text: `⏳ *Whoa there!* I'm processing too many requests right now.\nYour message is safely queued and will be answered in about *${waitSec} seconds*...`,
          });
        }
      },
    );

    const data = (await response.json()) as any;
    const candidate = data?.candidates?.[0];

    if (!candidate) {
      // Save history even on empty response to avoid losing the user message
      chatDoc.markModified("messages");
      await chatDoc.save();
      return "❌ AI returned an empty response.";
    }

    const parts = candidate.content?.parts || [];
    const functionCallParts = parts.filter((p: any) => p.functionCall);

    if (functionCallParts.length > 0) {
      // Guard against runaway tool loops
      if (depth >= MAX_TOOL_DEPTH) {
        logger.warn(
          { sessionId, depth },
          "Max tool recursion depth reached, returning last response",
        );
        const lastText = parts.find((p: any) => p.text)?.text;
        chatDoc.markModified("messages");
        await chatDoc.save();
        return (
          lastText ||
          "⚠️ I got stuck in a tool loop. Please try rephrasing your question."
        );
      }

      // Switch reaction to hourglass to indicate it's running a tool
      // But don't do this for memory tools, so memory saving feels seamless
      const memoryToolNames = [
        "save_memory",
        "recall_memories",
        "delete_memory",
      ];
      const hasSlowTool = functionCallParts.some(
        (p: any) => !memoryToolNames.includes(p.functionCall.name),
      );

      if (hasSlowTool && ctx?.react) {
        await ctx.react("⏳");
      }

      // Save the model's exact response to history (preserves thought_signatures and multiple parts)
      history.push({
        role: "model",
        parts: candidate.content.parts,
      });

      // Execute all requested tools
      const functionResponseParts = [];

      for (const part of functionCallParts) {
        const funcName = part.functionCall.name;
        const funcArgs = part.functionCall.args || {};
        const funcId = part.functionCall.id;

        logger.info({ funcName, funcArgs }, "AI requested tool execution");

        let result;
        try {
          result = await toolQueue.enqueue(() =>
            executeTool(funcName, funcArgs, ctx),
          );
        } catch (err: any) {
          logger.error({ err, funcName }, "Tool execution failed");
          result = { error: err.message };
        }

        // Ensure result is an object (Gemini API requirement)
        if (
          Array.isArray(result) ||
          typeof result !== "object" ||
          result === null
        ) {
          result = { value: result };
        }

        functionResponseParts.push({
          functionResponse: {
            ...(funcId && { id: funcId }),
            name: funcName,
            response: result,
          },
        });
      }

      // Save the function responses to history
      history.push({
        role: "user", // Gemini expects function responses to have the 'user' role
        parts: functionResponseParts,
      });

      // Recursively call the model again with the new history
      return this.executeGeminiRequest(
        sessionId,
        systemInstruction,
        tools,
        chatDoc,
        ctx,
        depth + 1,
      );
    }

    // Standard text response
    const textPart = parts.find((p: any) => p.text);
    const text = textPart?.text;
    if (text) {
      // Save model response to history
      history.push({
        role: "model",
        parts: [{ text }],
      });

      // Trim history again after tool-call rounds may have added extra entries
      const envConfig = getEnvConfig();
      const maxMessages = envConfig.ai.historyMaxMessages || 50;
      this.trimHistory(chatDoc, maxMessages);

      // Persist final conversation state to DB
      chatDoc.markModified("messages");
      await chatDoc.save();

      return text;
    }

    // Save history even on unknown/empty response to avoid losing the user message
    chatDoc.markModified("messages");
    await chatDoc.save();
    return text || "";
  }

  /**
   * Sanitize chat history by removing orphaned function call turns.
   * Gemini requires: user → model(functionCall) → user(functionResponse) → ...
   * If the last model turn has functionCall parts but there's no following
   * functionResponse, the history is corrupted and we strip those entries.
   */
  private sanitizeHistory(messages: any[]): void {
    while (messages.length > 0) {
      const last = messages[messages.length - 1];

      // If the last entry is a model turn with functionCall parts, it's orphaned
      if (
        last.role === "model" &&
        last.parts?.some((p: any) => p.functionCall)
      ) {
        logger.warn(
          { removed: last.parts.length },
          "Stripping orphaned functionCall turn from history",
        );
        messages.pop();
        continue;
      }

      // If the last entry is a user turn with functionResponse parts but no
      // preceding model functionCall, also strip it
      if (
        last.role === "user" &&
        last.parts?.some((p: any) => p.functionResponse)
      ) {
        const prev =
          messages.length >= 2 ? messages[messages.length - 2] : null;
        if (
          !prev ||
          prev.role !== "model" ||
          !prev.parts?.some((p: any) => p.functionCall)
        ) {
          logger.warn("Stripping orphaned functionResponse turn from history");
          messages.pop();
          continue;
        }
      }

      break;
    }
  }

  /**
   * Trim history to maxMessages while ensuring we never cut in the middle
   * of a functionCall/functionResponse sequence. After slicing, strip any
   * leading entries that aren't a clean user-text turn so the history
   * always starts with a proper user message.
   */
  private trimHistory(chatDoc: any, maxMessages: number): void {
    if (chatDoc.messages.length <= maxMessages) return;

    // Rough slice first
    chatDoc.messages = chatDoc.messages.slice(
      chatDoc.messages.length - maxMessages,
    );

    // Strip from the front until we land on a user turn with actual text content
    // (not a functionResponse-only turn which would be orphaned after slicing)
    while (chatDoc.messages.length > 0) {
      const first = chatDoc.messages[0];
      const hasFunctionResponse = first.parts?.some(
        (p: any) => p.functionResponse,
      );
      const isUserText = first.role === "user" && !hasFunctionResponse;
      if (isUserText) break;
      chatDoc.messages.shift();
    }
  }
}

/**
 * OpenAI-compatible provider (works with OpenAI, Ollama, etc.).
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name: string;
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(name: string, apiKey: string, model: string, baseUrl: string) {
    this.name = name;
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async ask(
    question: string,
    context?: string,
    sessionId?: string,
    ctx?: CommandContext,
  ): Promise<string> {
    try {
      let systemPrompt = context
        ? `You are Hana, a helpful server management bot assistant. Context: ${context}`
        : "You are Hana, a helpful server management bot assistant. Keep responses concise and beautifully formatted for WhatsApp.";

      systemPrompt +=
        "\n\n## WhatsApp formatting:\n" +
        "- Format naturally for WhatsApp. Use *bold*, _italic_, and `inline code`.\n" +
        "- Use `-` or `*` for bullets and `1.` for numbered lists.\n" +
        "- Use `> text` for quotes or specific callouts. Use this for quotes or warnings or any important information.\n" +
        "- Never use Markdown headers (`#`, `##`). Use *bold text* instead.\n";

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: question },
          ],
          max_tokens: 1024,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error(
          { status: response.status, error },
          `${this.name} API error`,
        );
        return `❌ AI error: ${response.status} ${response.statusText}`;
      }

      const data = (await response.json()) as any;
      const text = data?.choices?.[0]?.message?.content;

      if (!text) {
        return "❌ AI returned an empty response.";
      }

      return text;
    } catch (err: any) {
      logger.error({ err }, `${this.name} API call failed`);
      return `❌ AI error: ${err.message}`;
    }
  }
}

// ─── Provider Factory ───────────────────────────────────────────────────────

let currentProvider: AIProvider = new NoopProvider();

/**
 * Initialize the AI provider based on config.
 */
export function initAIProvider(
  provider: string,
  apiKey: string,
  model: string,
  baseUrl: string,
): AIProvider {
  switch (provider) {
    case "gemini":
      currentProvider = new GeminiProvider(
        apiKey,
        model || "gemini-pro",
        baseUrl || "https://generativelanguage.googleapis.com",
      );
      break;

    case "openai":
      currentProvider = new OpenAICompatibleProvider(
        "OpenAI",
        apiKey,
        model || "gpt-4o-mini",
        baseUrl || "https://api.openai.com/v1",
      );
      break;

    case "claude":
      // Claude uses a different API format, but anthropic has an OpenAI-compatible endpoint
      currentProvider = new OpenAICompatibleProvider(
        "Claude",
        apiKey,
        model || "claude-3-haiku-20240307",
        baseUrl || "https://api.anthropic.com/v1",
      );
      break;

    case "ollama":
      currentProvider = new OpenAICompatibleProvider(
        "Ollama",
        "", // Ollama doesn't need an API key
        model || "llama3",
        baseUrl || "http://localhost:11434/v1",
      );
      break;

    default:
      currentProvider = new NoopProvider();
  }

  logger.info({ provider: currentProvider.name }, "AI provider initialized");
  return currentProvider;
}

/**
 * Get the current AI provider.
 */
export function getAIProvider(): AIProvider {
  return currentProvider;
}
