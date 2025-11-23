#!/usr/bin/env node
require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function checkMemory() {
  const collectionName = 'personality-c296b337-4e67-5337-99a3-4ca105cbbd68';
  const targetId = '663c2ae4-0687-4e89-b0a6-4e1d950935e7';

  const response = await qdrant.retrieve(collectionName, {
    ids: [targetId],
    with_payload: true,
    with_vector: false,
  });

  if (response.length === 0) {
    console.log('Memory not found');
    return;
  }

  const point = response[0];
  console.log('Memory Full Content:');
  console.log('='.repeat(80));
  console.log('ID:', point.id);
  console.log('User:', point.payload.userId);
  console.log('Senders:', JSON.stringify(point.payload.senders));
  console.log('');
  console.log('FULL CONTENT:');
  console.log(point.payload.content);
  console.log('='.repeat(80));
}

checkMemory().catch(console.error);
