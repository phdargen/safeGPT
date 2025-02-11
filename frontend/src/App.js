import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = "https://safegpt.onrender.com";
const socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

function App() {
  const [message, setMessage] = useState("");
  const [responses, setResponses] = useState([]);
  const [status, setStatus] = useState("Connecting...");

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
    
    socket.on("connect", () => setStatus("Connected"));
    socket.on("connect_error", (error) => setStatus(`Connection Error: ${error.message || error}`));
  
    socket.on("agent-response", (response) => {
      setResponses((prev) => [...prev, `Agent: ${response}`]);
    });
  
    // socket.on("tool-response", (response) => {
    //   setResponses((prev) => [...prev, `Tool: ${response}`]);
    // });
  
    return () => {
      console.log("Disconnecting WebSocket...");
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);
  
  const sendMessage = () => {
    if (message.trim()) {
      socket.emit("chat-message", message);
      setResponses((prev) => [...prev, `Prompt: ${message}`]);
      setMessage("");
    }
  };

  return (
    <div className="min-h-screen bg-gray-900">
      <header className="fixed top-0 left-0 w-full bg-primary shadow-lg">
        <div className="container mx-auto px-4 h-16 flex items-center">
          <h1 className="text-4xl font-bold text-white flex-1 text-center">SafeGPT</h1>
          <p className="text-sm text-gray-300">Status: {status}</p>
        </div>
      </header>

      <main className="container mx-auto px-4 pt-20 pb-24">
        <div className="space-y-4">
          {responses.map((res, index) => (
            <div 
              key={index} 
              className={`p-4 rounded-lg ${
                res.startsWith('Prompt:') 
                  ? 'bg-blue-600 text-white ml-auto max-w-[80%]' 
                  : 'bg-gray-800 text-gray-100 max-w-[80%]'
              }`}
            >
              {res}
            </div>
          ))}
        </div>
      </main>

      <div className="fixed bottom-0 left-0 w-full bg-white border-t p-4">
        <div className="container mx-auto flex gap-4">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
          />
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
