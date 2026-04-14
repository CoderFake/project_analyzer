/**
 * ChromaDB Wrapper — In-process vector store for code context caching
 */

import { log } from '../utils.js';

let chromaClient: any = null;

/**
 * Get or create ChromaDB client (in-process, persistent).
 */
async function getClient(persistPath: string) {
  if (!chromaClient) {
    try {
      const { ChromaClient } = await import('chromadb');
      chromaClient = new ChromaClient({ path: persistPath });
      log.info(`ChromaDB initialized at: ${persistPath}`);
    } catch (err) {
      log.warn(`ChromaDB not available: ${err}. Code context caching disabled.`);
      return null;
    }
  }
  return chromaClient;
}

/**
 * Store code context embeddings for a project.
 */
export async function storeCodeContext(
  persistPath: string,
  projectId: string,
  documents: { id: string; text: string; metadata?: Record<string, string> }[]
): Promise<number> {
  const client = await getClient(persistPath);
  if (!client) return 0;

  try {
    const collection = await client.getOrCreateCollection({
      name: `project_${projectId}`,
    });

    // Batch upsert
    const batchSize = 100;
    let stored = 0;

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);

      await collection.upsert({
        ids: batch.map((d) => d.id),
        documents: batch.map((d) => d.text),
        metadatas: batch.map((d) => d.metadata ?? {}),
      });

      stored += batch.length;
    }

    log.info(`ChromaDB: stored ${stored} documents for project ${projectId}`);
    return stored;
  } catch (err) {
    log.warn(`ChromaDB store failed: ${err}`);
    return 0;
  }
}

/**
 * Query code context by semantic similarity.
 */
export async function queryCodeContext(
  persistPath: string,
  projectId: string,
  queryText: string,
  nResults: number = 10
): Promise<{ id: string; text: string; distance: number; metadata?: Record<string, any> }[]> {
  const client = await getClient(persistPath);
  if (!client) return [];

  try {
    const collection = await client.getCollection({
      name: `project_${projectId}`,
    });

    const results = await collection.query({
      queryTexts: [queryText],
      nResults,
    });

    if (!results.ids?.[0]) return [];

    return results.ids[0].map((id: string, idx: number) => ({
      id,
      text: results.documents?.[0]?.[idx] ?? '',
      distance: results.distances?.[0]?.[idx] ?? 1.0,
      metadata: results.metadatas?.[0]?.[idx] ?? {},
    }));
  } catch (err) {
    log.warn(`ChromaDB query failed: ${err}`);
    return [];
  }
}
