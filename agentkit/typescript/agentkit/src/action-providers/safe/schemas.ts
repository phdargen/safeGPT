import { z } from "zod";

export const InitializeSafeSchema = z.object({
  signers: z
    .array(z.string())
    .describe("Array of additional signer addresses for the Safe")
    .default([]),
  threshold: z.number().min(1).describe("Number of required confirmations").default(1),
});

export const SafeInfoSchema = z.object({
  safeAddress: z.string().describe("Address of the existing Safe to connect to"),
});

export const AddSignerSchema = z.object({
  safeAddress: z.string().describe("Address of the Safe to modify"),
  newSigner: z.string().describe("Address of the new signer to add"),
  newThreshold: z.number().optional().describe("Optional new threshold after adding signer"),
});

export const RemoveSignerSchema = z.object({
  safeAddress: z.string().describe("Address of the Safe to modify"),
  signerToRemove: z.string().describe("Address of the signer to remove"),
  newThreshold: z.number().optional().describe("Optional new threshold after removing signer"),
});

export const ChangeThresholdSchema = z.object({
  safeAddress: z.string().describe("Address of the Safe to modify"),
  newThreshold: z.number().min(1).describe("New threshold value"),
});

export const ExecutePendingSchema = z.object({
  safeAddress: z.string().describe("Address of the Safe"),
  safeTxHash: z
    .string()
    .optional()
    .describe(
      "Optional specific transaction hash to execute. If not provided, will try to execute all pending transactions",
    ),
});

export const WithdrawFromSafeSchema = z.object({
  safeAddress: z.string().describe("Address of the Safe"),
  recipientAddress: z.string().describe("Address to receive the ETH"),
  amount: z
    .string()
    .optional()
    .describe("Amount of ETH to withdraw (e.g. '0.1'). If not provided, withdraws entire balance"),
});

export const EnableAllowanceModuleSchema = z.object({
  safeAddress: z.string().describe("Address of the Safe to enable allowance module for"),
});

export const SetAllowanceSchema = z.object({
  safeAddress: z.string().describe("Address of the Safe"),
  delegateAddress: z.string().describe("Address of the delegate who will receive the allowance"),
  tokenAddress: z
    .string()
    .optional()
    .describe("Address of the ERC20 token (defaults to Sepolia WETH)")
    .default("0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9"),
  amount: z.string().describe("Amount of tokens to allow (e.g. '1.5' for 1.5 tokens)"),
  resetTimeInMinutes: z
    .number()
    .optional()
    .describe("One time allowance by default. If larger than zero, time in minutes after which the allowance resets").default(0),
});

export const GetAllowanceInfoSchema = z.object({
  safeAddress: z.string().describe("Address of the Safe"),
  delegateAddress: z.string().describe("Address of the delegate to check allowance for"),
  tokenAddress: z
    .string()
    .optional()
    .describe("Address of the ERC20 token (defaults to WETH if not provided)").default("0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9"),
});

export const WithdrawAllowanceSchema = z.object({
  safeAddress: z.string().describe("Address of the Safe"),
  tokenAddress: z
    .string()
    .optional()
    .describe("Address of the ERC20 token (defaults to WETH if not provided)").default("0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9"),
  amount: z.string().describe("Amount of tokens to withdraw (in token decimals)"),
  recipientAddress: z
    .string()
    .optional()
    .describe("Address to receive the tokens (defaults to caller's address)"),
});

export const AnalyzeTransactionSchema = z.object({
  safeAddress: z.string().describe("Address of the Safe"),
  safeTxHash: z.string().describe("Hash of the transaction to analyze"),
});
