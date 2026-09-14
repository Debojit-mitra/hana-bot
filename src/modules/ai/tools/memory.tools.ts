import { saveMemory, listMemories, deleteMemoryByContent } from "../memory.service.js";
import { isAdmin } from "../../../core/auth.js";
import type { AITool } from "../ai.tools.js";
import type { CommandContext } from "../../../types/index.js";

export const memoryTools: AITool[] = [
  {
    name: "save_memory",
    description:
      'Save an important fact or piece of information to persistent memory. Use this when: (1) an admin/owner explicitly asks you to remember something, or (2) you notice a genuinely useful fact worth remembering (like a user\'s name, preference, or server details and many more even things not related to just CS). Save memories as concise factual statements. Choose scope "user" for personal facts, "global" for shared knowledge.',
    parameters: {
      type: "OBJECT",
      properties: {
        content: {
          type: "STRING",
          description:
            'The memory to save, as a concise factual statement (e.g. "Prefers WEBP format", "Main server IP: 192.168.1.50")',
        },
        scope: {
          type: "STRING",
          description:
            'Memory scope: "user" for personal facts about this user, "global" for shared knowledge anyone can see',
          enum: ["user", "global"],
        },
        category: {
          type: "STRING",
          description:
            "Optional category tag: preference, fact, instruction, or general",
          enum: ["preference", "fact", "instruction", "general"],
        },
        source: {
          type: "STRING",
          description:
            'Whether this was explicitly requested by the user ("explicit") or you decided to save it on your own ("auto")',
          enum: ["explicit", "auto"],
        },
      },
      required: ["content", "scope", "source"],
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) {
        return { error: "No command context available" };
      }

      const isExplicit = args.source === "explicit";

      // Only admins/owners can explicitly ask to remember things
      if (isExplicit && !isAdmin(ctx.sender)) {
        return {
          error:
            'Only admins can explicitly ask you to remember things. Tell the user politely. However, you can still save important facts automatically using source="auto".',
        };
      }

      try {
        const isGlobal = args.scope === "global";
        const result = await saveMemory(
          ctx.sender,
          args.content,
          args.category || "general",
          args.source || "explicit",
          isGlobal,
        );

        if (!result) {
          return {
            result: "A similar memory already exists, no need to save again.",
          };
        }

        return {
          result: `Memory saved successfully (${args.scope}): "${args.content}"`,
        };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  },
  {
    name: "recall_memories",
    description:
      "Retrieve all saved memories. Call this when the user asks what you remember about them, or when you need to check existing memories before saving a new one.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) {
        return { error: "No command context available" };
      }

      const memories = await listMemories(ctx.sender);

      return {
        userMemories: memories.user.map((m) => ({
          content: m.content,
          category: m.category,
          source: m.source,
        })),
        globalMemories: memories.global.map((m) => ({
          content: m.content,
          category: m.category,
          source: m.source,
        })),
        totalUser: memories.user.length,
        totalGlobal: memories.global.length,
      };
    },
  },
  {
    name: "delete_memory",
    description:
      "Delete a specific memory by matching its content. Only admins/owners can delete memories. Use when an admin asks you to forget something.",
    parameters: {
      type: "OBJECT",
      properties: {
        content: {
          type: "STRING",
          description:
            "Text to match against memory content for deletion (case-insensitive substring match)",
        },
        scope: {
          type: "STRING",
          description:
            'Which scope to delete from: "user" for personal, "global" for shared',
          enum: ["user", "global"],
        },
      },
      required: ["content", "scope"],
    },
    execute: async (args: any, ctx?: CommandContext) => {
      if (!ctx) {
        return { error: "No command context available" };
      }

      // Only admins can delete memories
      if (!isAdmin(ctx.sender)) {
        return {
          error: "Only admins can delete memories. Tell the user politely.",
        };
      }

      const deleted = await deleteMemoryByContent(
        ctx.sender,
        args.content,
        args.scope === "global",
      );

      if (deleted === 0) {
        return { result: "No matching memory found to delete." };
      }

      return {
        result: `Deleted ${deleted} memory/memories matching "${args.content}".`,
      };
    },
  }
];
