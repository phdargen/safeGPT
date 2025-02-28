import {DataAPIClient} from "@datastax/astra-db-ts"
import {PuppeteerWebBaseLoader} from "@langchain/community/document_loaders/web/puppeteer";
import {RecursiveCharacterTextSplitter} from "langchain/text_splitter"

import OpenAI from "openai"

import "dotenv/config"

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY})

const data = [
    'https://help.safe.global/en/articles/40869-what-is-safe',
    'https://help.safe.global/en/articles/40840-why-do-i-need-to-connect-a-signer-wallet',
    'https://help.safe.global/en/articles/40868-creating-a-safe-on-a-web-browser',
    'https://help.safe.global/en/articles/40835-what-safe-setup-should-i-use',      
    'https://help.safe.global/en/articles/110656-account-recovery-with-safe-recoveryhub',
    'https://help.safe.global/en/articles/40825-supported-asset-types',
    'https://help.safe.global/en/articles/233902-safe-wallet-native-swaps',
    'https://help.safe.global/en/articles/232312-managing-assets',
    'https://help.safe.global/en/articles/40867-how-can-i-receive-assets',
    'https://help.safe.global/en/articles/180783-what-is-address-poisoning-and-how-does-safe-wallet-battle-it',
    'https://help.safe.global/en/articles/229313-gas-fee-sponsorship-on-safe-transactions',
    'https://help.safe.global/en/articles/234052-transaction-builder',
    'https://help.safe.global/en/articles/40820-send-funds',
    'https://help.safe.global/en/articles/40837-advanced-transaction-parameters',
    'https://help.safe.global/en/articles/40815-transaction-fees',
    'https://help.safe.global/en/articles/40817-reject-and-delete-transactions',
    'https://help.safe.global/en/articles/40865-gas-less-signatures',
    'https://help.safe.global/en/articles/40783-what-are-signed-messages',
    'https://help.safe.global/en/articles/40818-transaction-queue',
    'https://help.safe.global/en/articles/40822-export-transaction-data',
    'https://help.safe.global/en/articles/40823-submit-an-abi',
    'https://help.safe.global/en/articles/40828-gas-estimation',
    'https://help.safe.global/en/articles/235770-proposers',
    'https://help.safe.global/en/articles/40863-signature-policies',
    'https://help.safe.global/en/articles/229763-managing-safe-owners-and-signatures',
    'https://help.safe.global/en/articles/40842-set-up-and-use-spending-limits',
    'https://help.safe.global/en/articles/40827-what-is-a-module',
    'https://help.safe.global/en/articles/40826-add-a-module',
    'https://help.safe.global/en/articles/276343-how-to-perform-basic-transactions-checks-on-safe-wallet',
    'https://help.safe.global/en/articles/276344-how-to-verify-safe-wallet-transactions-on-a-hardware-wallet',
    'https://help.safe.global/en/articles/40834-verify-safe-creation',
    'https://help.safe.global/en/articles/40866-trustless-interface',
    'https://help.safe.global/en/articles/40850-sign-transactions-with-a-ledger-device',
    'https://help.safe.global/en/articles/40847-successfully-created-safe-does-not-show-up-in-the-web-interface-desktop-app',
    'https://help.safe.global/en/articles/40796-sub-safe-s',
    'https://help.safe.global/en/articles/40800-how-to-manage-cryptopunks-with-safe',
    'https://help.safe.global/en/articles/40813-why-can-t-i-transfer-eth-from-a-contract-into-a-safe',
    'https://help.safe.global/en/articles/40814-what-is-the-safe-transaction-hash-safetxhash',
    'https://help.safe.global/en/articles/40833-my-safe-transaction-failed-but-etherscan-reports-success-why-is-that',
    'https://help.safe.global/en/articles/40836-why-do-i-need-to-pay-for-cancelling-a-transaction',
    'https://help.safe.global/en/articles/40838-what-is-a-fallback-handler-and-how-does-it-relate-to-safe',
    'https://help.safe.global/en/articles/40839-why-are-transactions-with-the-same-nonce-conflicting-with-each-other',
    'https://help.safe.global/en/articles/40794-why-do-i-see-an-unexpected-delegate-call-warning-in-my-transaction',
    'https://docs.safe.global/home/glossary',
    'https://docs.safe.global/home/what-is-safe',
    'https://docs.safe.global/home/ai-overview',
    'https://www.cyfrin.io/blog/how-to-set-up-a-safe-multi-sig-wallet-step-by-step-guide',
    'https://www.cyfrin.io/blog/verify-safe-multi-sig-wallet-signatures-radiant-capital-hack',    
]

