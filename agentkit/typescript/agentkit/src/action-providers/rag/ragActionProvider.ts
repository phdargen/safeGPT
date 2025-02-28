import { z } from "zod";
import { ActionProvider } from "../actionProvider";
import { CreateAction } from "../actionDecorator";
import { Network } from "../../network";
import { WalletProvider } from "../../wallet-providers";
import { Collection, DataAPIClient, Db } from "@datastax/astra-db-ts";
import OpenAI from "openai";
import { QueryKnowledgeBaseSchema } from "./schemas";

/**
 * Configuration options for the RAG Action Provider.
 */
export interface RAGActionProviderConfig {
  /**
   * The Astra DB application token for vector database access.
   */
  astraDbToken?: string;

  /**
   * The Astra DB API endpoint.
   */
  astraDbEndpoint?: string;

  /**
   * The Astra DB namespace.
   */
  astraDbNamespace?: string;

  /**
   * The Astra DB collection name.
   */
  astraDbCollection?: string;

  /**
   * The OpenAI API key.
   */
  openAiApiKey?: string;
}

/**
 * RAGActionProvider is an action provider for Retrieval-Augmented Generation queries.
 * It allows querying a vector database for information related to Safe wallet and other topics.
 */
export class RAGActionProvider extends ActionProvider<WalletProvider> {
  private astraDbToken?: string;
  private astraDbEndpoint?: string;
  private astraDbNamespace?: string;
  private astraDbCollection?: string;
  private openAiApiKey?: string;
  private openai: OpenAI;
  private astraDbClient: DataAPIClient;
  private astraDb: Db;
  private astraDbCollectionClient: Collection;

  /**
   * Constructor for the RAGActionProvider class.
   *
   * @param config - The configuration options for the RAGActionProvider.
   */
  constructor(config: RAGActionProviderConfig = {}) {
    super("rag", []);

    // Initialize vector database configuration
    this.astraDbToken = config.astraDbToken;
    this.astraDbEndpoint = config.astraDbEndpoint;
    this.astraDbNamespace = config.astraDbNamespace;
    this.astraDbCollection = config.astraDbCollection;
    this.openAiApiKey = config.openAiApiKey;

    // Initialize OpenAI client
    this.openai = new OpenAI({
      apiKey: this.openAiApiKey,
    });

    // Initialize Astra DB client
    this.astraDbClient = new DataAPIClient(this.astraDbToken);
    this.astraDb = this.astraDbClient.db(this.astraDbEndpoint as string, { namespace: this.astraDbNamespace as string });
    this.astraDbCollectionClient = this.astraDb.collection(this.astraDbCollection as string);
  }

  /**
   * Queries the knowledge base for information.
   * 
   * @param walletProvider - The wallet provider.
   * @param args - The input arguments for querying the knowledge base.
   * @returns A message containing the answer to the query.
   */
  @CreateAction({
    name: "query_knowledge_base",
    description: `
Queries the knowledge base for information about Safe wallet and related topics.
Takes the following input:
- query: The question or information request to search for

Important notes:
- This action uses a vector database to find relevant information
- Returns the most relevant answer based on the query
- Useful for "how-to" questions and general information about Safe wallet
`,
    schema: QueryKnowledgeBaseSchema,
  })
  async queryKnowledgeBase(
    walletProvider: WalletProvider,
    args: z.infer<typeof QueryKnowledgeBaseSchema>,
  ): Promise<string> {
    try {

      // Get embedding for the query
      const embedding = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: args.query,
        encoding_format: "float",
      });

      // Search the collection for relevant documents
      const result = await this.astraDbCollectionClient.find({}, {
        sort: {
          $vector: embedding.data[0].embedding,
        },
        limit: 10,
        projection: {
          text: 1,
          metadata: 1,
        },
        includeSimilarity: true,
      }).toArray();

      // Extract unique source URLs from top results
      const topSources = [...new Set(result.map(doc => doc.metadata?.source))];

      // Limit the top sources to 3
      const topSourcesLimited = topSources.slice(0, 3);
      
      // Second query filtering by the most relevant sources
      const docs = await this.astraDbCollectionClient.find(
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
      ).toArray();
      
      // If no documents found, return a message
      if (docs.length === 0) {
        return `No information found for query: "${args.query}". Please try a different query or consult the official Safe documentation at https://docs.safe.global/.`;
      }
      
      // Extract text from documents
      //const docsMap = docs.map((doc) => `Content: ${doc.text} Similarity: ${doc.similarity?.toFixed(3)}`).join('\n');
      const docsMap = docs.map(doc => doc.text).join('\n');

      // Get the document with highest similarity
      const mostRelevantDoc = docs[0].metadata?.source;

      // Create a prompt with the retrieved context
      const prompt = `
        Use the following context to answer the question:
        ${docsMap}
        Most relevant source: ${mostRelevantDoc}

        Question: ${args.query}
        `;

      return prompt;
    } catch (error) {
      return `Query knowledge base: Error querying vector database: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Checks if the RAG action provider supports the given network.
   * This provider is network-agnostic and works with any network.
   *
   * @param network - The network to check.
   * @returns Always returns true as this provider is network-agnostic.
   */
  supportsNetwork(_network: Network): boolean {
    return true;
  }
}

/**
 * Factory function to create a new RAGActionProvider instance.
 * 
 * @param config - Configuration options for the RAG action provider.
 * @returns A new RAGActionProvider instance.
 */
export const ragActionProvider = (config?: RAGActionProviderConfig) =>
  new RAGActionProvider(config);
