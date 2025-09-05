import type { RunnableConfig } from '@langchain/core/runnables';
import {
  type VectorStoreInterface,
  VectorStoreRetriever,
  type VectorStoreRetrieverInput,
} from '@langchain/core/vectorstores';
import { AuthZService, PangeaConfig } from 'pangea-node-sdk';

type AuthzRetrieverInput = {
  username: string;
  token: string;
  domain: string;
};

/** A retriever backed by a vector store with AuthZ filtering. */
export class AuthzRetriever<
  V extends VectorStoreInterface = VectorStoreInterface,
> extends VectorStoreRetriever<V> {
  private readonly username: string;
  private readonly client;

  constructor(fields: VectorStoreRetrieverInput<V> & AuthzRetrieverInput) {
    super(fields);

    this.username = fields.username;
    this.client = new AuthZService(
      fields.token,
      new PangeaConfig({ domain: fields.domain })
    );
  }

  override async invoke(input: string, options?: RunnableConfig) {
    const results = await super.invoke(input, options);
    return await Promise.all(
      results.map(async (doc) => {
        const category = doc.metadata.category;

        // Assume un-categorized documents may be read by anyone.
        if (!category) {
          return doc;
        }

        const response = await this.client.check({
          subject: { type: 'user', id: this.username },
          action: 'read',
          resource: { type: category },
        });

        return response.result.allowed ? doc : null;
      })
    ).then((docs) => docs.filter((doc) => doc !== null));
  }
}
