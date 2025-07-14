import { randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

import { config } from '@dotenvx/dotenvx';
import { StringOutputParser } from '@langchain/core/output_parsers';
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
} from '@langchain/core/prompts';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { defineCommand, runMain } from 'citty';
import { consola } from 'consola';
import fastify from 'fastify';
import { createStuffDocumentsChain } from 'langchain/chains/combine_documents';
import { DirectoryLoader } from 'langchain/document_loaders/fs/directory';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import open from 'open';
import { AuthNService, PangeaConfig } from 'pangea-node-sdk';
import { AuthzRetriever } from './retrievers/authz.js';

config({ override: true, quiet: true });

const prompt = ChatPromptTemplate.fromMessages([
  HumanMessagePromptTemplate.fromTemplate(`You are an assistant for question-answering tasks. Use the following pieces of retrieved context to answer the question. If you don't know the answer, just say that you don't know. Use three sentences maximum and keep the answer concise.
Question: {input}
Context: {context}
Answer:`),
]);

const main = defineCommand({
  args: {
    prompt: { type: 'positional' },
    model: {
      type: 'string',
      default: 'gpt-4o-mini',
      description: 'OpenAI model.',
    },
  },
  async run({ args }) {
    const authnToken = process.env.PANGEA_AUTHN_CLIENT_TOKEN;
    if (!authnToken) {
      consola.warn('PANGEA_AUTHN_CLIENT_TOKEN is not set.');
      return;
    }

    const authnHostedLogin = process.env.PANGEA_AUTHN_HOSTED_LOGIN;
    if (!authnHostedLogin) {
      consola.warn('PANGEA_AUTHN_HOSTED_LOGIN is not set.');
      return;
    }

    const authzToken = process.env.PANGEA_AUTHZ_TOKEN;
    if (!authzToken) {
      consola.warn('PANGEA_AUTHZ_TOKEN is not set.');
      return;
    }

    const pangeaDomain = process.env.PANGEA_DOMAIN || 'aws.us.pangea.cloud';

    const authn = new AuthNService(
      authnToken,
      new PangeaConfig({ domain: pangeaDomain })
    );

    // Web server to handle the authentication flow callback.
    const app = fastify();
    const state = randomBytes(16).toString('hex');
    let resolve = (_: unknown) => null;
    const tokenPromise: Promise<string> = new Promise((resolve_) => {
      // @ts-expect-error
      resolve = resolve_;
    });
    app.get<{ Querystring: { code?: string; state?: string } }>(
      '/callback',
      async (request, reply) => {
        // Verify that the state param matches the original.
        if (request.query.state !== state) {
          reply.code(401);
          return;
        }

        const authCode = request.query.code;
        if (!authCode) {
          reply.code(401);
          return;
        }

        const response = await authn.client.userinfo(authCode);
        if (
          !(response.success && response.result && response.result.active_token)
        ) {
          reply.code(401);
          return;
        }

        resolve(response.result.active_token.token);
        reply.send('Done, you can close this tab.');
      }
    );

    await app.listen({ port: 3000 });

    // Open a new browser tab to authenticate.
    const url = new URL(authnHostedLogin);
    url.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    consola.info('Opening browser to authenticate...');
    consola.info(`URL: <${url}>`);
    await open(url.toString());

    const token = await tokenPromise;
    await app.close();
    const checkResult = await authn.client.clientToken.check(token);

    // @ts-expect-error
    const owner = checkResult.result.owner;
    consola.info(`Authenticated as ${owner}.`);
    consola.info('');

    const loader = new DirectoryLoader('data', {
      '.md': (path) => new TextLoader(path),
    });
    const docs = await loader.load();

    // Add category metadata based on parent directory.
    for (const doc of docs) {
      doc.metadata.category = path.basename(
        path.parse(doc.metadata.source).dir
      );
    }

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 3500,
      chunkOverlap: 50,
    });
    const splits = await splitter.splitDocuments(docs);
    const vectorStore = await MemoryVectorStore.fromDocuments(
      splits,
      new OpenAIEmbeddings()
    );
    const retriever = new AuthzRetriever({
      vectorStore,
      searchType: 'similarity',
      token: authzToken,
      domain: pangeaDomain,
      username: owner,
    });

    const llm = new ChatOpenAI({ model: args.model });
    const chain = await createStuffDocumentsChain({
      llm,
      prompt,
      outputParser: new StringOutputParser(),
    });

    consola.log(
      await chain.invoke({
        input: args.prompt,
        context: await retriever.invoke(args.prompt),
      })
    );
  },
});

runMain(main);
