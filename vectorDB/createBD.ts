import {DataAPIClient} from "@datastax/astra-db-ts"
import {PuppeteerWebBaseLoader} from "@langchain/community/document_loaders/web/puppeteer";
import {RecursiveCharacterTextSplitter} from "langchain/text_splitter"

import OpenAI from "openai"

import "dotenv/config"

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
})

const data = [
    'https://help.safe.global/en/articles/276343-how-to-perform-basic-transactions-checks-on-safe-wallet'
]

const client = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN as string)
const db = client.db(process.env.ASTRA_DB_API_ENDPOINT as string, {namespace: process.env.ASTRA_NAMESPACE as string})

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 512,
    chunkOverlap: 100,
})

const createCollection = async () => {
    const collection = await db.createCollection(process.env.ASTRA_DB_COLLECTION as string, {
        vector: {
            dimension: 1536,
            metric: "cosine", // cosine, euclidean, dot_product
        },
    })
    console.log(collection)
    return collection
}

const loadSampleData = async () => {
    const collection = await db.collection(process.env.ASTRA_DB_COLLECTION as string)
    for await (const url of data) {
        const content = await scrapePage(url)
        const chunks = await splitter.splitText(content)
        for await (const chunk of chunks) {
            const embedding = await openai.embeddings.create({
                model: "text-embedding-3-small",
                input: chunk,
                encoding_format: "float",
            })

            const vector = embedding.data[0].embedding

            const result = await collection.insertOne({
                $vector: vector,
                text: chunk,
                metadata: {source: url},
            })
            console.log(result)
        }
    }
}

const scrapePage = async (url: string) => {
    const loader = new PuppeteerWebBaseLoader(url, {
        launchOptions: {
            headless: true,
        },
        gotoOptions: {
            waitUntil: "domcontentloaded",
        },
        evaluate: async (page, browser) => {
            const result = await page.evaluate(() => document.body.innerHTML)
            await browser.close()
            return result
        },
    })
    return (await loader.scrape())?.replace(/<[^>]*>?/gm, "")
}


// Test vector database with a query
const testVectorDB = async (query: string) => {
  
  // Get embedding for the query
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
    encoding_format: "float",
  });

  // Search the collection for relevant documents
  const collection = await db.collection(process.env.ASTRA_DB_COLLECTION as string);
  const result = await collection.find({}, {
    sort: {
      $vector: embedding.data[0].embedding,
    },
    limit: 10
  });
  
  const docs = await result.toArray();
  const docsMap = docs.map((doc) => doc.text);

  // Create a prompt with the retrieved context
  const docContext = JSON.stringify(docsMap);
  const prompt = `
    You are a helpful assistant that can answer questions about the following context:
    ${docContext}
    Answer the following question:
    ${query}
  `;
  console.log(prompt)

  // Generate an answer using the context
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{role: "user", content: prompt}],
  });
  
  return {
    query,
    relevantDocs: docsMap,
    answer: completion.choices[0].message.content
  };
};

// Test without vector DB 
const testDirectQuery = async (query: string) => {  
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{role: "user", content: query}],
  });
  
  return {
    query,
    answer: completion.choices[0].message.content
  };
};

// Function to compare results with and without vector DB
const compareResults = async (query: string) => {
  console.log(`Comparing results for query: "${query}"`);
  
  // Get results with vector DB
  const withVectorDB = await testVectorDB(query);
  
  // Get results without vector DB
  const withoutVectorDB = await testDirectQuery(query);
  
  console.log("Query:", query);
  console.log("\n==========================\n");
  console.log("With Vector DB:", "\n");
  console.log(withVectorDB.answer);
  console.log("\n==========================\n");

  console.log("Without Vector DB:", "\n");
  console.log(withoutVectorDB.answer);
  console.log("\n==========================\n");
  
  return {
    query,
    withVectorDB: withVectorDB.answer,
    withoutVectorDB: withoutVectorDB.answer
  };
};


const main = async () => {
  await createCollection();
  await loadSampleData();

  // Test prompt with vector DB and direct query
  const testPrompt = "How to perform basic transactions checks on safe wallet?";
  await compareResults(testPrompt);
};

// Run the main function
main().catch(console.error);
