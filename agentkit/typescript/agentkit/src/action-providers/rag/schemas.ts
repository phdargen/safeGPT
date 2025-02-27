import { z } from "zod";

export const QueryKnowledgeBaseSchema = z.object({
    query: z.string().describe("The question or information request about Safe Wallet to search for in docs"),
});