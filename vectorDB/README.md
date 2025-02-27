# SafeGPT Vector Database Setup

This directory contains code to create and populate a vector database using AstraDB (https://docs.datastax.com/en/home/index.html) for the SafeGPT project.

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- An AstraDB account with API credentials
- OpenAI API key

## Environment Variables

Make sure your `.env` file contains the following variables:

```
ASTRA_DB_NAMESPACE="your_keyspace"
ASTRA_DB_COLLECTION="your_collection_name"
ASTRA_DB_API_ENDPOINT="your_astra_db_endpoint"
ASTRA_DB_APPLICATION_TOKEN="your_astra_db_token"

OPENAI_API_KEY="your_openai_api_key"
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Build the TypeScript code:

```bash
npm run build
```

## Usage

Run the script to create the vector database and populate it with data:

```bash
npm start
```

This will:
1. Create a collection in AstraDB
2. Load web pages specified in the `data` array
3. Split the content into chunks
4. Generate embeddings using OpenAI
5. Store the embeddings in AstraDB

## Customization

- To add more URLs to process, edit the `data` array in `createBD.ts`
- To adjust chunk size or overlap, modify the `splitter` configuration in `createBD.ts` 