# SafeGPT

<p align="center">
  <img src="frontend/public/logo.png" alt="SafeGPT Logo" width="100"/>
</p>

**SafeGPT** is an AI-powered assistant designed to help users interact with the [Safe Protocol](https://app.safe.global/welcome) to set up and manage smart accounts for secure and efficient onchain asset management. Smart account add robust multi-signature (multi-sig) capabilities that enhance security by requiring multiple approvals for transactions.
Built on top of [Coinbase's AgentKit](https://github.com/coinbase/agentkit) and integrating the [Safe SDK](https://github.com/safe-global/safe-core-sdk), 
SafeGPT is powered by an intelligent onchain agent that assists users in creating and managing Safe smart accounts with ease.

## Features

- 🤖 AI-powered chat interface for interacting with the Safe Protocol
- 🏦 Create new Safe multi-signer
- 🔍 View Safe account details 
- 👥 Manage Safe account signers 
- 📝 Propose and execute transactions
- ⚠️ Risk analysis of pending transactions
- 💰 Setup and manage allowance modules

## Example use cases

- Use agent as co-signer to setup smart account. When satisfied with settings, remove the agent as signer
- Perform risk analysis of pending transactions before signing them
- Give your agent (or anyone) a monthly allowance

## How?

1. Visit: [safe-gpt.vercel.app](safe-gpt.vercel.app)
2. Start chatting with the AI assistant

## Security Considerations

- Transactions are performed on the sepolia-testnet
- **Do NOT send mainnet funds, they will be lost!**
- The AI agent can be added as a co-signer but should be removed once no longer needed
- Always review transactions carefully before execution
- The AI performs risk analysis but should not be the only factor in decision-making

## Architecture

- Backend: Node.js API using Coinbase AgentKit and Safe SDK
- Frontend: React-based chat interface
- Deployment: Render (API) + Vercel (Frontend)

## How to run it yourself?

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Ethereum wallet (MetaMask recommended)
- API key from OpenAI
- API key from Coinbase Developer Portal
- API key from Etherscan

### Installation

1. Clone the repository:
```
    git clone https://github.com/phdargen/safeGPT.git
    cd safeGPT
```
2. Set up your environment variables:
```
    cp .env.example .env
    # Edit the .env file with your API keys and other required values
```

3. Install backend dependencies:
```
    cd agentkit
    npm install 
    npm run build && npm i

    cd backend
    npm install
```
3. Install frontend dependencies:
```
    cd frontend
    npm install
```

### Running Locally

1. Start the backend:
```
    cd backend
    npm run build && npm start
    # A wallet for your agent will be automatically created
```
2. Start the frontend:
```
    cd frontend
    npm start
    # The application will be available at `http://localhost:3000`
```
