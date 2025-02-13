import Safe from "@safe-global/protocol-kit";
import { PublicClient } from "viem";
import SafeApiKit from "@safe-global/api-kit";
import { ExternalAddress } from "@coinbase/coinbase-sdk";

/**
 * Initializes or reinitializes a Safe client if needed
 *
 * @param currentClient - The current Safe client instance
 * @param safeAddress - The target Safe address
 * @param provider - The provider for initializing the client
 * @param signer - The signer for initializing the client
 * @returns The initialized Safe client
 */
export const initializeClientIfNeeded = async (
  currentClient: Safe | null,
  safeAddress: string,
  provider: PublicClient["transport"],
  signer: string,
): Promise<Safe> => {
  // If no client exists, initialize new one
  // if (!currentClient) {
    // console.log("Initializing new Safe client");
    return await Safe.init({
      provider,
      signer,
      safeAddress,
    });
  // }

  // TODO: FIX THIS
  // If client exists but for different Safe address, reinitialize
  // const currentAddress = await currentClient.getAddress();
  // if (currentAddress.toLowerCase() !== safeAddress.toLowerCase()) {
  //   console.log("Reinitializing Safe client");
  //   return await Safe.init({
  //     provider,
  //     signer,
  //     safeAddress,
  //   });
  // }

  // // Return existing client if it's for the same Safe
  // console.log("Returning existing Safe client");
  // return currentClient;
};

/**
 * Performs a detailed risk analysis of a pending Safe transaction
 * 
 * @param tx - The pending transaction to analyze
 * @returns A detailed analysis report
 */
