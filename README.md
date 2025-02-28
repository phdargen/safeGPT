# SafeGPT

<p align="center">
  <img src="frontend/public/logo2.png" alt="SafeGPT Logo" width="100"/>
</p>

**SafeGPT** is an AI-powered assistant designed to help users interact with the [Safe Protocol](https://app.safe.global/welcome) for secure and efficient onchain asset management. Safe smart accounts add robust multi-signature (multi-sig) capabilities that enhance security by requiring multiple approvals for transactions. Built on top of [Coinbase's AgentKit](https://github.com/coinbase/agentkit) and integrating the [Safe SDK](https://github.com/safe-global/safe-core-sdk), **SafeGPT** is powered by an intelligent onchain agent that assists users in creating and managing Safe smart accounts with ease.

## Features

- 🤖 AI-powered chat interface for interacting with the Safe Protocol
- 📚 Knowledge-enhanced responses powered by RAG (Retrieval-Augmented Generation) using Safe documentation
- 🏦 Create new Safe multi-sig wallet
- 🔍 View Safe account details 
- 👥 Manage Safe account signers 
- 📝 Propose, approve and execute transactions
- ⚠️ Risk analysis of pending transactions including:
  - Detect Safe configuration changes 
  - Flag high value transfers
  - Check [onchain reputation score](https://docs.cdp.coinbase.com/reputation/docs/welcome) of destination address
  - Check if smart contract is verified on etherscan
  - Flag ERC20 transfer to the token contract itself as high risk
- 💰 Setup and manage allowance modules

## Example use cases

- Use agent as co-signer to setup smart account. When satisfied with settings, remove the agent as signer
- Get comfortable interacting with mult-sig accounts, no code or wallet needed
- Get info of any deployed Safe wallet
- Perform risk analysis of pending transactions before signing them
- Give your agent (or anyone) a monthly allowance to spend from your Safe 

## How?

1. Visit: [safe-gpt.vercel.app](https://safe-gpt.vercel.app/)
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
- RAG System: OpenAI embeddings + vector similarity search for knowledge retrieval
- Deployment: Render (API) + Vercel (Frontend) + Datastax AstraDB (VectorDB)

## How to run it yourself?

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Ethereum wallet (optional, if you want to act as co-signer)
- API key from OpenAI
- API key from Coinbase Developer Portal
- API key from Etherscan
- Astra DB account and credentials:
  - Application Token
  - Database Endpoint
  - Keyspace Name

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
4. Install frontend dependencies:
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
3. Initialize the vector database (optional, only needed once):
```
    cd vectorDB
    npm istall
    npm run start
    # This will populate the Astra DB with Safe documentation
```