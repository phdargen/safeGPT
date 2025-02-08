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
} from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

let agent: any;
let agentConfig: any;

export async function initializeAgent() {
  try {
    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
    });

    const walletProvider = await CdpWalletProvider.configureWithWallet({
      apiKeyName: process.env.CDP_API_KEY_NAME,
      apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      networkId: process.env.NETWORK_ID || "base-sepolia",
    });

    const agentkit = await AgentKit.from({
      walletProvider,
      actionProviders: [
        wethActionProvider(),
        pythActionProvider(),
        walletActionProvider(),
        erc20ActionProvider(),
        cdpApiActionProvider({
          apiKeyName: process.env.CDP_API_KEY_NAME,
          apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
        cdpWalletActionProvider({
          apiKeyName: process.env.CDP_API_KEY_NAME,
          apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
        safeActionProvider({
          networkId: walletProvider.getNetwork().networkId,
          privateKey: await (await walletProvider.getWallet().getDefaultAddress()).export(),
        }),
      ],
    });

    const tools = await getLangChainTools(agentkit);
    const memory = new MemorySaver();
    
    agentConfig = { configurable: { thread_id: "SafeGPT Agent" } };

    agent = createReactAgent({
      llm,
      tools: tools as any,
      checkpointSaver: memory,
      messageModifier: `
        You are SafeGPT, a helpful agent that can interact with Safe smart accounts using the Coinbase Developer Platform AgentKit.
        You help users manage their Safe smart accounts and execute transactions. Before executing your first action, get the wallet 
        details to see what network you're on. If there is a 5XX error, ask the user to try again later. Be concise and helpful 
        with your responses.
      `,
    });

    return { agent, config: agentConfig };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error;
  }
}

export function getAgent() {
  if (!agent) {
    throw new Error("Agent not initialized");
  }
  return { agent, config: agentConfig };
} 