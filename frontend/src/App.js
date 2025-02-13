import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import ReactMarkdown from 'react-markdown';

//const SOCKET_URL = "https://safegpt.onrender.com";
const SOCKET_URL = "http://localhost:4000";

const socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 20,
  reconnectionDelay: 10000,
  timeout: 20000
});

function App() {
  const MAX_CHARS = 200;
  const SUGGESTED_PROMPTS_INITIAL = [
    "What is a Safe smart account?",
    "Create a new Safe",
    "Get info about the safe at <safe-address>",
  ];

  // Move this inside the component to make it dynamic
  const getSuggestedPrompts = () => [
    "Get info about the safe at <safe-address>",
    "Add signer <eth-address>",
    "Remove signer <eth-address>",
    "Change threshold to <threshold>",
    ...(safeInfo.pendingTxs.length > 0 ? ["Analyze pending transaction <tx-hash>"] : ["Withdraw all ETH to <eth-address>"]),
    ...(safeInfo.pendingTxs.length > 0 ? ["Execute pending transaction <tx-hash>"] : []),
    ...(walletInfo.network === "ethereum-sepolia" && !safeInfo.allowanceModuleEnabled ? ["Activate allowance module"] : []),
    ...(safeInfo.allowanceModuleEnabled ? ["Set allowance of 1 WETH for delegate <eth-address> "] : []),
  ];

  const [message, setMessage] = useState("");
  const [responses, setResponses] = useState([]);
  const [toolResponses, setToolResponses] = useState([]);
  const [walletInfo, setWalletInfo] = useState({
    address: '-',
    network: '-',
    balance: '-',
    wethBalance: '-'
  });
  const [safeInfo, setSafeInfo] = useState({
    address: '-',
    balance: '-',
    wethBalance: '-',
    owners: [],
    threshold: 0,
    allowanceModuleEnabled: false,
    pendingCount: 0,
    pendingTxs: []
  });
  const [status, setStatus] = useState("Connecting...");
  const [ethPrice, setEthPrice] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSafeInfoRequest, setLastSafeInfoRequest] = useState(0);
  const [transactions, setTransactions] = useState([]);

  // Lifecycle
  // ----------
  useEffect(() => {
    // Wake up the backend by making an HTTP request first
    console.log("Initializing connection...");
    fetch(SOCKET_URL)
      .then(() => {
        console.log("Backend warmed up!");
        if (!socket.connected) {
          socket.connect(); // Now, connect WebSocket
          console.log("Socket connecting...");
        } else {
          console.log("Socket already connected");
        }
        console.log("Socket connected with ID:", socket.id);
      })
      .catch((error) => {
        console.error("Error connecting to backend:", error);
        console.error("Error waking up backend:", error);
      });
  
    // Remove any existing listeners before adding new ones
    socket.removeAllListeners();
    
    socket.on("connect", () => {
      console.log("Socket connected with ID:", socket.id);
      setStatus("Connected");
    });
  
    socket.on("connected", (data) => {
      console.log("Server acknowledged connection with ID:", data.id);
      if(walletInfo.address === '-') {
        if (SOCKET_URL !== "http://localhost:4000") socket.emit("chat-message", "Welcome the user to SafeGPT. Best experienced on desktop.");
        socket.emit("silent-request", "Get your wallet details using get_wallet_details tool.");
      }
    });
  
    socket.on("connect_error", (error) => {
      console.error("Socket connect error:", error);
      console.error("Socket connect error details:", {
        readyState: socket.connected,
        url: SOCKET_URL,
        transport: socket.io.engine.transport.name
      });
      setStatus(`Connection Error: ${error.message || error}`);
    });
  
    socket.on("disconnect", (reason) => {
      console.log("Socket disconnected:", reason);
      setStatus(`Disconnected: ${reason}`);
    });

    socket.on("agent-response", (response) => {
      console.log("Received agent response:", response);
      if(response.trim() !== "") {  
        setResponses((prev) => [
          ...prev, 
          `Agent: ${response}`,
          prev.length === 0 ? `**Warning**: This project is in beta, use at your own risk. All transactions are excecuted on testnets, **do NOT send any mainnet funds!**` : null
        ].filter(Boolean));
        setIsLoading(false);
      }
    });
  
    socket.on("tool-response", (response) => {
      console.log("Tool response:", response);
      if(response.includes("Error")){
        console.log("Error:", response);
      } else if (response.includes("Wallet Details:")) {
        // Parse wallet details
        const address = response.match(/Address: (0x[a-fA-F0-9]+)/)?.[1] || '-';
        const network = response.match(/Network ID: ([^\n*]+)/)?.[1] || '-';
        const balance = response.match(/ETH Balance: ([0-9.]+)/)?.[1] || '-';
        setWalletInfo({ address, network, balance });
      } else if (response.includes("Safe info:")) {
        // Parse safe info
        const safeAddress = response.match(/Safe at address: (0x[a-fA-F0-9]+)/)?.[1] || '-';
        const balance = response.match(/Balance: ([0-9.]+)/)?.[1] || '-X';
        const wethBalance = response.match(/WETH Balance: ([0-9.]+)/)?.[1] || '-X';
        const owners = response.match(/owners: ((?:0x[a-fA-F0-9]+(?:, )?)+)/)?.[1]?.split(', ') || [];
        const threshold = response.match(/Threshold: (\d+)/)?.[1] || '0';
        const allowanceModuleEnabled = response.match(/Allowance module enabled: (true|false)/)?.[1] || 'false';
        const pendingCount = response.match(/Pending transactions: (\d+)/)?.[1] || '0';
        const pendingTxs = response.match(/Transaction ([^\n]+)/g)?.map(tx => {
          const [hash, confirmations] = tx.match(/Transaction (0x[a-fA-F0-9]+) \((\d+\/\d+)/)?.slice(1) || [];
          return { hash, confirmations };
        }) || [];
        
        setSafeInfo({
          address: safeAddress,
          balance,
          wethBalance,
          owners,
          threshold: parseInt(threshold),
          allowanceModuleEnabled,
          pendingCount: parseInt(pendingCount),
          pendingTxs
        });
      } else if (response.includes("Add signer:")) {
        console.log("Add signer response:", response);
        // Tx proposed but not executed yet
        if(response.includes("proposed")){
          const txHash = response.match(/Safe transaction hash: [^\s]+\/(0x[a-fA-F0-9]+)/)?.[1];
          if (txHash) {
            setSafeInfo(prev => ({
              ...prev,
              pendingTxs: [...prev.pendingTxs, { hash: txHash, confirmations: `1/${safeInfo.threshold}` }],
              pendingCount: prev.pendingCount + 1
            }));
          }
        }
        else {
          // Update safe info after adding signer
          const newSigner = response.match(/Successfully added signer (0x[a-fA-F0-9]+)/)?.[1];
          const newThreshold = response.match(/Threshold: (\d+)/)?.[1];
          const txHash = response.match(/Transaction hash: (0x[a-fA-F0-9]+)/)?.[1];
          if (newSigner) {
            setSafeInfo(prev => ({
              ...prev,
              owners: [...prev.owners, newSigner],
              threshold: newThreshold ? parseInt(newThreshold) : prev.threshold
            }));
          }
          if (txHash) {
            setTransactions(prev => [...prev, {
              hash: txHash,
              type: 'Add Signer',
              timestamp: Date.now()
            }]);
          }
        }
      } else if (response.includes("Remove signer:")) {
        console.log("Remove signer response:", response);
        // Tx proposed but not executed yet 
        if(response.includes("proposed")){
          const txHash = response.match(/Safe transaction hash: [^\s]+\/(0x[a-fA-F0-9]+)/)?.[1];
          if (txHash) {
            setSafeInfo(prev => ({
              ...prev,
              pendingTxs: [...prev.pendingTxs, { hash: txHash, confirmations: `1/${safeInfo.threshold}` }],
              pendingCount: prev.pendingCount + 1
            }));
          }
        }
        else{
          // Update safe info after removing signer
          const removedSigner = response.match(/Successfully removed signer (0x[a-fA-F0-9]+)/)?.[1];
          const newThreshold = response.match(/Threshold: (\d+)/)?.[1];
          const txHash = response.match(/Transaction hash: (0x[a-fA-F0-9]+)/)?.[1];
          console.log("Transaction hash:", txHash);
          if (removedSigner) {
            setSafeInfo(prev => ({
              ...prev,
            owners: prev.owners.filter(owner => owner !== removedSigner),
            threshold: newThreshold ? parseInt(newThreshold) : prev.threshold
          }));
          }
          if (txHash) {
            setTransactions(prev => [...prev, {
            hash: txHash,
            type: 'Remove Signer',
            timestamp: Date.now()
          }]);
          }
        }
      } else if (response.includes("Change threshold:")) {
        // Tx proposed but not executed yet
        if(response.includes("proposed")){
          const txHash = response.match(/Safe transaction hash: [^\s]+\/(0x[a-fA-F0-9]+)/)?.[1];
          if (txHash) {
            setSafeInfo(prev => ({
              ...prev,
              pendingTxs: [...prev.pendingTxs, { hash: txHash, confirmations: `1/${safeInfo.threshold}` }],
              pendingCount: prev.pendingCount + 1
            }));
          }
        }
        else{
          // Update safe info after changing threshold
          const newThreshold = response.match(/threshold to (\d+)/)?.[1];
          const txHash = response.match(/Transaction hash: (0x[a-fA-F0-9]+)/)?.[1];
          if (newThreshold) {
            setSafeInfo(prev => ({
            ...prev,
            threshold: parseInt(newThreshold)
            }));
          }
          if (txHash) {
            setTransactions(prev => [...prev, {
            hash: txHash,
            type: 'Change Threshold',
            timestamp: Date.now()
            }]);
          }
        }
      } else if (response.includes("Create safe:")) {
        console.log("Create safe response:", response);
        // Extract safe address and tx hash
        const newSafeAddress = response.match(/created Safe at address (0x[a-fA-F0-9]+)/)?.[1];
        const newSafeThreshold = response.match(/threshold of (\d+)/)?.[1];
        const newSafeOwners = response.match(/signers (0x[a-fA-F0-9]+(?:, )?)+/)?.[1]?.split(', ') || [];
        const txHash = response.match(/Transaction link: [^\s]+\/(0x[a-fA-F0-9]+)/)?.[1];
        if (newSafeAddress) {
          setSafeInfo(prev => ({
            ...prev,
            address: newSafeAddress,
            threshold: newSafeThreshold ? parseInt(newSafeThreshold) : prev.threshold,
            owners: newSafeOwners,
            pendingCount: 0,
            pendingTxs: [],
            balance: 0
          }));
        }
        if (txHash) {
          setTransactions(prev => [...prev, {
            hash: txHash,
            type: 'Create Safe',
            timestamp: Date.now()
          }]);
        }
      } else if (response.includes("Withdraw ETH:")) {
        // Tx proposed but not executed yet
        if(response.includes("proposed")){
          const txHash = response.match(/Safe transaction hash: [^\s]+\/(0x[a-fA-F0-9]+)/)?.[1];
          if (txHash) {
            setSafeInfo(prev => ({
              ...prev,
              pendingTxs: [...prev.pendingTxs, { hash: txHash, confirmations: `1/${safeInfo.threshold}` }],
              pendingCount: prev.pendingCount + 1,
            }));
          }
        }
        else{
          console.log("Withdraw ETH response:", response);
          const txHash = response.match(/Transaction hash: (0x[a-fA-F0-9]+)/)?.[1];
          const withdrawAmount = response.match(/withdrew ([0-9.]+)/)?.[1];
          console.log("withdrawAmount", withdrawAmount);
          if (txHash) {
            setSafeInfo(prev => ({
              ...prev,
              balance: prev.balance - withdrawAmount
            }));
            setTransactions(prev => [...prev, {
              hash: txHash,
              type: 'Withdraw ETH',
              timestamp: Date.now()
              }]);
          }
        }
      } else if (response.includes("Enable allowance module:")) {
        // Tx proposed but not executed yet
        if(response.includes("proposed")){
          const txHash = response.match(/Safe transaction hash: [^\s]+\/(0x[a-fA-F0-9]+)/)?.[1];
          if (txHash) {
            setSafeInfo(prev => ({
              ...prev,
              pendingTxs: [...prev.pendingTxs, { hash: txHash, confirmations: `1/${safeInfo.threshold}` }],
              pendingCount: prev.pendingCount + 1,
            }));
          }
        }else{
          const txHash = response.match(/Transaction hash: (0x[a-fA-F0-9]+)/)?.[1];
          if (txHash) {
              setSafeInfo(prev => ({
              ...prev,
              allowanceModuleEnabled: true
            }));
            setTransactions(prev => [...prev, {
              hash: txHash,
              type: 'Enable Allowance Module',
              timestamp: Date.now()
            }]);
          }
        }
      }else if (response.includes("Set allowance:")) {
        if(response.includes("proposed")){
          const txHash = response.match(/Safe transaction hash: [^\s]+\/(0x[a-fA-F0-9]+)/)?.[1];
          if (txHash) {
            setSafeInfo(prev => ({
              ...prev,
              pendingTxs: [...prev.pendingTxs, { hash: txHash, confirmations: `1/${safeInfo.threshold}` }],
              pendingCount: prev.pendingCount + 1,
            }));
          }
        }
        else{
          const txHash = response.match(/Transaction hash: (0x[a-fA-F0-9]+)/)?.[1];
          if (txHash) {
            setSafeInfo(prev => ({
              ...prev,
              allowanceModuleEnabled: true
            }));
            setTransactions(prev => [...prev, {
              hash: txHash,
              type: 'Set Allowance',
              timestamp: Date.now()
            }]);
          }
        }
      } else {
        // If none of the above patterns match and we have a safe address, request updated safe info
        // TODO: test this!
        //requestSafeInfo();
      }
      setToolResponses((prev) => [...prev, `Tool: ${response}`]);
    });
  
    socket.on("error", (error) => {
      console.error("Socket error:", error);
      setStatus(`Error: ${error}`);
    });
  
    return () => {
      console.log("Disconnecting WebSocket...");
      socket.removeAllListeners();
      //socket.disconnect();
    };
  }, [safeInfo.address, lastSafeInfoRequest, walletInfo.address]);
  
  // User interaction
  // ----------------
  const sendMessage = () => {
    if (message.trim()) {
      socket.emit("chat-message", message);
      setResponses((prev) => [...prev, `${message}`]);
      setMessage("");
      setIsLoading(true);
    }
  };

  const handleInputChange = (e) => {
    const input = e.target.value;
    if (input.length <= MAX_CHARS) {
      setMessage(input);
    }
  };

  // Helper functions
  // --------------
  const fetchEthPrice = async () => { 
    if (ethPrice !== 0) return;
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
      );
      const data = await response.json();
      setEthPrice(data.ethereum.usd);
      console.log(data.ethereum.usd);
    } catch (error) {
      console.error('Error fetching ETH price:', error);
    }
  };

  const formatBalance = (balance) => {
    if (balance === '-') return '-';
    const roundedEth = Number(balance).toFixed(4);
    fetchEthPrice();
    if (ethPrice === 0) return `${roundedEth} ETH`;
    const usdValue = (roundedEth * ethPrice).toFixed(2);
    return `${roundedEth} ETH (~$${usdValue})`;
  };

  const truncateAddress = (address) => {
    if (!address || address === '-') return '-';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getEtherscanUrl = (network) => {
    if(network === 'ethereum-sepolia') return 'https://sepolia.etherscan.io/'
    return 'https://sepolia.basescan.org/'
  };

  const getSafeDashboardUrl = () => {
    return 'https://app.safe.global/'
  };

  const getSafeDashboardChain = (network) => {
    if(network === 'ethereum-sepolia') return 'safe=sep'
    return 'safe=basesep'
  };

  const getAgentStatus = (owners) => {
    if (!walletInfo.address || walletInfo.address === '-') return 'Not Connected';
    const isAgentSigner = owners.some(owner => 
      owner.toLowerCase() === walletInfo.address.toLowerCase()
    );
    return isAgentSigner ? 'Connected (Signer)' : (safeInfo.address !== '-' ? 'Connected (Read-only)' : 'Not Connected');
  };

  // Helper function to request safe info
  const requestSafeInfo = () => {
    const now = Date.now();
    // Prevent requesting more than once per 5 seconds
    if (now - lastSafeInfoRequest > 5000 && safeInfo.address !== '-') {
      console.log("Requesting safe info update...");
      socket.emit("silent-request", `Get safe info for ${safeInfo.address} using safe_info tool.`);
      setLastSafeInfoRequest(now);
    }
  };  

  // UI
  // ---
  return (
    <div className="min-h-screen bg-gray-900">
      <header className="fixed top-0 left-0 w-full bg-gradient-to-r from-blue-600 via-gray-800 to-blue-600 shadow-lg z-50">
        <div className="container mx-auto px-4 h-18 flex items-center">
          <h1 className="text-5xl font-bold text-white flex-1 text-center">SafeGPT</h1>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row h-[calc(100vh-4rem)]">
        {/* Left side - Chat */}
        <div className="w-full lg:w-2/3 px-4 pt-20 pb-48 overflow-y-auto">
          <div className="space-y-4">
            {responses.map((res, index) => (
              <div 
                key={index} 
                className={`p-4 rounded-lg ${
                  res.startsWith('Agent:') 
                    ? 'bg-blue-600 text-white ml-auto max-w-[80%]' 
                    : res.startsWith('**Warning**:')
                      ? 'bg-red-600 text-white max-w-[80%]'
                      : 'bg-green-500 text-gray-100 max-w-[80%]'
                }`}
              >
                <ReactMarkdown 
                  className="markdown"
                  components={{
                    // Style markdown elements
                    p: ({node, ...props}) => <p className="mb-2" {...props} />,
                    a: ({node, href, ...props}) => (
                      <a 
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-200 hover:text-white underline" 
                        {...props} 
                      />
                    ),
                    ul: ({node, ...props}) => <ul className="list-disc ml-4 mb-2" {...props} />,
                    ol: ({node, ...props}) => <ol className="list-decimal ml-4 mb-2" {...props} />,
                    li: ({node, ...props}) => <li className="mb-1" {...props} />,
                    code: ({node, inline, ...props}) => 
                      inline 
                        ? <code className="bg-gray-700 px-1 rounded" {...props} />
                        : <code className="block bg-gray-700 p-2 rounded my-2 overflow-x-auto" {...props} />,
                  }}
                >
                  {res.startsWith('Agent:') ? res.replace('Agent: ', '') : res}
                </ReactMarkdown>
              </div>
            ))}
            {isLoading && (
              <div className="bg-blue-600 text-white ml-auto max-w-[80%] p-4 rounded-lg">
                <div className="typing-animation">
                  <span>.</span><span>.</span><span>.</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right side - Info Boxes */}
        <div className="w-full lg:w-1/3 pt-20 pb-48 px-4 space-y-4 overflow-y-auto">
          {/* Agent Info Box */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-4">Agent Info</h2>
            <div className="text-gray-300 space-y-2">
              <p>Status: {status}</p>
              {walletInfo.address !== '-' && <p>Address: {
                walletInfo.address !== '-' ? (
                  <a 
                    href={`${getEtherscanUrl(walletInfo.network)}address/${walletInfo.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300"
                  >
                    {truncateAddress(walletInfo.address)}
                  </a>
                ) : '-'
              }</p>}
              {walletInfo.network !== '-' && <p>Network: {walletInfo.network}</p>}
              {walletInfo.balance !== '-' && <p>Balance: {formatBalance(walletInfo.balance)}</p>}
              {/* {walletInfo.wethBalance !== '-' && <p>WETH Balance: {formatBalance(walletInfo.wethBalance)}</p>} */}
            </div>
          </div>

          {/* Safe Info Box */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-4">Safe Info</h2>
            <div className="text-gray-300 space-y-2">
              <p>Status: {getAgentStatus(safeInfo.owners)}</p>
              {safeInfo.address !== '-' && <p>Address: {
                safeInfo.address !== '-' ? (
                  <a 
                    href={`${getSafeDashboardUrl()}home?${getSafeDashboardChain(walletInfo.network)}:${safeInfo.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300"
                  >
                    {truncateAddress(safeInfo.address)}
                  </a>
                ) : '-'
              }</p>}
              {safeInfo.balance !== '-' && <p>Balance: {formatBalance(safeInfo.balance)}</p>}
              {safeInfo.wethBalance !== '-' && <p>WETH Balance: {formatBalance(safeInfo.wethBalance)}</p>}
              {safeInfo.allowanceModuleEnabled && <p>Allowance Module Enabled</p>}
              {safeInfo.owners.length > 0 && (
                <>
                  <p>Threshold: {safeInfo.threshold} of {safeInfo.owners.length} signers</p>
                  <p>Signers:</p>
                  <ul className="ml-4 space-y-1">
                    {safeInfo.owners.map((owner, i) => (
                      <li key={i}>• {
                        <a 
                          href={`${getEtherscanUrl(walletInfo.network)}address/${owner}`} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="text-blue-400 hover:text-blue-300"
                        >
                          {truncateAddress(owner)}
                        </a>
                      } {owner.toLowerCase() === walletInfo.address.toLowerCase() ? '(Agent)' : ''}</li>
                    ))}
                  </ul>
                </>
              )}
              {safeInfo.pendingTxs.length > 0 && (
                <>
                  <p className="mt-4">Pending Transactions: {safeInfo.pendingTxs.length}</p>
                  <ul className="ml-4 space-y-1">
                    {safeInfo.pendingTxs.map((tx, i) => (
                      <li key={i}>• {<a href={`${getSafeDashboardUrl()}transactions/tx?${getSafeDashboardChain(walletInfo.network)}:${safeInfo.address}&id=multisig_${safeInfo.address}_${tx.hash}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">{truncateAddress(tx.hash)}</a>} ({tx.confirmations})</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          {/* Transaction History Box */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-4">Transaction History</h2>
            <div className="text-gray-300 space-y-2">
              {transactions.length > 0 ? (
                <ul className="ml-4 space-y-1">
                  {transactions.map((tx, i) => (
                    <li key={i}>• {tx.type}: {
                      <a 
                        href={`${getEtherscanUrl(walletInfo.network)}tx/${tx.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300"
                      >
                        {truncateAddress(tx.hash)}
                      </a>
                    }</li>
                  ))}
                </ul>
              ) : (
                <p>No transactions yet</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Input area at bottom */}
      <div className="fixed bottom-0 left-0 w-full bg-white border-t p-4">
        <div className="container mx-auto flex flex-col gap-4">
          {/* Suggested Prompts */}
          <div className="flex flex-wrap gap-2 overflow-x-auto pb-2">
            {(safeInfo.address === '-' ? SUGGESTED_PROMPTS_INITIAL : getSuggestedPrompts()).map((prompt, index) => (
              <button
                key={index}
                onClick={() => {
                  setMessage(prompt.replace(/<[^>]+>/g, ''));
                  document.querySelector('input[type="text"]').focus();
                }}
                className="bg-blue-500 hover:bg-secondary text-white px-4 py-2 rounded-full text-sm transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
          
          {/* Input Area */}
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <input
                type="text"
                value={message}
                onChange={handleInputChange}
                maxLength={MAX_CHARS}
                placeholder="Type a message..."
                className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary shadow-sm"
              />
            </div>
            <button 
              onClick={sendMessage}
              className="px-6 py-3 bg-secondary text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
