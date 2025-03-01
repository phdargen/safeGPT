import {
  AgentKit,
  CdpWalletProvider,
  wethActionProvider,
  walletActionProvider,
  erc20ActionProvider,
  cdpApiActionProvider,
  cdpWalletActionProvider,
  pythActionProvider,
  safeActionProvider,
  ragActionProvider,
} from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import * as fs from "fs";

// Store agents by socket ID
const agents = new Map<string, {
  agent: any;
  config: any;
  memory: MemorySaver;
}>();

function validateEnvironment(): void {
    const missingVars: string[] = [];
  
    // Check required variables
    const requiredVars = ["OPENAI_API_KEY", "CDP_API_KEY_NAME", "CDP_API_KEY_PRIVATE_KEY", "ASTRA_DB_APPLICATION_TOKEN", "ASTRA_DB_API_ENDPOINT", "ASTRA_DB_NAMESPACE", "ASTRA_DB_COLLECTION"];
    requiredVars.forEach(varName => {
      if (!process.env[varName]) {
        missingVars.push(varName);
      }
    });
  
    // Exit if any required variables are missing
    if (missingVars.length > 0) {
      console.error("Error: Required environment variables are not set");
      missingVars.forEach(varName => {
        console.error(`${varName}=your_${varName.toLowerCase()}_here`);
      });
      process.exit(1);
    }
  
    // Warn about optional NETWORK_ID
    if (!process.env.NETWORK_ID) {
      console.warn("Warning: NETWORK_ID not set, defaulting to base-sepolia testnet");
    }
}

// Add this right after imports and before any other code
validateEnvironment();

// Configure a file to persist the agent's CDP MPC Wallet Data
const WALLET_DATA_FILE = "wallet_data_sepolia.txt";

export async function initializeAgent(socketId: string) {
  // Return existing agent if already initialized
  if (agents.has(socketId)) {
    return agents.get(socketId);
  }

  try {
    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
    });

    let walletDataStr: string | null = null;

    // Read existing wallet data if available
    if (fs.existsSync(WALLET_DATA_FILE)) {
      try {
        walletDataStr = fs.readFileSync(WALLET_DATA_FILE, "utf8");
      } catch (error) {
        console.error("Error reading wallet data:", error);
        // Continue without wallet data
      }
    }

    const walletProvider = await CdpWalletProvider.configureWithWallet({
      apiKeyName: process.env.CDP_API_KEY_NAME,
      apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      cdpWalletData: walletDataStr || undefined,
      networkId: process.env.NETWORK_ID || "base-sepolia",
    });

    const agentkit = await AgentKit.from({
      walletProvider,
      actionProviders: [
        //wethActionProvider(),
        pythActionProvider(),
        walletActionProvider(),
        //erc20ActionProvider(),
        // cdpApiActionProvider({
        //   apiKeyName: process.env.CDP_API_KEY_NAME,
        //   apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        // }),
        // cdpWalletActionProvider({
        //   apiKeyName: process.env.CDP_API_KEY_NAME,
        //   apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        // }),
        safeActionProvider({
          networkId: walletProvider.getNetwork().networkId,
          privateKey: await (await walletProvider.getWallet().getDefaultAddress()).export(),
        }),
        ragActionProvider({
          astraDbToken: process.env.ASTRA_DB_APPLICATION_TOKEN,
          astraDbEndpoint: process.env.ASTRA_DB_API_ENDPOINT,
          astraDbNamespace: process.env.ASTRA_DB_NAMESPACE,
          astraDbCollection: process.env.ASTRA_DB_COLLECTION,
          openAiApiKey: process.env.OPENAI_API_KEY,
        }),
      ],
    });

    const tools = await getLangChainTools(agentkit);
    const memory = new MemorySaver();
    
    const agentConfig = { configurable: { thread_id: `SafeGPT Agent - ${socketId}` } };

    const agent = createReactAgent({
      llm,
      tools: tools as any,
      checkpointSaver: memory,
      messageModifier: `
        You are SafeGPT, a helpful agent that can interact with Safe smart accounts.
        You help users setup and manage Safe multi-signature accounts.
        You can also analyze pending transactions and propose/execute transactions. 
        You have access to a wallet that can act as signer of a Safe smart account.
        The get_wallet_details tool will give you information about your (agent) wallet, it is not the user's wallet.
        If there is a 5XX error, ask the user to try again later. 
        Be concise and helpful with your responses. 
        If you think you can't execute an action involving a Safe, first check with the safe_info tool to verify your assumptions before telling the user.
        Better try than annoy the user. 
        When you report a transaction analysis, try to interpret it and report it in a way that is easy to understand.
      `,
    });

    // Store the new agent instance
    agents.set(socketId, { agent, config: agentConfig, memory });

    console.log("Agent number", agents.size, "initialized for socket ID:", socketId, "and agent address:", (await walletProvider.getWallet().getDefaultAddress()).getId());

    return { agent, config: agentConfig };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error;
  }
}

export function getAgent(socketId: string) {
  const agentData = agents.get(socketId);
  if (!agentData) {
    throw new Error(`No agent found for socket ${socketId}`);
  }
  return { agent: agentData.agent, config: agentData.config };
}

export function removeAgent(socketId: string) {
  agents.delete(socketId);
  console.log("Removed agent for socket ID:", socketId, ". Number of agents:", agents.size);
} 