const client = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN as string)
const db = client.db(process.env.ASTRA_DB_API_ENDPOINT as string, {namespace: process.env.ASTRA_NAMESPACE as string})

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 512,
    chunkOverlap: 100,
})

// Helper function to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to retry a function with exponential backoff
const retry = async <T>(
  fn: () => Promise<T>, 
  retries = 3, 
  backoff = 1000
): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    if (retries <= 0) {
      throw error;
    }
    
    console.log(`Retrying after error: ${error.message}. Retries left: ${retries}`);
    await delay(backoff);
    return retry(fn, retries - 1, backoff * 2);
  }
};

const createCollection = async () => {
    try {
        const collection = await db.createCollection(process.env.ASTRA_DB_COLLECTION as string, {
            vector: {
                dimension: 1536, // should match the embedding model
                metric: "cosine", // cosine, euclidean, dot_product
            },
        })
        console.log("Collection created successfully:", collection);
        return collection;
    } catch (error: any) {
        // If collection already exists, just return it
        if (error.message && error.message.includes("already exists")) {
            console.log("Collection already exists, using existing collection");
            return db.collection(process.env.ASTRA_DB_COLLECTION as string);
        }
        throw error;
    }
}

const loadSampleData = async () => {
    const collection = db.collection(process.env.ASTRA_DB_COLLECTION as string);
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < data.length; i++) {
        const url = data[i];
        console.log(`Processing URL ${i+1}/${data.length}: ${url}`);
        
        try {
            // Add delay between requests to avoid overwhelming the server
            if (i > 0) {
                await delay(2000); // 2s delay between URLs
            }
            
            const content = await retry(() => scrapePage(url));
            if (!content) {
                console.log(`No content retrieved from ${url}, skipping`);
                errorCount++;
                continue;
            }
            
            const chunks = await splitter.splitText(content);
            
            for (let j = 0; j < chunks.length; j++) {
                const chunk = chunks[j];
                
                // Add small delay between embedding requests
                if (j > 0) {
                    await delay(500); // 500ms delay between embedding requests
                }
                
                try {
                    const embedding = await retry(() => openai.embeddings.create({
                        model: "text-embedding-3-small",
                        input: chunk,
                        encoding_format: "float",
                    }));

                    const vector = embedding.data[0].embedding;

                    const result = await collection.insertOne({
                        $vector: vector,
                        text: chunk,
                        metadata: {source: url},
                    });
                    
                    console.log(`Inserted chunk ${j+1}/${chunks.length}`);
                    //console.log(chunk);
                    successCount++;
                } catch (error: any) {
                    console.error(`Error processing chunk ${j+1}/${chunks.length} from ${url}:`, error.message);
                    errorCount++;
                }
            }
        } catch (error: any) {
            console.error(`Error processing URL ${url}:`, error.message);
            errorCount++;
        }
        console.log(`--------------------------------`);
    }
    
    console.log(`Data loading completed. Success: ${successCount}, Errors: ${errorCount}`);
}

const scrapePage = async (url: string) => {
    try {
        const loader = new PuppeteerWebBaseLoader(url, {
            launchOptions: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            },
            gotoOptions: {
                waitUntil: "domcontentloaded",
                timeout: 60000, // Increase timeout to 60 seconds
            },
            evaluate: async (page, browser) => {
                try {
                    // Target main content area more specifically
                    const result = await page.evaluate(() => {
                        // Remove unwanted elements
                        const elementsToRemove = document.querySelectorAll('header, footer, nav, script, style, .sidebar, .navigation');
                        elementsToRemove.forEach(el => el.remove());
                        
                        // Get the main content - adjust selector based on the actual page structure
                        const mainContent = document.querySelector('main, article, .article-content, .content')
                            || document.body;
                        
                        return mainContent.textContent || mainContent.innerHTML;
                    });
                    await browser.close();
                    return result;
                } catch (error: any) {
                    await browser.close();
                    throw error;
                }
            },
        });
        
        const content = await loader.scrape();
        return content?.replace(/<[^>]*>?/gm, "");
    } catch (error: any) {
        console.error(`Error scraping ${url}:`, error.message);
        throw error;
    }
}


