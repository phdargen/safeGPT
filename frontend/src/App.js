import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";

// const SOCKET_URL = "https://safegpt.onrender.com";
const SOCKET_URL = "http://localhost:4000";

const socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 20,
  reconnectionDelay: 10000
});

function App() {
  const MAX_CHARS = 300;
  const [message, setMessage] = useState("");
  const [responses, setResponses] = useState([]);
  const [toolResponses, setToolResponses] = useState([]);
  const [walletInfo, setWalletInfo] = useState({
    address: '-',
    network: '-',
    balance: '-'
  });
  const [safeInfo, setSafeInfo] = useState({
    address: '-',
    balance: '-',
    owners: [],
    threshold: 0,
    pendingCount: 0,
    pendingTxs: []
  });
  const [status, setStatus] = useState("Connecting...");
  const [ethPrice, setEthPrice] = useState(0);

  // Lifecycle
  // ----------
  useEffect(() => {
    // Wake up the backend by making an HTTP request first
    fetch(SOCKET_URL)
      .then(() => {
        console.log("Backend warmed up!");
        socket.connect(); // Now, connect WebSocket
      })
      .catch((error) => console.error("Error waking up backend:", error));
  
    // Remove any existing listeners before adding new ones
    socket.removeAllListeners();
    
    socket.on("connect", () => {
      setStatus("Connected");

      // Welcome the user to SafeGPT
      //socket.emit("chat-message", "Welcome the user to SafeGPT.");
      
      // Silent wallet info request - won't show in chat
      socket.emit("silent-request", "Get your wallet details using get_wallet_details tool.");

    });
  
    socket.on("connect_error", (error) => setStatus(`Connection Error: ${error.message || error}`));
  
    socket.on("agent-response", (response) => {
      if(response !== "") {
         setResponses((prev) => [...prev, `Agent: ${response}`]);
      }
    });
  
    socket.on("tool-response", (response) => {
      console.log("Tool response:", response);
      if (response.includes("Wallet Details:")) {
        // Parse wallet details
        const address = response.match(/Address: (0x[a-fA-F0-9]+)/)?.[1] || '-';
        const network = response.match(/Network ID: ([^\n*]+)/)?.[1] || '-';
        const balance = response.match(/ETH Balance: ([0-9.]+)/)?.[1] || '-';
        setWalletInfo({ address, network, balance });
      } else if (response.includes("Safe info:")) {
        console.log("Parsing Safe info:", response);
        // Parse safe info
        const safeAddress = response.match(/Safe at address: (0x[a-fA-F0-9]+)/)?.[1] || '-';
        const balance = response.match(/Balance: ([0-9.]+)/)?.[1] || '-X';
        const owners = response.match(/owners: ((?:0x[a-fA-F0-9]+(?:, )?)+)/)?.[1]?.split(', ') || [];
        const threshold = response.match(/Threshold: (\d+)/)?.[1] || '0';
        const pendingCount = response.match(/Pending transactions: (\d+)/)?.[1] || '0';
        const pendingTxs = response.match(/Transaction ([^\n]+)/g)?.map(tx => {
          const [hash, confirmations] = tx.match(/Transaction (0x[a-fA-F0-9]+) \((\d+\/\d+)/)?.slice(1) || [];
          return { hash, confirmations };
        }) || [];
        
        setSafeInfo({
          address: safeAddress,
          balance,
          owners,
          threshold: parseInt(threshold),
          pendingCount: parseInt(pendingCount),
          pendingTxs
        });
      }
      setToolResponses((prev) => [...prev, `Tool: ${response}`]);
    });
  
    return () => {
      console.log("Disconnecting WebSocket...");
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);
  
  // User interaction
  // ----------------
  const sendMessage = () => {
    if (message.trim()) {
      socket.emit("chat-message", message);
      setResponses((prev) => [...prev, `${message}`]);
      setMessage("");
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

  // UI
  // ---
  return (
    <div className="min-h-screen bg-gray-900">
      <header className="fixed top-0 left-0 w-full bg-primary shadow-lg z-50">
        <div className="container mx-auto px-4 h-16 flex items-center">
          <h1 className="text-4xl font-bold text-white flex-1 text-center">SafeGPT</h1>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex h-[calc(100vh-4rem)]">
        {/* Left side - Chat */}
        <div className="w-2/3 px-4 pt-20 pb-24 overflow-y-auto">
          <div className="space-y-4">
            {responses.map((res, index) => (
              <div 
                key={index} 
                className={`p-4 rounded-lg ${
                  res.startsWith('Agent:') 
                    ? 'bg-blue-600 text-white ml-auto max-w-[80%]' 
                    : 'bg-gray-800 text-gray-100 max-w-[80%]'
                }`}
              >
                {res.startsWith('Agent:') ? res.replace('Agent: ', '') : res}
              </div>
            ))}
          </div>
        </div>

        {/* Right side - Info Boxes */}
        <div className="w-1/3 pt-20 pb-24 px-4 space-y-4 overflow-y-auto">
          {/* Agent Info Box */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-4">Agent Info</h2>
            <div className="text-gray-300 space-y-2">
              <p>Status: {status}</p>
              <p>Address: {
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
              }</p>
              <p>Network: {walletInfo.network}</p>
              <p>Balance: {formatBalance(walletInfo.balance)} </p>
            </div>
          </div>

          {/* Safe Info Box */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-4">Safe Info</h2>
            <div className="text-gray-300 space-y-2">
              <p>Address: {
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
              }</p>
              <p>Balance: {formatBalance(safeInfo.balance)}</p>
              <p>Threshold: {safeInfo.threshold} of {safeInfo.owners.length} signers</p>
              <p>Signers:</p>
              <ul className="ml-4 space-y-1">
                {safeInfo.owners.map((owner, i) => (
                  <li key={i}>• {<a href={`${getEtherscanUrl(walletInfo.network)}address/${owner}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">{truncateAddress(owner)}</a>}</li>
                ))}
              </ul>
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
        </div>
      </div>

      <div className="fixed bottom-0 left-0 w-full bg-white border-t p-4">
        <div className="container mx-auto flex gap-4">
          <div className="flex-1 relative">
            <input
              type="text"
              value={message}
              onChange={handleInputChange}
              maxLength={MAX_CHARS}
              placeholder="Type a message..."
              className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
            />
            <span className="absolute bottom-2 right-2 text-sm text-gray-500">
              {message.length}/{MAX_CHARS}
            </span>
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
  );
}

export default App;