export const riskAnalysis = async (apiKit: SafeApiKit, provider: PublicClient, safeAddress: string, safeTxHash: string, owners: string[]): Promise<string> => {

  // Get transaction details
  const pendingTxs = await apiKit.getPendingTransactions(safeAddress);
  const tx = pendingTxs.results.find(tx => tx.safeTxHash === safeTxHash);

  if (!tx) {
    return `Transaction ${safeTxHash} not found in pending transactions.`;
  }

  // Basic transaction info
  const proposedAt = new Date(tx.submissionDate).toLocaleString();
  const confirmations = tx.confirmations?.length || 0;
  const confirmationStatus = `${confirmations}/${tx.confirmationsRequired} confirmations`;
  const confirmedBy = tx.confirmations?.map(c => c.owner).join(", ") || "none";
  
  // Risk assessment
  const riskFactors: string[] = [];
  let contractInfo: Record<string, string> = {};

  // Analyze transaction type and data
  let actionDescription = "Unknown transaction type";
  if (tx.dataDecoded) {
    console.log("tx.dataDecoded: ", tx.dataDecoded);
    
    const method = tx.dataDecoded.method;
    const params = tx.dataDecoded.parameters;
    contractInfo = {
      method: method,
      params: params ? JSON.stringify(params, null, 2) : 'No parameters'
    };
    // Decode common transaction types
    switch (method) {
      case "addOwnerWithThreshold":
        actionDescription = `Add new owner ${params?.[0].value} with threshold ${params?.[1].value}`;
        const address = new ExternalAddress("base-mainnet", params?.[0].value);
        const reputation = (await address.reputation()).score;
        if(reputation < 20)  riskFactors.push("⚠️ New owner has low onchain reputation (score = " + reputation + ")");
        else actionDescription += `\nNew owner has high onchain reputation (score = " + reputation + ")`;
        break;
      case "removeOwner":
        actionDescription = `Remove owner ${params?.[1].value} and change threshold to ${params?.[2].value}`;
        break;
      case "changeThreshold":
        actionDescription = `Change confirmation threshold to ${params?.[0].value}`;
        break;
      case "enableModule":
        actionDescription = `Enable module at address ${params?.[0].value}`;
        break;
      default:
        if (tx.value !== "0") {
          actionDescription = `Transfer ${parseFloat(tx.value) / 1e18} ETH to ${tx.to}`;
        } else {
          actionDescription = `Call method '${method}' on contract ${tx.to}`;
        }
    }
  } else if (tx.value !== "0") {
      actionDescription = `Transfer ${parseFloat(tx.value) / 1e18} ETH to ${tx.to}`;
  }

  // 1. Check if this changes Safe configuration
  if (tx.dataDecoded?.method.includes("Owner") || tx.dataDecoded?.method === "changeThreshold") {
    riskFactors.push("⚠️ This transaction modifies Safe ownership/configuration");
  }

  // 2. Check value transfer risks
  // Check value transfer
  let ethValue = 0;
  if (tx.value !== "0") {
    ethValue = parseFloat(tx.value) / 1e18;
    const balance = await provider.getBalance({address: safeAddress});
    const safeBalance = balance ? parseFloat(balance.toString()) / 1e18 : 0;
    
    if (ethValue > safeBalance * 0.5) {
      riskFactors.push(`⚠️ High-value transfer: ${ethValue} ETH (${Math.round(ethValue/safeBalance*100)}% of Safe balance)`);
    }
  }

  // 3. Check destination address
  let isContract = false;
  if (tx.to) {  
    console.log("tx.to: ", tx.to);
    
    // Check if destination is a contract
    const code = await provider.getCode({address: tx.to});
    isContract = Boolean(code && code !== "0x");

    // Check if this is an ERC20 transfer to the token contract itself
    if (isContract && tx.dataDecoded?.method === "transfer") {
      const params = tx.dataDecoded.parameters;
      const destinationParam = params?.find(p => p.name === "dst" || p.name === "to");
      if (destinationParam?.value.toLowerCase() === tx.to.toLowerCase()) {
        riskFactors.push("🚨 HIGH RISK: ERC20 transfer to the token contract itself - funds will likely be lost!");
      }
    }

    // Check if this is a direct ETH transfer to a contract
    if (isContract && tx.value !== "0" && !tx.dataDecoded) {
      riskFactors.push("🚨 HIGH RISK: Direct ETH transfer to contract address without function call - funds may be lost!");
    }

    // Check if destination is safe owner
    if(!isContract) {
      const isSafeOwner = owners.includes(tx.to);
      if(isSafeOwner) {
        actionDescription += `\nTransfer address is a Safe owner`;
      }
      else {
        riskFactors.push(`⚠️ Transfer address is not a Safe owner`);
      }
    }

    // Check address reputation
    if(!isContract) {
        const address = new ExternalAddress("base-mainnet", tx.to);
        const reputation = (await address.reputation()).score;
        if(reputation < 20) {
          riskFactors.push("⚠️ Transfer address has low onchain reputation (score = " + reputation + ")");
        }
        else {
          actionDescription += `\nTransfer address has high onchain reputation (score = " + reputation + ")`;
        }
    } 
    // // Check if it's a known contract (could expand this list)
    // const knownContracts: Record<string, string> = {
    //   "0x...": "Uniswap V3",
    //   // Add more known contracts
    // };
    
    // if (isContract && !knownContracts[tx.to.toLowerCase()]) {
    //   riskFactors.push("⚠️ Interaction with unverified contract");
    // }
  }

  // Add Etherscan contract verification check
  const chainId = await provider.getChainId();
  const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
  if (ETHERSCAN_API_KEY) {
    try {
      const baseUrl = `https://api.etherscan.io/v2/api?chainId=${chainId}`

      if(isContract) {
        const response = await fetch(
          `${baseUrl}&module=contract&action=getsourcecode&address=${tx.to}&apikey=${ETHERSCAN_API_KEY}`
        );
        const data = await response.json();
    
        if (data.status === "1" && data.result[0]) {
          contractInfo.abi = data.result[0].ABI;
          if (!data.result[0].ContractName) {
            riskFactors.push(`⚠️ Interaction with contract (${tx.to}) that is not verified on Etherscan/Basescan`);
          } else {
            actionDescription += `\nInteraction with contract ${data.result[0].ContractName} (${tx.to}) that is verified on etherscan`;
          }
        }
      }

    } catch (error) {
      console.error("Etherscan API error:", error);
    }
  }

  // Format the analysis
  const analysis = `
Transaction Analysis:
- Proposed by: ${tx.proposer}
- Proposed at: ${proposedAt}
- Status: ${confirmationStatus}
- Confirmed by: ${confirmedBy}
- Action: ${actionDescription}
- Risk Assessment:
${riskFactors.length > 0 ? riskFactors.join('\n') : '- No significant risk factors identified'}
`;

  return analysis;
};
