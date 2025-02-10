import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import './App.css';

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
    <div className="App">
      <header className="App-header">
        <h1 className="App-title">PinguGPT</h1>
        <p className="App-status">Status: {status}</p>
      </header>
  
      <div className="App-content">
        <div className="response-container">
          {responses.map((res, index) => (
            <p key={index}>{res}</p>
          ))}
        </div>
      </div>
  
      <div className="chat-input-container">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message..."
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}

export default App;