// Test vector database with a query
const testVectorDB = async (query: string) => {
  try {
    // Get embedding for the query
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
      encoding_format: "float",
    });

    // Search the collection first to find most relevant document sources
    const collection = db.collection(process.env.ASTRA_DB_COLLECTION as string);
    const sourcesResult = await collection.find({}, {
      sort: {
        $vector: embedding.data[0].embedding,
      },
      limit: 10,
      projection: {
        metadata: 1,
      },
      includeSimilarity: true,
    }).toArray();

    // Extract unique source URLs from top results
    const topSources = [...new Set(sourcesResult.map(doc => doc.metadata?.source))];

    // Limit the top sources to 3
    const topSourcesLimited = topSources.slice(0, 3);

    // Second query filtering by the most relevant sources
    const result = collection.find(
      { "metadata.source": { $in: topSourcesLimited } },
      {
        sort: {
          $vector: embedding.data[0].embedding,
        },
        limit: 5,
        projection: {
          text: 1,
          metadata: 1,
        },
        includeSimilarity: true,
      }
    );
    
    const docs = await result.toArray();
    
    // Format documents with their sources and similarity scores
    const formattedDocs = docs.map((doc) => ({
      text: doc.text,
      source: doc.metadata?.source,
      similarity: doc.$similarity
    }));

    console.log(`
        Context from Safe documentation:
        ${formattedDocs.map(doc => `
        Source: ${doc.source}
        Content: ${doc.text}
        Similarity: ${doc.similarity?.toFixed(3)}
        ---`).join('\n')}
    `)

    // Get the document with highest similarity
    const mostRelevantDoc = formattedDocs[0];

    const prompt = `
You are a knowledgeable assistant specializing in Safe wallet and blockchain security. Use the following verified information to answer the question. If you're not sure about something, say so rather than making assumptions.

Context from Safe documentation:
${formattedDocs.map(doc => `
Content: ${doc.text}
Similarity: ${doc.similarity?.toFixed(3)}
---`).join('\n')}
Most relevant source: ${mostRelevantDoc.source}

Question: ${query}

Please provide a clear, accurate answer based solely on the provided context. Include relevant source URLs if appropriate.`;

    console.log(`Prompt with context: ${prompt}`);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful expert on Safe wallet and blockchain security. Provide accurate, focused answers based on the given context."
        },
        {
          role: "user",
          content: prompt
        }
      ],
    });
    
    return {
      query,
      relevantDocs: formattedDocs,
      answer: completion.choices[0].message.content
    };
  } catch (error: any) {
    console.error("Error in testVectorDB:", error.message);
    throw error;
  }
};

// Test without vector DB 
const testDirectQuery = async (query: string) => {  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{role: "user", content: query}],
    });
    
    return {
      query,
      answer: completion.choices[0].message.content
    };
  } catch (error: any) {
    console.error("Error in testDirectQuery:", error.message);
    throw error;
  }
};

// Function to compare results with and without vector DB
const compareResults = async (query: string) => {
  console.log(`Comparing results for query: "${query}"`);
  
  try {
    const withVectorDB = await testVectorDB(query);
    const withoutVectorDB = await testDirectQuery(query);
    
    console.log("\n=== Query Results ===");
    console.log("\nQuery:", query);
    
    console.log("\n=== With Vector DB ===");
    console.log("Answer:", withVectorDB.answer);
    console.log("\nSources used:");
    withVectorDB.relevantDocs.forEach(doc => {
      console.log(`- ${doc.source}`);
    });
    
    console.log("\n=== Without Vector DB ===");
    console.log(withoutVectorDB.answer);
    
    return {
      query,
      withVectorDB: withVectorDB.answer,
      withoutVectorDB: withoutVectorDB.answer,
      sources: withVectorDB.relevantDocs
    };
  } catch (error: any) {
    console.error("Error comparing results:", error.message);
    throw error;
  }
};


const main = async () => {
  try {
    //console.log("Starting vector database setup...");
    //await createCollection();
    //console.log("Collection created or verified. Starting data loading...");
    //await loadSampleData();
    //console.log("Data loading completed. Running test query...");

    // Test prompt with vector DB and direct query
    await compareResults("What is a Safe smart account?");
    //await compareResults("How to perform basic transactions checks on safe wallet?");

    console.log("Test completed successfully!");
  } catch (error: any) {
    console.error("Error in main function:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
};

// Run the main function
main().catch(console.error);
