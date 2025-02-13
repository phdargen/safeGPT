import { z } from "zod";
import { ActionProvider } from "../actionProvider";
import { CreateAction } from "../actionDecorator";
import {
  InitializeSafeSchema,
  SafeInfoSchema,
  AddSignerSchema,
  RemoveSignerSchema,
  ChangeThresholdSchema,
  ExecutePendingSchema,
  WithdrawFromSafeSchema,
  EnableAllowanceModuleSchema,
  SetAllowanceSchema,
  GetAllowanceInfoSchema,
  WithdrawAllowanceSchema,
  AnalyzeTransactionSchema,
} from "./schemas";
import { Network } from "../../network";
import { NETWORK_ID_TO_VIEM_CHAIN } from "../../network/network";
import { EvmWalletProvider } from "../../wallet-providers/evmWalletProvider";

import { Chain } from "viem/chains";
import { waitForTransactionReceipt } from "viem/actions";

import Safe, { PredictedSafeProps } from "@safe-global/protocol-kit";
import SafeApiKit from "@safe-global/api-kit";
import { getAllowanceModuleDeployment } from "@safe-global/safe-modules-deployments";
import { initializeClientIfNeeded } from "./utils";
import { encodeFunctionData } from "viem";
import { OperationType, MetaTransactionData } from "@safe-global/safe-core-sdk-types";
import { zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { abi as ERC20_ABI } from "../erc20/constants";
import { riskAnalysis } from "./utils";

/**
 * Configuration options for the SafeActionProvider.
 */
export interface SafeActionProviderConfig {
  /**
   * The private key to use for the SafeActionProvider.
   */
  privateKey?: string;

  /**
   * The network ID to use for the SafeActionProvider.
   */
  networkId?: string;
}

/**
 * SafeActionProvider is an action provider for Safe smart account interactions.
 */
export class SafeActionProvider extends ActionProvider<EvmWalletProvider> {
  private readonly privateKey: string;
  private readonly chain: Chain;
  private apiKit: SafeApiKit;
  private safeClient: Safe | null = null;
  private safeBaseUrl: string;

  /**
   * Constructor for the SafeActionProvider class.
   *
   * @param config - The configuration options for the SafeActionProvider.
   */
  constructor(config: SafeActionProviderConfig = {}) {
    super("safe", []);

    // Initialize chain
    this.chain = NETWORK_ID_TO_VIEM_CHAIN[config.networkId || "base-sepolia"];
    if (!this.chain) throw new Error(`Unsupported network: ${config.networkId}`);

    // Initialize private key
    const privateKey = config.privateKey;
    if (!privateKey) throw new Error("Private key is not configured");
    this.privateKey = privateKey;

    // Initialize apiKit with chain ID from Viem chain
    this.apiKit = new SafeApiKit({
      chainId: BigInt(this.chain.id),
    });
    this.safeBaseUrl = "https://app.safe.global/";
  }

  /**
   * Initializes a new Safe smart account.
   *
   * @param walletProvider - The wallet provider to create the Safe.
   * @param args - The input arguments for creating a Safe.
   * @returns A message containing the Safe creation details.
   */
  @CreateAction({
    name: "create_safe",
    description: `
Creates a new Safe smart account.
Takes the following inputs:
- signers: Array of additional signer addresses (optional, default: [])
- threshold: Number of required confirmations (optional, default: 1)

Important notes:
- Requires gas to deploy the Safe contract
- The deployer (private key owner) will be automatically added as a signer
- Threshold must be <= number of signers
    `,
    schema: InitializeSafeSchema,
  })
  async initializeSafe(
    walletProvider: EvmWalletProvider,
    args: z.infer<typeof InitializeSafeSchema>,
  ): Promise<string> {
    try {
      const predictedSafe: PredictedSafeProps = {
        safeAccountConfig: {
          owners: [walletProvider.getAddress(), ...args.signers],
          threshold: args.threshold,
        },
        safeDeploymentConfig: {
          saltNonce: BigInt(Date.now()).toString(),
        },
      };

      let safeClient = await Safe.init({
        provider: walletProvider.getPublicClient().transport,
        signer: this.privateKey,
        predictedSafe,
      });

      const safeAddress = await safeClient.getAddress();
      const deploymentTransaction = await safeClient.createSafeDeploymentTransaction();

      // Execute transaction
      const client = await safeClient.getSafeProvider().getExternalSigner();
      const txHash = await client?.sendTransaction({
        to: deploymentTransaction.to,
        value: BigInt(deploymentTransaction.value),
        data: deploymentTransaction.data as `0x${string}`,
        chain: this.chain,
      });
      const txReceipt = await waitForTransactionReceipt(client!, { hash: txHash! });
      const txLink = `${walletProvider.getPublicClient().chain?.blockExplorers?.default.url}/tx/${txReceipt.transactionHash}`;

      // Reconnect to newly deployed Safe
      safeClient = await safeClient.connect({ safeAddress });

      if (await safeClient.isSafeDeployed()) {
        this.safeClient = safeClient;

        const safeAddress = await safeClient.getAddress();
        const safeOwners = await safeClient.getOwners();
        const safeThreshold = await safeClient.getThreshold();

        return `Create safe: Successfully created Safe at address ${safeAddress} with signers ${safeOwners} and threshold of ${safeThreshold}. Transaction link: ${txLink}.`;
      } else {
        return `Create safe: Error creating Safe`;
      }
    } catch (error) {
      return `Create safe: Error creating Safe: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Connects to an existing Safe smart account.
   *
   * @param walletProvider - The wallet provider to connect to the Safe.
   * @param args - The input arguments for connecting to a Safe.
   * @returns A message containing the connection details.
   */
  @CreateAction({
    name: "safe_info",
    description: `
Gets information about an existing Safe smart account.
Takes the following input:
- safeAddress: Address of the existing Safe to connect to

Important notes:
- The Safe must already be deployed
`,
    schema: SafeInfoSchema,
  })
  async safeInfo(
    walletProvider: EvmWalletProvider,
    args: z.infer<typeof SafeInfoSchema>,
  ): Promise<string> {
    try {
      // Connect to Safe client
      this.safeClient = await initializeClientIfNeeded(
        this.safeClient,
        args.safeAddress,
        walletProvider.getPublicClient().transport,
        this.privateKey,
      );

      // Get Safe info
      const owners = await this.safeClient.getOwners();
      const threshold = await this.safeClient.getThreshold();
      const pendingTransactions = await this.apiKit.getPendingTransactions(args.safeAddress);
      const balance = await walletProvider
        .getPublicClient()
        .getBalance({ address: args.safeAddress });
      const ethBalance = balance ? parseFloat(balance.toString()) / 1e18 : 0;
     
      const chainId = this.chain.id.toString();
      const balanceWETH = await walletProvider.readContract({
        address: chainId === "11155111" ? "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9" : "0x4200000000000000000000000000000000000006",
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [args.safeAddress],
      });
      const wethBalance = balanceWETH ? parseFloat(balanceWETH.toString()) / 1e18 : 0;

      // Get pending transactions
      const pendingTxDetails = pendingTransactions.results
        .filter(tx => !tx.isExecuted)
        .map(tx => {
          const confirmations = tx.confirmations?.length || 0;
          const needed = tx.confirmationsRequired;
          const confirmedBy = tx.confirmations?.map(c => c.owner).join(", ") || "none";
          return `\n- Transaction ${tx.safeTxHash} (${confirmations}/${needed} confirmations, confirmed by: ${confirmedBy})`;
        })
        .join("");
      
      // Get allowance module
      let isEnabled = false;
      const allowanceModule = getAllowanceModuleDeployment({ network: chainId });  
      if (allowanceModule) {
        const moduleAddress = allowanceModule?.networkAddresses[chainId];
        isEnabled = await this.safeClient.isModuleEnabled(moduleAddress);
      }

      return `Safe info:
- Safe at address: ${args.safeAddress}
- Chain ID: ${chainId}
- Balance: ${ethBalance.toFixed(5)} ETH
- WETH Balance: ${wethBalance.toFixed(5)} WETH
- ${owners.length} owners: ${owners.join(", ")}
- Threshold: ${threshold}
- Allowance module enabled: ${isEnabled}
- Pending transactions: ${pendingTransactions.count}${pendingTxDetails}`;
    } catch (error) {
      return `Safe info: Error connecting to Safe: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Adds a new signer to an existing Safe.
   *
   * @param walletProvider - The wallet provider to connect to the Safe.
   * @param args - The input arguments for adding a signer.
   * @returns A message containing the signer addition details.
   */
  @CreateAction({
    name: "add_signer",
    description: `
Adds a new signer to an existing Safe.
Takes the following inputs:
- safeAddress: Address of the Safe to modify
- newSigner: Address of the new signer to add
- newThreshold: (Optional) New threshold after adding signer

Important notes:
- Requires an existing Safe
- Must be called by an existing signer
- If newThreshold not provided, keeps existing threshold
`,
    schema: AddSignerSchema,
  })
  async addSigner(
    walletProvider: EvmWalletProvider,
    args: z.infer<typeof AddSignerSchema>,
  ): Promise<string> {
    try {

      // Connect to Safe client
      this.safeClient = await initializeClientIfNeeded(
        this.safeClient,
        args.safeAddress,
        walletProvider.getPublicClient().transport,
        this.privateKey,
      );

      // Get current threshold
      const currentThreshold = await this.safeClient.getThreshold();

      // Add new signer
      const safeTransaction = await this.safeClient.createAddOwnerTx({
        ownerAddress: args.newSigner,
        threshold: args.newThreshold || currentThreshold,
      });

      if (currentThreshold > 1) {
        // Multi-sig flow: propose transaction
        const safeTxHash = await this.safeClient.getTransactionHash(safeTransaction);
        const signature = await this.safeClient.signHash(safeTxHash);

        await this.apiKit.proposeTransaction({
          safeAddress: args.safeAddress,
          safeTransactionData: safeTransaction.data,
          safeTxHash,
          senderSignature: signature.data,
          senderAddress: walletProvider.getAddress(),
        });

        return `Add signer: Successfully proposed adding signer ${args.newSigner} to Safe ${args.safeAddress} with threshold ${args.newThreshold || currentThreshold}. Safe transaction hash: ${safeTxHash}. The other signers will need to confirm the transaction before it can be executed.`;
      } else {
        // Single-sig flow: execute immediately
        const tx = await this.safeClient.executeTransaction(safeTransaction);
        return `Add signer: Successfully added signer ${args.newSigner} to Safe ${args.safeAddress}. Threshold: ${args.newThreshold || currentThreshold}. Transaction hash: ${tx.hash}.`;
      }
    } catch (error) {
      return `Add signer: Error adding signer: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Removes a signer from an existing Safe.
   *
   * @param walletProvider - The wallet provider to connect to the Safe.
   * @param args - The input arguments for removing a signer.
   * @returns A message containing the signer removal details.
   */
  @CreateAction({
    name: "remove_signer",
    description: `
Removes a signer from an existing Safe.
Takes the following inputs:
- safeAddress: Address of the Safe to modify
- signerToRemove: Address of the signer to remove
- newThreshold: (Optional) New threshold after removing signer

Important notes:
- Requires an existing Safe
- Must be called by an existing signer
- Cannot remove the last signer
- If newThreshold not provided, keeps existing threshold if valid
`,
    schema: RemoveSignerSchema,
  })
  async removeSigner(
    walletProvider: EvmWalletProvider,
    args: z.infer<typeof RemoveSignerSchema>,
  ): Promise<string> {
    try {
      // Connect to Safe client
      this.safeClient = await initializeClientIfNeeded(
        this.safeClient,
        args.safeAddress,
        walletProvider.getPublicClient().transport,
        this.privateKey,
      );

      const currentSigners = await this.safeClient.getOwners();
      const currentThreshold = await this.safeClient.getThreshold();

      if (currentSigners.length <= 1) {
        throw new Error("Cannot remove the last signer");
      }

      const safeTransaction = await this.safeClient.createRemoveOwnerTx({
        ownerAddress: args.signerToRemove,
        threshold:
          args.newThreshold ||
          (currentThreshold > currentSigners.length - 1
            ? currentSigners.length - 1
            : currentThreshold),
      });

      if (currentThreshold > 1) {
        // Multi-sig flow: propose transaction
        const safeTxHash = await this.safeClient.getTransactionHash(safeTransaction);
        const signature = await this.safeClient.signHash(safeTxHash);

        await this.apiKit.proposeTransaction({
          safeAddress: args.safeAddress,
          safeTransactionData: safeTransaction.data,
          safeTxHash,
          senderSignature: signature.data,
          senderAddress: walletProvider.getAddress(),
        });

        return `Remove signer: Successfully proposed removing signer ${args.signerToRemove} from Safe ${args.safeAddress} with threshold ${args.newThreshold || currentThreshold}. Safe transaction hash: ${safeTxHash}. The other signers will need to confirm the transaction before it can be executed.`;
      } else {
        // Single-sig flow: execute immediately
        const tx = await this.safeClient.executeTransaction(safeTransaction);
        return `Remove signer: Successfully removed signer ${args.signerToRemove} from Safe ${args.safeAddress}. Threshold: ${args.newThreshold || currentThreshold}. Transaction hash: ${tx.hash}.`;
      }
    } catch (error) {
      return `Remove signer: Error removing signer: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Changes the confirmation threshold of an existing Safe.
   *
   * @param walletProvider - The wallet provider to connect to the Safe.
   * @param args - The input arguments for changing the threshold.
   * @returns A message containing the threshold change details.
   */
  @CreateAction({
    name: "change_threshold",
    description: `
Changes the confirmation threshold of an existing Safe.
Takes the following inputs:
- safeAddress: Address of the Safe to modify
- newThreshold: New threshold value (must be >= 1 and <= number of signers)

Important notes:
- Requires an existing Safe
- Must be called by an existing signer
- New threshold must not exceed number of signers
`,
    schema: ChangeThresholdSchema,
  })
  async changeThreshold(
    walletProvider: EvmWalletProvider,
    args: z.infer<typeof ChangeThresholdSchema>,
  ): Promise<string> {
    try {
      // Connect to Safe client
      this.safeClient = await initializeClientIfNeeded(
        this.safeClient,
        args.safeAddress,
        walletProvider.getPublicClient().transport,
        this.privateKey,
      );

      const currentSigners = await this.safeClient.getOwners();
      const currentThreshold = await this.safeClient.getThreshold();

      if (args.newThreshold > currentSigners.length) {
        throw new Error("New threshold cannot exceed number of signers");
      }

      const safeTransaction = await this.safeClient.createChangeThresholdTx(args.newThreshold);

      if (currentThreshold > 1) {
        // Multi-sig flow: propose transaction
        const safeTxHash = await this.safeClient.getTransactionHash(safeTransaction);
        const signature = await this.safeClient.signHash(safeTxHash);

        await this.apiKit.proposeTransaction({
          safeAddress: args.safeAddress,
          safeTransactionData: safeTransaction.data,
          safeTxHash,
          senderSignature: signature.data,
          senderAddress: walletProvider.getAddress(),
        });

        return `Change threshold: Successfully proposed changing threshold to ${args.newThreshold} for Safe ${args.safeAddress}. Safe transaction hash: ${safeTxHash}. The other signers will need to confirm the transaction before it can be executed.`;
      } else {
        // Single-sig flow: execute immediately
        const tx = await this.safeClient.executeTransaction(safeTransaction);
        return `Change threshold: Successfully changed threshold to ${args.newThreshold} for Safe ${args.safeAddress}. Transaction hash: ${tx.hash}.`;
      }
    } catch (error) {
      return `Change threshold: Error changing threshold: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Executes pending transactions for a Safe if enough signatures are collected.
   *
   * @param walletProvider - The wallet provider to connect to the Safe.
   * @param args - The input arguments for executing pending transactions.
   * @returns A message containing the execution details.
   */
  @CreateAction({
    name: "execute_pending",
    description: `
Executes pending transactions for a Safe if enough signatures are collected.
Takes the following inputs:
- safeAddress: Address of the Safe
- safeTxHash: (Optional) Specific transaction hash to execute. If not provided, will try to execute all pending transactions

Important notes:
- Requires an existing Safe
- Must be called by an existing signer
- Transaction must have enough signatures to meet threshold
- Will fail if threshold is not met
`,
    schema: ExecutePendingSchema,
  })
  async executePending(
    walletProvider: EvmWalletProvider,
    args: z.infer<typeof ExecutePendingSchema>,
  ): Promise<string> {
    try {
      // Connect to Safe client
      this.safeClient = await initializeClientIfNeeded(
        this.safeClient,
        args.safeAddress,
        walletProvider.getPublicClient().transport,
        this.privateKey,
      );

      // Get pending transactions
      const pendingTxs = await this.apiKit.getPendingTransactions(args.safeAddress);

      if (pendingTxs.results.length === 0) {
        return "Execute pending: No pending transactions found.";
      }

      let executedTxs: string[] = [];
      let skippedTxs = 0;
      const txsToProcess = args.safeTxHash
        ? pendingTxs.results.filter(
            tx => tx.safeTxHash === args.safeTxHash && tx.isExecuted === false,
          )
        : pendingTxs.results.filter(tx => tx.isExecuted === false);

      for (const tx of txsToProcess) {
        // Check if agent is signer and transaction needs one more signature
        const agentAddress = walletProvider.getAddress();
        const hasAgentSigned = tx.confirmations?.some(c => c.owner.toLowerCase() === agentAddress.toLowerCase());
        const confirmations = tx.confirmations?.length || 0;

        if (confirmations === tx.confirmationsRequired - 1 && !hasAgentSigned) {
          // Agent is last required signer - execute directly
          const txHash = (await this.safeClient.executeTransaction(tx)).hash;
          executedTxs.push(txHash);
          continue;
        }

        // Otherwise, skip if not enough confirmations
        if (confirmations < tx.confirmationsRequired) {
          skippedTxs++;
          continue;
        }

        const txHash = (await this.safeClient.executeTransaction(tx)).hash;
        executedTxs.push(txHash);
      }

      if (executedTxs.length === 0 && skippedTxs > 0) {
        return `Execute pending: No transactions executed. ${skippedTxs} transaction(s) have insufficient confirmations.`;
      }

      return `Execute pending: Execution complete. Successfully executed ${executedTxs.length} transaction(s): ${executedTxs.join(", ")}.${
        args.safeTxHash ? ` Safe transaction hash: ${args.safeTxHash}` : ""
      }`;
    } catch (error) {
      return `Execute pending: Error executing transactions: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Withdraws ETH from the Safe.
   *
   * @param walletProvider - The wallet provider to connect to the Safe.
   * @param args - The input arguments for withdrawing ETH.
   * @returns A message containing the withdrawal details.
   */
  @CreateAction({
    name: "withdraw_eth",
    description: `
Withdraws ETH from the Safe.
Takes the following inputs:
- safeAddress: Address of the Safe
- recipientAddress: Address to receive the ETH
- amount: (Optional) Amount of ETH to withdraw. If not provided, withdraws entire balance

Important notes:
- Requires an existing Safe
- Must be called by an existing signer
- Requires confirmation from other signers if threshold > 1
`,
    schema: WithdrawFromSafeSchema,
  })
  async withdrawEth(
    walletProvider: EvmWalletProvider,
    args: z.infer<typeof WithdrawFromSafeSchema>,
  ): Promise<string> {
    try {
      // Connect to Safe client
      this.safeClient = await initializeClientIfNeeded(
        this.safeClient,
        args.safeAddress,
        walletProvider.getPublicClient().transport,
        this.privateKey,
      );

      const currentThreshold = await this.safeClient.getThreshold();
      const balance = await walletProvider
        .getPublicClient()
        .getBalance({ address: args.safeAddress });

      // Calculate amount to withdraw
      let withdrawAmount: bigint;
      if (args.amount) {
        withdrawAmount = BigInt(Math.floor(parseFloat(args.amount) * 1e18));
        if (withdrawAmount > balance) {
          throw new Error(
            `Insufficient balance. Safe has ${parseFloat(balance.toString()) / 1e18} ETH`,
          );
        }
      } else {
        withdrawAmount = balance;
      }

      const safeTransaction = await this.safeClient.createTransaction({
        transactions: [
          {
            to: args.recipientAddress,
            data: "0x",
            value: withdrawAmount.toString(),
          },
        ],
      });

      if (currentThreshold > 1) {
        // Multi-sig flow: propose transaction
        const safeTxHash = await this.safeClient.getTransactionHash(safeTransaction);
        const signature = await this.safeClient.signHash(safeTxHash);

        await this.apiKit.proposeTransaction({
          safeAddress: args.safeAddress,
          safeTransactionData: safeTransaction.data,
          safeTxHash,
          senderSignature: signature.data,
          senderAddress: walletProvider.getAddress(),
        });

        return `Withdraw ETH: Successfully proposed withdrawing ${parseFloat(withdrawAmount.toString()) / 1e18} ETH to ${args.recipientAddress}. Safe transaction hash: ${safeTxHash}. The other signers will need to confirm the transaction before it can be executed.`;
      } else {
        // Single-sig flow: execute immediately
        const tx = await this.safeClient.executeTransaction(safeTransaction);
        return `Withdraw ETH: Successfully withdrew ${parseFloat(withdrawAmount.toString()) / 1e18} ETH to ${args.recipientAddress}. Transaction hash: ${tx.hash}.`;
      }
    } catch (error) {
      return `Withdraw ETH: Error withdrawing ETH: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Enables the allowance module for a Safe, allowing for token spending allowances.
   *
   * @param walletProvider - The wallet provider to connect to the Safe.
   * @param args - The input arguments for enabling the allowance module.
   * @returns A message containing the allowance module enabling details.
   */
  @CreateAction({
    name: "enable_allowance_module",
    description: `
Enables the allowance module for a Safe, allowing for token spending allowances.
Takes the following input:
- safeAddress: Address of the Safe

Important notes:
- Requires an existing Safe
- Must be called by an existing signer
- Requires confirmation from other signers if threshold > 1
- Module can only be enabled once
`,
    schema: EnableAllowanceModuleSchema,
  })
  async enableAllowanceModule(
    walletProvider: EvmWalletProvider,
    args: z.infer<typeof EnableAllowanceModuleSchema>,
  ): Promise<string> {
    try {
      // Connect to Safe client
      this.safeClient = await initializeClientIfNeeded(
        this.safeClient,
        args.safeAddress,
        walletProvider.getPublicClient().transport,
        this.privateKey,
      );

      const isSafeDeployed = await this.safeClient.isSafeDeployed();
      if (!isSafeDeployed) {
        throw new Error("Safe not deployed");
      }

      // Get allowance module address for current chain
      const chainId = this.chain.id.toString();
      const allowanceModule = getAllowanceModuleDeployment({ network: chainId });
      if (!allowanceModule) {
        throw new Error(`Allowance module not found for chainId [${chainId}]`);
      }

      // Check if module is already enabled
      const moduleAddress = allowanceModule.networkAddresses[chainId];
      const isAlreadyEnabled = await this.safeClient.isModuleEnabled(moduleAddress);
      if (isAlreadyEnabled) {
        return "Allowance module is already enabled for this Safe";
      }

      // Create and execute/propose transaction
      const safeTransaction = await this.safeClient.createEnableModuleTx(moduleAddress);
      const currentThreshold = await this.safeClient.getThreshold();

      if (currentThreshold > 1) {
        // Multi-sig flow: propose transaction
        const safeTxHash = await this.safeClient.getTransactionHash(safeTransaction);
        const signature = await this.safeClient.signHash(safeTxHash);

        await this.apiKit.proposeTransaction({
          safeAddress: args.safeAddress,
          safeTransactionData: safeTransaction.data,
          safeTxHash,
          senderSignature: signature.data,
          senderAddress: walletProvider.getAddress(),
        });

        return `Enable allowance module: Successfully proposed enabling allowance module for Safe ${args.safeAddress}. Safe transaction hash: ${safeTxHash}. The other signers will need to confirm the transaction before it can be executed.`;
      } else {
        // Single-sig flow: execute immediately
        const tx = await this.safeClient.executeTransaction(safeTransaction);
        return `Enable allowance module: Successfully enabled allowance module for Safe ${args.safeAddress}. Transaction hash: ${tx.hash}.`;
      }
    } catch (error) {
      return `Enable allowance module: Error enabling allowance module: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Sets an allowance for a delegate to spend tokens from the Safe.
   * 
   * @param walletProvider - The wallet provider to connect to the Safe.
   * @param args - The input arguments for setting the allowance.
   * @returns A message containing the allowance setting details.
   */
  @CreateAction({
    name: "set_allowance",
    description: `
Sets a token spending allowance for a delegate address.
Takes the following inputs:
- safeAddress: Address of the Safe
- delegateAddress: Address that will receive the allowance
- tokenAddress: (Optional) Address of the ERC20 token (defaults to Sepolia WETH)
- amount: Amount of tokens to allow (e.g. '1.5' for 1.5 tokens)
- resetTimeInMinutes: Time in minutes after which the allowance resets

Important notes:
- Requires an existing Safe
- Must be called by an existing signer
- Allowance module must be enabled first
- Amount is in human-readable format (e.g. '1.5' for 1.5 tokens)
- Requires confirmation from other signers if threshold > 1
`,
    schema: SetAllowanceSchema,
  })
  async setAllowance(
    walletProvider: EvmWalletProvider,
    args: z.infer<typeof SetAllowanceSchema>,
  ): Promise<string> {
    try {
      // Connect to Safe client
      this.safeClient = await initializeClientIfNeeded(
        this.safeClient,
        args.safeAddress,
        walletProvider.getPublicClient().transport,
        this.privateKey,
      );

      console.log("setAllowance called with args", args);

      // Get allowance module for current chain
      const chainId = this.chain.id.toString();
      const allowanceModule = getAllowanceModuleDeployment({ network: chainId });
      if (!allowanceModule) {
        throw new Error(`Allowance module not found for chainId [${chainId}]`);
      }

      const moduleAddress = allowanceModule.networkAddresses[chainId];

      // Check if module is enabled
      const isModuleEnabled = await this.safeClient.isModuleEnabled(moduleAddress);
      if (!isModuleEnabled) {
        throw new Error("Allowance module is not enabled for this Safe. Enable it first.");
      }

      // Default to WETH if no token address provided
      const tokenAddress = args.tokenAddress || "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9"; // Sepolia WETH

      // Get token symbol
      const tokenSymbol = await walletProvider.getPublicClient().readContract({
        address: tokenAddress as `0x${string}`,
        abi: [
          {
            constant: true,
            inputs: [],
            name: "symbol",
            outputs: [{ name: "", type: "string" }],
            type: "function",
          },
        ],
        functionName: "symbol",
      });

      // Get token decimals and convert amount
      const tokenDecimals = await walletProvider.getPublicClient().readContract({
        address: tokenAddress as `0x${string}`,
        abi: [
          {
            constant: true,
            inputs: [],
            name: "decimals",
            outputs: [{ name: "", type: "uint8" }],
            type: "function",
          },
        ],
        functionName: "decimals",
      });

      // Convert amount to token decimals
      const amount = BigInt(Math.floor(parseFloat(args.amount) * Math.pow(10, Number(tokenDecimals))));

      // Prepare the allowance setting transaction
      const setAllowanceData = encodeFunctionData({
        abi: allowanceModule.abi,
        functionName: "setAllowance",
        args: [
          args.delegateAddress,
          tokenAddress,
          amount,
          BigInt(args.resetTimeInMinutes || 0), // Use 0 for one-time allowance if not specified
          BigInt(0), // resetBaseMin (0 is fine as default)
        ],
      });

      // Create transaction data
      const transactions: MetaTransactionData[] = [
        {
          to: moduleAddress,
          value: "0",
          data: setAllowanceData,
          operation: OperationType.Call,
        },
      ];

      const safeTransaction = await this.safeClient.createTransaction({
        transactions,
        onlyCalls: true,
      });

      const currentThreshold = await this.safeClient.getThreshold();

      // Update success message to include reset time info
      const resetTimeMsg = args.resetTimeInMinutes > 0 
        ? ` (resets every ${args.resetTimeInMinutes} minutes)`
        : ` (one-time allowance)`;

      if (currentThreshold > 1) {
        // Multi-sig flow: propose transaction
        const safeTxHash = await this.safeClient.getTransactionHash(safeTransaction);
        const signature = await this.safeClient.signHash(safeTxHash);

        await this.apiKit.proposeTransaction({
          safeAddress: args.safeAddress,
          safeTransactionData: safeTransaction.data,
          safeTxHash,
          senderSignature: signature.data,
          senderAddress: walletProvider.getAddress(),
        });

        return `Set allowance: Successfully proposed setting allowance of ${args.amount} ${tokenSymbol} (${tokenAddress})${resetTimeMsg} for delegate ${args.delegateAddress}. Safe transaction hash: ${safeTxHash}. The other signers will need to confirm the transaction before it can be executed.`;
      } else {
        // Single-sig flow: execute immediately
        const tx = await this.safeClient.executeTransaction(safeTransaction);
        return `Set allowance: Successfully set allowance of ${args.amount} ${tokenSymbol} (${tokenAddress})${resetTimeMsg} for delegate ${args.delegateAddress}. Transaction hash: ${tx.hash}.`;
      }
    } catch (error) {
      return `Set allowance: Error setting allowance: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Gets the current allowance for a delegate to spend tokens from the Safe.
   * 
   * @param walletProvider - The wallet provider to connect to the Safe.
   * @param args - The input arguments for getting the allowance.
   * @returns A message containing the current allowance details.
   */
  @CreateAction({
    name: "get_allowance_info",
    description: `
Gets the current token spending allowance for a delegate address.
Takes the following inputs:
- safeAddress: Address of the Safe
- delegateAddress: Address of the delegate to check allowance for
- tokenAddress: (Optional) Address of the ERC20 token (defaults to WETH)

Important notes:
- Requires an existing Safe
- Allowance module must be enabled
- Returns 0 if delegate has no allowance
`,
    schema: GetAllowanceInfoSchema,
  })
  async getAllowanceInfo(
    walletProvider: EvmWalletProvider,
    args: z.infer<typeof GetAllowanceInfoSchema>,
  ): Promise<string> {
    try {
      // Get allowance module for current chain
      const chainId = this.chain.id.toString();
      const allowanceModule = getAllowanceModuleDeployment({ network: chainId });
      if (!allowanceModule) {
        throw new Error(`Allowance module not found for chainId [${chainId}]`);
      }

      const moduleAddress = allowanceModule.networkAddresses[chainId];

      // Default to WETH if no token address provided
      const tokenAddress = args.tokenAddress || "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9"; // Sepolia WETH

      // Get current allowance
      const allowance = await walletProvider.getPublicClient().readContract({
        address: moduleAddress,
        abi: allowanceModule.abi,
        functionName: "getTokenAllowance",
        args: [args.safeAddress, args.delegateAddress, tokenAddress],
      });
      console.log("allowance", allowance);

      // Get token details for better formatting
      const tokenSymbol = await walletProvider.getPublicClient().readContract({
        address: tokenAddress as `0x${string}`,
        abi: [
          {
            constant: true,
            inputs: [],
            name: "symbol",
            outputs: [{ name: "", type: "string" }],
            type: "function",
          },
        ],
        functionName: "symbol",
      });
      console.log("tokenSymbol", tokenSymbol);

      const tokenDecimals = await walletProvider.getPublicClient().readContract({
        address: tokenAddress as `0x${string}`,
        abi: [
          {
            constant: true,
            inputs: [],
            name: "decimals",
            outputs: [{ name: "", type: "uint8" }],
            type: "function",
          },
        ],
        functionName: "decimals",
      });

      // Format allowance with token decimals
      const formattedAllowance = parseFloat(allowance.toString()) / Math.pow(10, Number(tokenDecimals));
      return `Get allowance: Delegate ${args.delegateAddress} has an allowance of ${formattedAllowance} ${tokenSymbol} (${tokenAddress}) from Safe ${args.safeAddress}`;
    } catch (error) {
      return `Get allowance: Error getting allowance: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Withdraws tokens using an allowance from a Safe.
   * 
   * @param walletProvider - The wallet provider to connect to the Safe.
   * @param args - The input arguments for withdrawing the allowance.
   * @returns A message containing the withdrawal details.
   */
  @CreateAction({
    name: "withdraw_allowance",
    description: `
Withdraws tokens using an allowance from a Safe.
Takes the following inputs:
- safeAddress: Address of the Safe
- tokenAddress: (Optional) Address of the ERC20 token (defaults to WETH)
- amount: Amount of tokens to withdraw
- recipientAddress: (Optional) Address to receive the tokens (defaults to caller's address)

Important notes:
- Requires an existing Safe
- Allowance module must be enabled
- Must have sufficient allowance
- Amount must be within allowance limit
`,
    schema: WithdrawAllowanceSchema,
  })
  async withdrawAllowance(
    walletProvider: EvmWalletProvider,
    args: z.infer<typeof WithdrawAllowanceSchema>,
  ): Promise<string> {
    try {
      // Get allowance module for current chain
      const chainId = this.chain.id.toString();
      const allowanceModule = getAllowanceModuleDeployment({ network: chainId });
      if (!allowanceModule) {
        throw new Error(`Allowance module not found for chainId [${chainId}]`);
      }

      const moduleAddress = allowanceModule.networkAddresses[chainId];

      // Default to WETH if no token address provided
      const tokenAddress = args.tokenAddress || "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9"; // Sepolia WETH
      const recipientAddress = args.recipientAddress || walletProvider.getAddress();

      // Get current allowance to check nonce
      const allowance = await walletProvider.getPublicClient().readContract({
        address: moduleAddress,
        abi: allowanceModule.abi,
        functionName: "getTokenAllowance",
        args: [args.safeAddress, walletProvider.getAddress(), tokenAddress],
      });

      // Get token decimals and convert amount
      const tokenDecimals = await walletProvider.getPublicClient().readContract({
        address: tokenAddress as `0x${string}`,
        abi: [
          {
            constant: true,
            inputs: [],
            name: "decimals",
            outputs: [{ name: "", type: "uint8" }],
            type: "function",
          },
        ],
        functionName: "decimals",
      });

      // Convert amount to token decimals
      const amount = BigInt(Math.floor(parseFloat(args.amount) * Math.pow(10, Number(tokenDecimals))));

      // Generate transfer hash
      const hash = await walletProvider.getPublicClient().readContract({
        address: moduleAddress,
        abi: allowanceModule.abi,
        functionName: "generateTransferHash",
        args: [
          args.safeAddress,
          tokenAddress,
          recipientAddress,
          amount,
          zeroAddress,
          BigInt(0),
          allowance[4], // nonce
        ],
      });

      // Sign the hash
      const account = privateKeyToAccount(this.privateKey as `0x${string}`);
      const signature = await account.sign({
        hash: hash as unknown as `0x${string}`,
      });

      // Send transaction directly without simulation
      const tx = await walletProvider.sendTransaction({
        to: moduleAddress,
        data: encodeFunctionData({
          abi: allowanceModule.abi,
          functionName: "executeAllowanceTransfer",
          args: [
            args.safeAddress,
            tokenAddress,
            recipientAddress,
            amount,
            zeroAddress,
            BigInt(0),
            walletProvider.getAddress(),
            signature,
          ],
        }),
        value: BigInt(0),
      });

      const receipt = await walletProvider.getPublicClient().waitForTransactionReceipt({ hash: tx });

      // Get token details for better formatting
      const tokenSymbol = await walletProvider.getPublicClient().readContract({
        address: tokenAddress as `0x${string}`,
        abi: [
          {
            constant: true,
            inputs: [],
            name: "symbol",
            outputs: [{ name: "", type: "string" }],
            type: "function",
          },
        ],
        functionName: "symbol",
      });

      // Format amount with token decimals
      const formattedAmount = parseFloat(amount.toString()) / Math.pow(10, Number(tokenDecimals));

      return `Withdraw allowance: Successfully withdrew ${formattedAmount} ${tokenSymbol} from Safe ${args.safeAddress} to ${recipientAddress}. Transaction hash: ${receipt.transactionHash}`;
    } catch (error) {
      return `Withdraw allowance: Error withdrawing allowance: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Analyzes a pending Safe transaction to explain what it does.
   * 
   * @param walletProvider - The wallet provider to connect to the Safe.
   * @param args - The input arguments for analyzing the transaction.
   * @returns A detailed analysis report of the transaction.
   */
  @CreateAction({
    name: "analyze_transaction",
    description: `
Analyzes a pending Safe transaction to explain what it does.
Takes the following inputs:
- safeAddress: Address of the Safe
- safeTxHash: Hash of the transaction to analyze

Returns a detailed analysis including:
- Who proposed it and when
- Current confirmation status
- What the transaction will do if executed
- Any risk considerations
`,
    schema: AnalyzeTransactionSchema,
  })
  async analyzeTransaction(walletProvider: EvmWalletProvider, args: z.infer<typeof AnalyzeTransactionSchema>): Promise<string> {
    try {

      // Connect to Safe client
      this.safeClient = await initializeClientIfNeeded(
        this.safeClient,
        args.safeAddress,
        walletProvider.getPublicClient().transport,
        this.privateKey,
      );

      // Get Safe info
      const owners = await this.safeClient.getOwners();

      const report = await riskAnalysis(this.apiKit, walletProvider.getPublicClient(), args.safeAddress, args.safeTxHash, owners);

      return `Transaction ${args.safeTxHash} found in pending transactions: ${JSON.stringify(report)}`;
    } catch (error) {
      return `Analyze transaction: Error analyzing transaction: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Checks if the Safe action provider supports the given network.
   *
   * @param network - The network to check.
   * @returns True if the Safe action provider supports the network, false otherwise.
   */
  supportsNetwork = (network: Network) => network.protocolFamily === "evm";
}

export const safeActionProvider = (config?: SafeActionProviderConfig) =>
  new SafeActionProvider(config);
